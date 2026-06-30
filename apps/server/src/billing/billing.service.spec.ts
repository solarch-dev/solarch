import { describe, it, expect, vi } from "vitest";
import { BillingService } from "./billing.service";
import { PaymentRequiredException } from "../common/exceptions/payment-required.exception";

function svc(sub: any, usage = { generations: 0, edits: 0, questions: 0 }) {
  // tryConsume: atomik check-and-increment. Cap altındaysa yeni sayaç (number),
  // doluysa null. Burada usage başlangıcı verili cap'e göre simüle edilir.
  const repo = {
    get: vi.fn(async () => sub),
    getUsage: vi.fn(async () => usage),
    incrementUsage: vi.fn(async () => 1),
    tryConsume: vi.fn(async (_id: string, _key: string, meter: keyof typeof usage, cap: number) =>
      usage[meter] >= cap ? null : usage[meter] + 1,
    ),
    refundUsage: vi.fn(async () => 0),
    upsert: vi.fn(async () => {}),
  };
  return { s: new BillingService(repo as any), repo };
}

describe("BillingService", () => {
  it("abonelik yoksa free", async () => {
    const { s } = svc(null);
    expect((await s.resolvePlan("u")).plan).toBe("free");
  });
  it("free 4h kotası: hak varken geçer, 4h pencere anahtarıyla sayar", async () => {
    const { s, repo } = svc(null);
    await s.consume("u", "questions");
    expect(repo.tryConsume).toHaveBeenCalledWith("u", expect.stringMatching(/^4h-\d+$/), "questions", 4);
  });
  it("free 4h kotası dolu → 402 + requiredPlan build", async () => {
    const { s } = svc(null, { generations: 0, edits: 0, questions: 4 });
    const err = await s.consume("u", "questions").catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRequiredException);
    expect((err.getResponse() as { requiredPlan?: string }).requiredPlan).toBe("build");
  });
  it("kapalı sayaç (edits cap 0) → 402 ERR_PLAN_AI", async () => {
    const { s } = svc(null);
    await expect(s.consume("u", "edits")).rejects.toBeInstanceOf(PaymentRequiredException);
  });
  it("build metre geçer + atomik artar (4h cap 20)", async () => {
    const { s, repo } = svc({ plan: "build", status: "active", currentPeriodEnd: null });
    await s.consume("u", "questions");
    // Atomik check-and-increment: tek çağrı, cap'i de iletir (TOCTOU yok).
    expect(repo.tryConsume).toHaveBeenCalledWith("u", expect.stringMatching(/^4h-\d+$/), "questions", 20);
  });
  it("metre dolu → 402", async () => {
    const { s } = svc({ plan: "build", status: "active", currentPeriodEnd: null }, { generations: 0, edits: 0, questions: 20 });
    await expect(s.consume("u", "questions")).rejects.toBeInstanceOf(PaymentRequiredException);
  });
  it("refund tüketilen metreyi iade eder (refundUsage çağrılır)", async () => {
    const { s, repo } = svc({ plan: "build", status: "active", currentPeriodEnd: null });
    await s.refund("u", "generations");
    expect(repo.refundUsage).toHaveBeenCalledWith("u", expect.any(String), "generations");
  });
  it("proje cap dolu → 402 (Free = 2; ücretli planlar unlimited)", async () => {
    const { s } = svc({ plan: "free", status: "active" });
    await expect(s.assertProjectCap("u", 2)).rejects.toBeInstanceOf(PaymentRequiredException);
  });
  it("guest_ kimliği → guest planı, DB'ye gidilmez", async () => {
    const { s, repo } = svc(null);
    const { plan, sub } = await s.resolvePlan("guest_abc123");
    expect(plan).toBe("guest");
    expect(sub).toBeNull();
    expect(repo.get).not.toHaveBeenCalled();
  });
  it("guest 1. proje serbest, 2. proje 402 + requiredPlan free (kayıt CTA'sı)", async () => {
    const { s } = svc(null);
    await expect(s.assertProjectCap("guest_abc123", 0)).resolves.toBeUndefined();
    const err = await s.assertProjectCap("guest_abc123", 1).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRequiredException);
    expect((err.getResponse() as { requiredPlan?: string }).requiredPlan).toBe("free");
  });
  it("guest 1 üretim hakkı: ilk geçer (cap 1), doluysa 402 + requiredPlan free (kayıt CTA)", async () => {
    const { s, repo } = svc(null);
    await s.consume("guest_abc123", "generations");
    expect(repo.tryConsume).toHaveBeenCalledWith("guest_abc123", expect.stringMatching(/^4h-\d+$/), "generations", 1);

    const { s: s2 } = svc(null, { generations: 1, edits: 0, questions: 0 });
    const err = await s2.consume("guest_abc123", "generations").catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRequiredException);
    expect((err.getResponse() as { requiredPlan?: string }).requiredPlan).toBe("free");
  });
  it("getState 4h penceresi döner: windowResetAt ileride + canGenerateCode alanı", async () => {
    const { s } = svc(null);
    const state = await s.getState("u");
    expect(state.entitlements.canGenerateCode).toBe(false);
    expect(new Date(state.windowResetAt).getTime()).toBeGreaterThan(Date.now());
  });
  it("codegen kapısı: free/draw 402, build geçer", async () => {
    const { s: sFree } = svc(null);
    await expect(sFree.assertCanGenerateCode("u")).rejects.toBeInstanceOf(PaymentRequiredException);
    const { s: sDraw } = svc({ plan: "draw", status: "active" });
    await expect(sDraw.assertCanGenerateCode("u")).rejects.toBeInstanceOf(PaymentRequiredException);
    const { s: sBuild } = svc({ plan: "build", status: "active" });
    await expect(sBuild.assertCanGenerateCode("u")).resolves.toBeUndefined();
  });

  it("ücretsiz generate: free 4h'de 1 (codegen metresi tüketir), dolunca 402; build sınırsız (metresiz)", async () => {
    // free, codegen kullanılmamış → geçer + codegen metresini tüketir (cap 1)
    const { s: sFree, repo: rFree } = svc(null, { generations: 0, edits: 0, questions: 0, codegen: 0 } as never);
    await expect(sFree.assertCanGenerateOrFreePass("u")).resolves.toBeUndefined();
    expect(rFree.tryConsume).toHaveBeenCalledWith("u", expect.stringMatching(/^4h-\d+$/), "codegen", 1);
    // free, codegen dolu (1) → 402 ERR_PLAN_METER
    const { s: sFull } = svc(null, { generations: 0, edits: 0, questions: 0, codegen: 1 } as never);
    await expect(sFull.assertCanGenerateOrFreePass("u")).rejects.toBeInstanceOf(PaymentRequiredException);
    // build (canGenerateCode) → sınırsız, metre TÜKETMEZ
    const { s: sBuild, repo: rBuild } = svc({ plan: "build", status: "active" }, { generations: 0, edits: 0, questions: 0, codegen: 0 } as never);
    await expect(sBuild.assertCanGenerateOrFreePass("u")).resolves.toBeUndefined();
    expect(rBuild.tryConsume).not.toHaveBeenCalled();
  });
  it("canceled → free, AI kapalı", async () => {
    const { s } = svc({ plan: "code", status: "canceled" });
    expect((await s.resolvePlan("u")).plan).toBe("free");
  });
  it("webhook upsert çağrılır (Polar subscription.created)", async () => {
    const { s, repo } = svc(null);
    await s.applyWebhookEvent("subscription.created", {
      id: "sub_1", customerId: "ctm_1", status: "active", productId: "",
      customer: { externalId: "u" },
    });
    expect(repo.upsert).toHaveBeenCalled();
  });
  it("order.* event'leri YOK sayılır (status'u bozmasın)", async () => {
    const { s, repo } = svc(null);
    await s.applyWebhookEvent("order.paid", {
      id: "ord_1", customerId: "ctm_1", customer: { externalId: "u" },
    });
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("subscription.active → status active + polarSubscriptionId yazılır", async () => {
    const { s, repo } = svc(null);
    await s.applyWebhookEvent("subscription.active", {
      id: "sub_9", customerId: "ctm_9", status: "active", productId: "",
      customer: { externalId: "u" },
    });
    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ status: "active", polarSubscriptionId: "sub_9" }));
  });
  it("subscription.revoked → plan free + status canceled", async () => {
    const { s, repo } = svc(null);
    await s.applyWebhookEvent("subscription.revoked", {
      id: "sub_5", customerId: "ctm_5", status: "active", productId: "prod_x",
      customer: { externalId: "u" },
    });
    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ plan: "free", status: "canceled" }));
  });
});
