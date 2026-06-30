import { describe, it, expect } from "vitest";
import { CreateTabSchema, LayoutSchema } from "./tab.schema";

describe("Tab schemas", () => {
  it("CreateTab geçerli", () => {
    expect(CreateTabSchema.parse({ name: "Sipariş Modülü" }).name).toBe("Sipariş Modülü");
  });
  it("CreateTab boş isim reddeder", () => {
    expect(() => CreateTabSchema.parse({ name: "" })).toThrow();
  });
  it("Layout boş items reddeder", () => {
    expect(() => LayoutSchema.parse({ items: [] })).toThrow();
  });
  it("Layout geçerli item kabul eder", () => {
    expect(LayoutSchema.parse({ items: [{ nodeId: "550e8400-e29b-41d4-a716-446655440000", x: 1, y: 2 }] }).items).toHaveLength(1);
  });
});
