import { describe, it, expect, vi } from "vitest";
import { PatternsController } from "./patterns.controller";

describe("PatternsController (yalnız okuma — seed)", () => {
  const service = {
    search: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue({ id: "1" }),
  };
  const c = new PatternsController(service as any);

  it("list envelope döner", async () => {
    const r = await c.list();
    expect(r).toEqual({ success: true, data: [] });
  });

  it("search default k/minScore geçirir", async () => {
    await c.search({ query: "x" } as any);
    expect(service.search).toHaveBeenCalledWith("x", expect.any(Number), expect.any(Number));
  });

  it("yazma uçları (create/delete/promote) kaldırıldı — BOLA kapatıldı", () => {
    expect((c as unknown as { create?: unknown }).create).toBeUndefined();
    expect((c as unknown as { delete?: unknown }).delete).toBeUndefined();
    expect((c as unknown as { promote?: unknown }).promote).toBeUndefined();
  });
});
