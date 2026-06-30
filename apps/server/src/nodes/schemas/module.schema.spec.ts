import { describe, it, expect } from "vitest";
import { ModuleNodeSchema } from "./module.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  ModuleName: "BillingContext",
  Description: "Billing context",
  StrictBoundaries: true,
};

const parse = (properties: unknown) =>
  ModuleNodeSchema.parse({ ...validBase, type: "Module", properties });

describe("ModuleNodeSchema (enriched)", () => {
  it("parses valid Module (ExposedServices/Dependencies default empty)", () => {
    const node = parse(validProperties);
    expect(node.properties.StrictBoundaries).toBe(true);
    expect(node.properties.ExposedServices).toEqual([]);
    expect(node.properties.Dependencies).toEqual([]);
  });

  it("accepts ExposedServices + Dependencies", () => {
    const node = parse({
      ...validProperties,
      ExposedServices: ["InvoiceService", "PaymentService"],
      Dependencies: ["UserContext"],
    });
    expect(node.properties.ExposedServices).toEqual(["InvoiceService", "PaymentService"]);
    expect(node.properties.Dependencies).toEqual(["UserContext"]);
  });

  it("ModuleName is required", () => {
    const { ModuleName, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("throws when StrictBoundaries is not boolean", () => {
    expect(() => parse({ ...validProperties, StrictBoundaries: "yes" })).toThrow();
  });
});
