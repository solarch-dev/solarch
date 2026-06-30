import { describe, it, expect } from "vitest";
import { AiIdempotencyStore } from "./ai-idempotency.store";

describe("AiIdempotencyStore", () => {
  it("claims first-seen requestId (true), rejects duplicate (false)", () => {
    const store = new AiIdempotencyStore();
    expect(store.tryAcquire("req-1")).toBe(true);
    expect(store.tryAcquire("req-1")).toBe(false);
    expect(store.tryAcquire("req-1")).toBe(false);
  });

  it("different requestIds are independent", () => {
    const store = new AiIdempotencyStore();
    expect(store.tryAcquire("a")).toBe(true);
    expect(store.tryAcquire("b")).toBe(true);
    expect(store.tryAcquire("a")).toBe(false);
    expect(store.tryAcquire("b")).toBe(false);
  });
});
