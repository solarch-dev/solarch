import { Injectable } from "@nestjs/common";
import { Polar } from "@polar-sh/sdk";
// Subpath: tipler src/types/polar-webhooks.d.ts ambient declaration ile çözülür;
// runtime Node exports map; vitest vi.mock("@polar-sh/sdk/webhooks") intercept eder.
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { env } from "../config/env";
import { planToProductId, type Plan } from "./entitlements";

export { WebhookVerificationError };

/** Doğrulanmış Polar webhook payload — validateEvent çıktısının daralttığımız şekli. */
export interface PolarWebhookEvent {
  type: string;
  data: any;
}

/** Reconcile için normalize edilmiş canlı abonelik durumu. */
export interface PolarSubState {
  id: string | null;
  status: string;
  productId: string | null;
  customerId: string | null;
  currentPeriodEnd: string | null;
  /** Trial bitiş tarihi (ISO) — yalnız status="trialing" iken anlamlı; aksi null.
   *  Polar'da ayrı bir trialEnd alanı yok: trial, ilk dönemdir → trialing'de bitiş
   *  = currentPeriodEnd (ilk ücretlendirme anı). */
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

@Injectable()
export class PolarClient {
  private readonly polar = new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER,
  });

  /** İzin verilen frontend origin'leri (CORS_ORIGIN allowlist). */
  private allowedOrigins(): string[] {
    return env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
  }

  /** successUrl'i frontend'in GÖNDERDİĞİ returnUrl'den kur — ama origin allowlist'te
   *  olmalı (açık-yönlendirme koruması). Geçersizse ilk izinli origin'e düş. Böylece
   *  dev (5173) ve prod (app.solarch.dev) otomatik doğru çalışır. {CHECKOUT_ID} Polar doldurur. */
  private resolveSuccessUrl(returnUrl?: string): string {
    const allowed = this.allowedOrigins();
    let base = `${allowed[0] ?? "http://localhost:5173"}/billing`;
    if (returnUrl) {
      try {
        const u = new URL(returnUrl);
        if (allowed.includes(u.origin)) base = `${u.origin}${u.pathname}`;
      } catch {
        /* geçersiz URL → fallback */
      }
    }
    return `${base}?checkout_id={CHECKOUT_ID}`;
  }

  /** Hosted-redirect checkout oturumu aç. Döner: ödeme sayfası URL'i.
   *  returnUrl: frontend'in kendi origin'i (window.location.origin + "/billing").
   *  Ödeme sonrası oraya döner; frontend checkout_id ile confirm eder. */
  async createCheckout(
    plan: Plan,
    clerkUserId: string,
    email?: string,
    returnUrl?: string,
  ): Promise<{ url: string }> {
    const productId = planToProductId(plan);
    const checkout = await this.polar.checkouts.create({
      products: [productId],
      externalCustomerId: clerkUserId,
      customerEmail: email,
      metadata: { clerkUserId },
      successUrl: this.resolveSuccessUrl(returnUrl),
    });
    return { url: checkout.url };
  }

  /** Checkout durumunu çek (success dönüşünde doğrulama için). metadata.clerkUserId
   *  ile sahiplik eşleşir; status succeeded/confirmed → ödeme alınmış. */
  async getCheckout(checkoutId: string): Promise<{
    status: string;
    productId: string | null;
    customerId: string | null;
    subscriptionId: string | null;
    clerkUserId: string | null;
  }> {
    const c = await this.polar.checkouts.get({ id: checkoutId });
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const clerkUserId = typeof meta.clerkUserId === "string" ? meta.clerkUserId : null;
    return {
      status: String(c.status),
      productId: c.productId ?? null,
      customerId: c.customerId ?? null,
      subscriptionId: c.subscriptionId ?? null,
      clerkUserId,
    };
  }

  /** Aboneliğin CANLI durumu (id ile). Webhook gecikse/ulaşamasa bile reconcile için. */
  async getSubscription(subscriptionId: string): Promise<PolarSubState> {
    return this.normalizeSub(await this.polar.subscriptions.get({ id: subscriptionId }));
  }

  /** subscription id yoksa (confirm'de yakalanamamış olabilir) müşteriden bul:
   *  aktif aboneliği, yoksa en günceli; hiç yoksa null. */
  async getSubscriptionByCustomer(customerId: string): Promise<PolarSubState | null> {
    const page = await this.polar.subscriptions.list({ customerId });
    const items: unknown[] = (page as { result?: { items?: unknown[] } })?.result?.items ?? [];
    if (!items.length) return null;
    const isActive = (s: { status?: unknown }) =>
      ["active", "trialing", "past_due"].includes(String(s.status));
    const chosen = (items as { status?: unknown }[]).find(isActive) ?? items[0];
    return this.normalizeSub(chosen);
  }

  private normalizeSub(s: any): PolarSubState {
    const periodEnd = s?.currentPeriodEnd ? new Date(s.currentPeriodEnd).toISOString() : null;
    return {
      id: s?.id ?? null,
      status: String(s?.status),
      productId: s?.productId ?? null,
      customerId: s?.customerId ?? null,
      currentPeriodEnd: periodEnd,
      // Trial yalnız ilk dönemdir → trialing iken bitiş = dönem sonu; değilse trial yok.
      trialEndsAt: String(s?.status) === "trialing" ? periodEnd : null,
      cancelAtPeriodEnd: Boolean(s?.cancelAtPeriodEnd),
    };
  }

  /** Customer portal oturumu (yönet/iptal). clerkUserId = externalCustomerId. */
  async createPortalSession(clerkUserId: string, customerId?: string): Promise<{ url: string }> {
    const session = customerId
      ? await this.polar.customerSessions.create({ customerId })
      : await this.polar.customerSessions.create({ externalCustomerId: clerkUserId });
    return { url: session.customerPortalUrl };
  }

  /** Webhook imzasını doğrula + parse et. Hata → WebhookVerificationError fırlatır. */
  verifyAndParseWebhook(rawBody: string | Buffer, headers: Record<string, string>): PolarWebhookEvent {
    const payload = validateEvent(rawBody, headers, env.POLAR_WEBHOOK_SECRET);
    return { type: payload.type, data: (payload as { data: unknown }).data };
  }

  /** Sipariş iadesi. amount = iade tutarı (kuruş/cent). */
  async refund(orderId: string, amount: number): Promise<void> {
    await this.polar.refunds.create({ orderId, amount, reason: "customer_request" });
  }
}
