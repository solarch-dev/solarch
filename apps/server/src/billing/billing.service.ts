import { Injectable, ConflictException } from "@nestjs/common";
import { SubscriptionRepository, type StoredSubscription } from "./subscription.repository";
import { limitsFor, productIdToPlan, planRank, METER_WINDOW_MS, type Plan, type Meter } from "./entitlements";
import { PaymentRequiredException } from "../common/exceptions/payment-required.exception";
import { isGuestId } from "../auth/guest-token";
import { env } from "../config/env";

const ACTIVE = new Set(["active", "trialing", "past_due"]); // erişim verilen statüler

@Injectable()
export class BillingService {
  constructor(private readonly repo: SubscriptionRepository) {}

  /** Faz-1: subject = user. Misafir kimliği (guest_*) DB'ye gitmeden guest planı alır. */
  async resolvePlan(userId: string): Promise<{ plan: Plan; sub: StoredSubscription | null }> {
    if (isGuestId(userId)) return { plan: "guest", sub: null };
    const sub = await this.repo.get("user", userId);
    const plan: Plan = sub && ACTIVE.has(sub.status) ? sub.plan : "free";
    return { plan, sub };
  }

  /** 4 saatlik kota penceresi anahtarı — UTC epoch bucket'ı (plan bağımsız). */
  private windowKey(now = Date.now()): string {
    return `4h-${Math.floor(now / METER_WINDOW_MS)}`;
  }

  /** Aktif pencerenin bitişi (ISO) — frontend "resets in Xh Ym" geri sayımı için. */
  private windowResetAt(now = Date.now()): string {
    return new Date((Math.floor(now / METER_WINDOW_MS) + 1) * METER_WINDOW_MS).toISOString();
  }

  async getState(userId: string) {
    const { plan, sub } = await this.resolvePlan(userId);
    // Self-host (billing disabled) reports the top plan so the UI unlocks everything.
    const effectivePlan = env.BILLING_ENABLED ? plan : "code";
    const limits = limitsFor(effectivePlan);
    const usage = await this.repo.getUsage(userId, this.windowKey());
    return {
      plan: effectivePlan,
      status: env.BILLING_ENABLED ? (sub?.status ?? "none") : "self-host",
      entitlements: {
        canUseAI: limits.canUseAI,
        canCodegen: limits.canCodegen,
        canGenerateCode: limits.canGenerateCode,
        projectCap: limits.projectCap,
      },
      meters: limits.meters,
      usage,
      windowResetAt: this.windowResetAt(),
      periodEnd: sub?.currentPeriodEnd ?? null,
      trialEndsAt: sub?.trialEndsAt ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    };
  }

  /** Polar'dan çekilmiş CANLI abonelik durumuyla yereli senkronla (webhook'a bağımlı kalmadan;
   *  lokalde webhook localhost'a ulaşamaz). status'ü resolvePlan'ın ACTIVE seti yorumlar:
   *  active/trialing/past_due → erişim; canceled/unpaid/... → free. cancelAtPeriodEnd korunur. */
  async reconcileSubscription(
    userId: string,
    remote: { id: string | null; status: string; productId: string | null; customerId: string | null; currentPeriodEnd: string | null; trialEndsAt?: string | null; cancelAtPeriodEnd: boolean },
  ): Promise<void> {
    await this.repo.upsert({
      subjectType: "user",
      subjectId: userId,
      plan: productIdToPlan(remote.productId ?? "") ?? "free",
      status: remote.status,
      polarSubscriptionId: remote.id ?? null,
      polarCustomerId: remote.customerId ?? null,
      currentPeriodEnd: remote.currentPeriodEnd,
      trialEndsAt: remote.trialEndsAt ?? null,
      cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
    });
  }

