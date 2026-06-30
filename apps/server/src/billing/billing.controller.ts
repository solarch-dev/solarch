import { Body, Controller, ForbiddenException, Get, Post, Req, HttpCode, Headers, type RawBodyRequest } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { BillingService } from "./billing.service";
import { PolarClient, WebhookVerificationError } from "./polar.client";
import { type Plan } from "./entitlements";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { Public } from "../auth/public.decorator";
import type { AuthContext } from "../auth/auth.types";
import { ok } from "../common/envelope";

/** Misafir ödeme/portal akışlarına giremez — önce kayıt (Polar gerçek kimlik ister). */
function assertNotGuest(auth: AuthContext): void {
  if (auth.isGuest) {
    throw new ForbiddenException({
      code: "ERR_GUEST_FORBIDDEN",
      message: "Create an account to manage billing.",
    });
  }
}

@ApiTags("Billing")
@Controller("billing")
export class BillingController {
  constructor(
    private readonly service: BillingService,
    private readonly polar: PolarClient,
  ) {}

  @Get("subscription")
  @ApiOperation({ summary: "Current subscription + entitlement + usage (reconciled with Polar)" })
  async subscription(@CurrentAuth() auth: AuthContext) {
    await this.reconcile(auth.userId);
    return ok(await this.service.getState(auth.userId));
  }

  /** Yerel aboneliği Polar'ın canlı durumuyla senkronla — webhook gecikse/ulaşamasa bile
   *  iptal/revoke/yenileme doğru yansır. Polar erişilemezse yerel state'le sessizce devam. */
  private async reconcile(userId: string): Promise<void> {
    const { sub } = await this.service.resolvePlan(userId);
    if (!sub) return;
    try {
      // subscription id varsa onunla; yoksa (confirm'de yakalanamamışsa) customer üzerinden.
      const remote = sub.polarSubscriptionId
        ? await this.polar.getSubscription(sub.polarSubscriptionId)
        : sub.polarCustomerId
          ? await this.polar.getSubscriptionByCustomer(sub.polarCustomerId)
          : null;
      if (remote) await this.service.reconcileSubscription(userId, remote);
    } catch {
      /* Polar erişilemedi → yerel state korunur */
    }
  }

  @Post("checkout")
  @HttpCode(200)
  @ApiOperation({ summary: "Polar hosted-checkout URL for the selected plan" })
  async checkout(@Body() body: { plan: Plan; returnUrl?: string }, @CurrentAuth() auth: AuthContext) {
    assertNotGuest(auth);
    await this.service.assertUpgrade(auth.userId, body.plan); // 409 ERR_PLAN_DOWNGRADE
    const { url } = await this.polar.createCheckout(body.plan, auth.userId, undefined, body.returnUrl);
    return ok({ url });
  }

  @Post("checkout/confirm")
  @HttpCode(200)
  @ApiOperation({ summary: "Checkout success return — verify with Polar + write subscription (immediate)" })
  async confirmCheckout(@Body() body: { checkoutId: string }, @CurrentAuth() auth: AuthContext) {
    assertNotGuest(auth);
    const checkout = await this.polar.getCheckout(body.checkoutId);
    await this.service.confirmCheckout(auth.userId, checkout);
    return ok(await this.service.getState(auth.userId));
  }

  @Get("portal")
  @ApiOperation({ summary: "Polar customer portal URL" })
  async portal(@CurrentAuth() auth: AuthContext) {
    assertNotGuest(auth);
    const { sub } = await this.service.resolvePlan(auth.userId);
    const { url } = await this.polar.createPortalSession(auth.userId, sub?.polarCustomerId ?? undefined);
    return ok({ url });
  }

  @Public()
  @SkipThrottle() // Polar webhook'ları burst gelebilir; imza zaten doğrulanıyor.
  @Post("webhook")
  @HttpCode(200)
  @ApiOperation({ summary: "Polar webhook (signature is verified)" })
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string>) {
    const raw = req.rawBody ?? Buffer.from("");
    try {
      const { type, data } = this.polar.verifyAndParseWebhook(raw, headers);
      await this.service.applyWebhookEvent(type, data);
      return { ok: true };
    } catch (e) {
      if (e instanceof WebhookVerificationError) return { ok: false };
      throw e;
    }
  }
}
