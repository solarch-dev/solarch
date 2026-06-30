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
  Description: "Sipariş durumu",
  Values: [
    { Key: "PENDING" },
    { Key: "SHIPPED", Value: "shipped", Description: "Kargoya verildi" },
    { Key: "DELIVERED" },
  ],
};

const parse = (properties: unknown) =>
  EnumNodeSchema.parse({ ...validBase, type: "Enum", properties });

describe("EnumNodeSchema (enriched)", () => {
  it("geçerli Enum'u parse eder", () => {
    const node = parse(validProperties);
    expect(node.properties.Values).toHaveLength(3);
  });

  it("BackingType default string", () => {
    const node = parse(validProperties);
    expect(node.properties.BackingType).toBe("string");
  });

  it("BackingType=int kabul eder", () => {
    const node = parse({ ...validProperties, BackingType: "int" });
    expect(node.properties.BackingType).toBe("int");
  });

  it("key-value (Value + Description) kabul eder", () => {
    const node = parse(validProperties);
    expect(node.properties.Values[1].Value).toBe("shipped");
    expect(node.properties.Values[1].Description).toBe("Kargoya verildi");
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("Values boşsa fırlatır", () => {
    expect(() => parse({ ...validProperties, Values: [] })).toThrow();
  });

  it("Key boşsa fırlatır", () => {
    expect(() => parse({ ...validProperties, Values: [{ Key: "" }] })).toThrow();
  });

  it("eski string[] Values formatını reddeder", () => {
    expect(() => parse({ ...validProperties, Values: ["PENDING", "SHIPPED"] })).toThrow();
  });
});