  /** Metre kotasını kontrol et + artır (atomik). İzin yoksa/doluysa 402.
   *  TOCTOU yok: tek atomik check-and-increment (oku/kontrol/yaz arası kilitsiz boşluk
   *  bırakmaz) → eşzamanlı istekler cap'i aşamaz. Kota 4 saatlik pencere bazlıdır;
   *  dolduğunda misafire "kayıt ol" (free), free/draw'a "Build'e geç" CTA'sı düşer. */
  async consume(userId: string, meter: Meter): Promise<void> {
    if (!env.BILLING_ENABLED) return; // self-host: unlimited, no metering
    const { plan } = await this.resolvePlan(userId);
    const cap = limitsFor(plan).meters[meter];
    if (cap <= 0) {
      // Planın hiç açmadığı sayaç (örn. edits) — pencere kotası değil plan engeli.
      throw new PaymentRequiredException("ERR_PLAN_AI", "This AI feature is not available on your plan.", "build");
    }
    const next = await this.repo.tryConsume(userId, this.windowKey(), meter, cap);
    if (next === null) {
      const requiredPlan =
        plan === "guest" ? "free" : plan === "free" || plan === "draw" ? "build" : "code";
      throw new PaymentRequiredException(
        "ERR_PLAN_METER",
        `Your '${meter}' limit (${cap} per 4 hours) has been reached.`,
        requiredPlan,
      );
    }
  }

  /** Başarısız üretimde tüketilen metreyi geri ver (refund). consume()'un karşıtı:
   *  AI çağrısı tamamen başarısızsa (abort / model-glitch / hiç node/edge yok)
   *  kullanıcıya kotasını iade et. refundUsage 0'ın altına düşmez → çift-refund güvenli.
   *  (Pencere sınırı aşılırken consume/refund farklı pencerelere düşebilir; refund
   *  0'da kenetlendiği için zararsız no-op olur.) */
  async refund(userId: string, meter: Meter): Promise<void> {
    if (!env.BILLING_ENABLED) return; // self-host: nothing was consumed
    await this.repo.refundUsage(userId, this.windowKey(), meter);
  }

  /** Deterministik kod üretimi / ZIP export (Constructor) = Build+ özelliği.
   *  canUseAI artık tüm planlarda açık olduğundan kapı AÇIK alan: canGenerateCode. */
  async assertCanGenerateCode(userId: string): Promise<void> {
    if (!env.BILLING_ENABLED) return; // self-host: unlimited
    const { plan } = await this.resolvePlan(userId);
    if (!limitsFor(plan).canGenerateCode) {
      throw new PaymentRequiredException(
        "ERR_PLAN_AI",
        "Code generation requires the Build or Code plan.",
        "build",
      );
    }
  }

  /** Generate (Constructor) erişimi — "değer-önce-kanıt" funnel'ı:
   *  - Build/Code (canGenerateCode): SINIRSIZ, metre tüketmez.
   *  - guest/free/draw: `codegen` metresiyle 4h'de 1 KEZ ücretsiz önizleme; dolunca
   *    402 ERR_PLAN_METER (Build'e geç). Deterministik üretim AI maliyeti taşımaz,
   *    o yüzden ücretsiz önizleme güvenli. Çağıran başarısızlıkta refund("codegen") eder. */
  async assertCanGenerateOrFreePass(userId: string): Promise<void> {
    if (!env.BILLING_ENABLED) return; // self-host: unlimited
    const { plan } = await this.resolvePlan(userId);
    if (limitsFor(plan).canGenerateCode) return; // paid: sınırsız, metre yok
    await this.consume(userId, "codegen"); // free/guest/draw: 4h'de 1 (cap=meters.codegen)
  }

  /** SURGICAL AI (sunucu-tarafı gövde doldurma; @solarch:surgical bölgeleri) = Code tier.
   *  `canCodegen` yalnız Code planında açıktır (entitlement matrisi). */
  async assertCanCodegen(userId: string): Promise<void> {
    if (!env.BILLING_ENABLED) return; // self-host: unlimited
    const { plan } = await this.resolvePlan(userId);
    if (!limitsFor(plan).canCodegen) {
      throw new PaymentRequiredException(
        "ERR_PLAN_CODEGEN",
        "Surgical AI (filling the algorithm bodies) requires the Code plan.",
        "code",
      );
    }
  }

  async assertProjectCap(userId: string, currentCount: number): Promise<void> {
    if (!env.BILLING_ENABLED) return; // self-host: unlimited projects
    const { plan } = await this.resolvePlan(userId);
    const cap = limitsFor(plan).projectCap;
    if (cap !== -1 && currentCount >= cap) {
      // guest → "free": bir üst adım satın alma değil, ücretsiz hesap açmak (frontend kayıt CTA'sı gösterir).
      const requiredPlan =
        plan === "guest" ? "free" : plan === "free" ? "draw" : plan === "draw" ? "build" : "code";
      throw new PaymentRequiredException("ERR_PLAN_LIMIT", `Your project limit (${cap}) has been reached.`, requiredPlan);
    }
  }

