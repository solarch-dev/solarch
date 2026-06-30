import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config/env", () => ({
  env: {
    POLAR_ACCESS_TOKEN: "polar_test",
    POLAR_WEBHOOK_SECRET: "whsec_test",
    POLAR_SERVER: "sandbox",
    POLAR_PRODUCT_DRAW: "prod_draw",
    POLAR_PRODUCT_BUILD: "prod_build",
    POLAR_PRODUCT_CODE: "prod_code",
    CORS_ORIGIN: "http://localhost:5173",
  },
}));

const checkoutsCreate = vi.fn();
const customerSessionsCreate = vi.fn();
const refundsCreate = vi.fn();
vi.mock("@polar-sh/sdk", () => ({
  Polar: class {
    checkouts = { create: checkoutsCreate };
    customerSessions = { create: customerSessionsCreate };
    refunds = { create: refundsCreate };
  },
}));

const validateEvent = vi.fn();
vi.mock("@polar-sh/sdk/webhooks", () => {
  class WebhookVerificationError extends Error {}
  return {
    validateEvent: (...a: unknown[]) => validateEvent(...a),
    WebhookVerificationError,
  };
});

import { PolarClient, WebhookVerificationError } from "./polar.client";

describe("PolarClient", () => {
  let c: PolarClient;
  beforeEach(() => {
    vi.clearAllMocks();
    c = new PolarClient();
  });

  it("createCheckout → plan'ı productId'ye çevirir, externalCustomerId + metadata gönderir, url döner", async () => {
    checkoutsCreate.mockResolvedValue({ url: "https://pay.polar.sh/abc", id: "co_1" });
    const r = await c.createCheckout("build", "user_1", "a@b.com");
    expect(r).toEqual({ url: "https://pay.polar.sh/abc" });
    expect(checkoutsCreate).toHaveBeenCalledWith({
      products: ["prod_build"],
      externalCustomerId: "user_1",
      customerEmail: "a@b.com",
      metadata: { clerkUserId: "user_1" },
      successUrl: "http://localhost:5173/billing?checkout_id={CHECKOUT_ID}",
    });
  });

  it("createPortalSession → externalCustomerId ile session açar, customerPortalUrl döner", async () => {
    customerSessionsCreate.mockResolvedValue({ customerPortalUrl: "https://portal/x" });
    const r = await c.createPortalSession("user_1");
    expect(r).toEqual({ url: "https://portal/x" });
    expect(customerSessionsCreate).toHaveBeenCalledWith({ externalCustomerId: "user_1" });
  });

  it("createPortalSession → customerId verilirse onu kullanır", async () => {
    customerSessionsCreate.mockResolvedValue({ customerPortalUrl: "https://portal/y" });
    await c.createPortalSession("user_1", "cus_9");
    expect(customerSessionsCreate).toHaveBeenCalledWith({ customerId: "cus_9" });
  });

  it("verifyAndParseWebhook → geçerli imza → {type,data}", () => {
    validateEvent.mockReturnValue({ type: "subscription.active", data: { id: "sub_1" } });
    const r = c.verifyAndParseWebhook("{}", { "webhook-signature": "x" });
    expect(r).toEqual({ type: "subscription.active", data: { id: "sub_1" } });
    expect(validateEvent).toHaveBeenCalledWith("{}", { "webhook-signature": "x" }, "whsec_test");
  });

  it("verifyAndParseWebhook → geçersiz imza → WebhookVerificationError fırlatır", () => {
    validateEvent.mockImplementation(() => {
      throw new WebhookVerificationError("bad");
    });
    expect(() => c.verifyAndParseWebhook("{}", {})).toThrow("bad");
  });

  it("refund → refunds.create çağrılır", async () => {
    refundsCreate.mockResolvedValue({});
    await c.refund("ord_1", 500);
    expect(refundsCreate).toHaveBeenCalledWith({ orderId: "ord_1", amount: 500, reason: "customer_request" });
  });
});
