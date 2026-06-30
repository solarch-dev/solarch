import { describe, it, expect } from "vitest";
import { CreateTabSchema, LayoutSchema } from "./tab.schema";

describe("Tab schemas", () => {
  it("CreateTab valid", () => {
    expect(CreateTabSchema.parse({ name: "Order Module" }).name).toBe("Order Module");
  });
  it("CreateTab rejects empty name", () => {
    expect(() => CreateTabSchema.parse({ name: "" })).toThrow();
  });
  it("Layout rejects empty items", () => {
    expect(() => LayoutSchema.parse({ items: [] })).toThrow();
  });
  it("Layout accepts valid item", () => {
    expect(LayoutSchema.parse({ items: [{ nodeId: "550e8400-e29b-41d4-a716-446655440000", x: 1, y: 2 }] }).items).toHaveLength(1);
  });
});
