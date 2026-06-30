import { describe, it, expect } from "vitest";
import { EnumNodeSchema } from "./enum.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  Name: "OrderStatus",
  Description: "Order status",
  Values: [
    { Key: "PENDING" },
    { Key: "SHIPPED", Value: "shipped", Description: "Shipped" },
    { Key: "DELIVERED" },
  ],
};

const parse = (properties: unknown) =>
  EnumNodeSchema.parse({ ...validBase, type: "Enum", properties });

describe("EnumNodeSchema (enriched)", () => {
  it("parses valid Enum", () => {
    const node = parse(validProperties);
    expect(node.properties.Values).toHaveLength(3);
  });

  it("BackingType default string", () => {
    const node = parse(validProperties);
    expect(node.properties.BackingType).toBe("string");
  });

  it("accepts BackingType=int", () => {
    const node = parse({ ...validProperties, BackingType: "int" });
    expect(node.properties.BackingType).toBe("int");
  });

  it("accepts key-value (Value + Description)", () => {
    const node = parse(validProperties);
    expect(node.properties.Values[1].Value).toBe("shipped");
    expect(node.properties.Values[1].Description).toBe("Shipped");
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("throws when Values is empty", () => {
    expect(() => parse({ ...validProperties, Values: [] })).toThrow();
  });

  it("throws when Key is empty", () => {
    expect(() => parse({ ...validProperties, Values: [{ Key: "" }] })).toThrow();
  });

  it("rejects legacy string[] Values format", () => {
    expect(() => parse({ ...validProperties, Values: ["PENDING", "SHIPPED"] })).toThrow();
  });
});