  /** Checkout yalnız UPGRADE içindir: mevcut plandan düşük/eşit plana abone olunamaz
   *  (Build varken Draw alınamaz — hiyerarşik). UI baypas edilse bile sunucu 409 reddeder. */
  async assertUpgrade(userId: string, target: Plan): Promise<void> {
    if (target === "free") {
      throw new ConflictException({ code: "ERR_PLAN_DOWNGRADE", message: "Free is the default plan and cannot be purchased." });
    }
    const { plan } = await this.resolvePlan(userId);
    if (planRank(target) <= planRank(plan)) {
      throw new ConflictException({ code: "ERR_PLAN_DOWNGRADE", message: "You are already on an equal or higher plan." });
    }
  }

  /** Polar webhook event → Subscription upsert.
   *  YALNIZ abonelik yaşam döngüsü event'leri durumu belirler (subscription.*).
   *  order.* / diğer event'ler yok sayılır (abonelik durumunu bozmasınlar diye).
   *  - created / active / updated / uncanceled / past_due → plan = productIdToPlan, status korunur.
   *  - canceled / revoked → plan free + status "canceled" (erişim çekilir). */
  async applyWebhookEvent(eventType: string, data: any): Promise<void> {
    if (!eventType.startsWith("subscription.")) return;
    // Polar: externalCustomerId = clerkUserId; ayrıca metadata.clerkUserId fallback.
    const clerkUserId =
      data?.customer?.externalId ?? data?.metadata?.clerkUserId ?? data?.customerExternalId;
    if (!clerkUserId) return;

    // revoked = gerçek erişim kesimi → free. canceled = dönem-sonu iptal planı (status hâlâ
    // active olabilir) → planı koru + cancelAtPeriodEnd işaretle; erişimi resolvePlan (ACTIVE) belirler.
    const revoked = eventType === "subscription.revoked";
    const productId: string = data?.productId ?? "";
    const periodEnd =
      data?.currentPeriodEnd instanceof Date
        ? data.currentPeriodEnd.toISOString()
        : (data?.currentPeriodEnd ?? null);
    // Trial = ilk dönem → trialing iken bitiş = dönem sonu (Polar'da ayrı alan yok).
    const trialEndsAt = !revoked && data?.status === "trialing" ? periodEnd : null;

    await this.repo.upsert({
      subjectType: "user",
      subjectId: clerkUserId,
      plan: revoked ? "free" : (productIdToPlan(productId) ?? "free"),
      status: revoked ? "canceled" : (data?.status ?? "active"),
      polarSubscriptionId: data?.id ?? null,
      polarCustomerId: data?.customerId ?? null,
      currentPeriodEnd: periodEnd,
      trialEndsAt,
      cancelAtPeriodEnd: Boolean(data?.cancelAtPeriodEnd),
    });
  }

  /** Checkout success dönüşünde Polar'dan doğrulanmış checkout ile aboneliği ANINDA yaz
   *  (webhook'a bağımlı kalmadan; lokalde webhook localhost'a ulaşamaz). Webhook async
   *  kaynak-doğru olarak kalır (yenileme/iptal). Güvenlik: checkout sahibi = userId. */
  async confirmCheckout(
    userId: string,
    checkout: { status: string; productId: string | null; customerId: string | null; subscriptionId: string | null; clerkUserId: string | null },
  ): Promise<void> {
    if (checkout.clerkUserId && checkout.clerkUserId !== userId) return; // başkasının checkout'u
    const paid = checkout.status === "succeeded" || checkout.status === "confirmed";
    if (!paid || !checkout.productId) return;
    const plan = productIdToPlan(checkout.productId);
    if (!plan || plan === "free") return;
    await this.repo.upsert({
      subjectType: "user",
      subjectId: userId,
      plan,
      status: "active",
      polarSubscriptionId: checkout.subscriptionId ?? null,
      polarCustomerId: checkout.customerId ?? null,
      currentPeriodEnd: null, // webhook (subscription.active) gerçek dönem sonunu doldurur
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
    });
  }
}
