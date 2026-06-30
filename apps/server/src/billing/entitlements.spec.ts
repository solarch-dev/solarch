import { describe, it, expect } from "vitest";
import { PLAN_LIMITS, limitsFor } from "./entitlements";

describe("entitlements", () => {
  it("AI tüm planlarda açık — sınırı 4h kota koyar", () => {
    expect(PLAN_LIMITS.guest.canUseAI).toBe(true);
    expect(PLAN_LIMITS.free.canUseAI).toBe(true);
    expect(PLAN_LIMITS.draw.canUseAI).toBe(true);
    expect(PLAN_LIMITS.build.canUseAI).toBe(true);
    expect(PLAN_LIMITS.code.canUseAI).toBe(true);
  });
  it("Generate Code / ZIP yalnız Build ve üzeri", () => {
    expect(PLAN_LIMITS.guest.canGenerateCode).toBe(false);
    expect(PLAN_LIMITS.free.canGenerateCode).toBe(false);
    expect(PLAN_LIMITS.draw.canGenerateCode).toBe(false);
    expect(PLAN_LIMITS.build.canGenerateCode).toBe(true);
    expect(PLAN_LIMITS.code.canGenerateCode).toBe(true);
  });
  it("yalnız code codegen (Surgical AI rezervi)", () => {
    expect(PLAN_LIMITS.code.canCodegen).toBe(true);
    expect(PLAN_LIMITS.build.canCodegen).toBe(false);
  });
  it("4h pencere kotaları pricing'le uyumlu", () => {
    expect(PLAN_LIMITS.guest.meters).toEqual({ generations: 1, edits: 0, questions: 2, codegen: 1 });
    expect(PLAN_LIMITS.free.meters).toEqual({ generations: 2, edits: 0, questions: 4, codegen: 1 });
    expect(PLAN_LIMITS.draw.meters).toEqual(PLAN_LIMITS.free.meters); // draw = free AI hakkı
    expect(PLAN_LIMITS.build.meters.generations).toBe(10);
    expect(PLAN_LIMITS.code.meters.questions).toBe(50);
    // codegen metresi: canGenerateCode olmayan tier'lar 4h'de 1 ücretsiz Constructor önizlemesi
    expect(PLAN_LIMITS.guest.meters.codegen).toBe(1);
    expect(PLAN_LIMITS.draw.meters.codegen).toBe(1);
  });
  it("bilinmeyen plan → free", () => {
    expect(limitsFor("x" as never).projectCap).toBe(2);
  });
  it("proje limitleri: guest 1, free 2, draw sınırsız", () => {
    expect(PLAN_LIMITS.guest.projectCap).toBe(1);
    expect(PLAN_LIMITS.free.projectCap).toBe(2);
    expect(PLAN_LIMITS.draw.projectCap).toBe(-1);
  });
});
