import { describe, it, expect } from "vitest";
import { ServiceNodeSchema } from "./service.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  ServiceName: "PaymentService",
  Description: "Payment processing",
  IsTransactionScoped: true,
  Methods: [
    {
      MethodName: "processPayment",
      Parameters: [{ Name: "req", Type: "PaymentRequestDTO", DtoRef: "PaymentRequestDTO" }],
      ReturnType: "PaymentResponseDTO",
      ReturnDtoRef: "PaymentResponseDTO",
      IsAsync: true,
      Throws: ["PaymentFailedException"],
    },
  ],
};

const parse = (properties: unknown) =>
  ServiceNodeSchema.parse({ ...validBase, type: "Service", properties });

describe("ServiceNodeSchema (enriched)", () => {
  it("parses valid Service", () => {
    const node = parse(validProperties);
    expect(node.properties.IsTransactionScoped).toBe(true);
    expect(node.properties.Methods[0].Parameters).toHaveLength(1);
  });

  it("method defaults (Visibility/Parameters/IsAsync/Throws)", () => {
    const node = parse({ ...validProperties, Methods: [{ MethodName: "ping", ReturnType: "void" }] });
    const m = node.properties.Methods[0];
    expect(m.Visibility).toBe("public");
    expect(m.Parameters).toEqual([]);
    expect(m.IsAsync).toBe(false);
    expect(m.Throws).toEqual([]);
  });

  it("Dependencies (DI) default empty, accepts valid Kind", () => {
    expect(parse(validProperties).properties.Dependencies).toEqual([]);
    const node = parse({ ...validProperties, Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }] });
    expect(node.properties.Dependencies[0].Kind).toBe("Repository");
  });

  it("rejects invalid Dependency Kind", () => {
    expect(() => parse({ ...validProperties, Dependencies: [{ Kind: "Database", Ref: "x" }] })).toThrow();
  });

  it("rejects legacy InputParams field (strict)", () => {
    expect(() => parse({ ...validProperties, Methods: [{ MethodName: "x", InputParams: [], ReturnType: "void" }] })).toThrow();
  });

  it("Description is required", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("throws when Methods is empty", () => {
    expect(() => parse({ ...validProperties, Methods: [] })).toThrow();
  });
});
