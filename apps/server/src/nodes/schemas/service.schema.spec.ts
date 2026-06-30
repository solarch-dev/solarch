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
  Description: "Ödeme işlemleri",
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
  it("geçerli Service'i parse eder", () => {
    const node = parse(validProperties);
    expect(node.properties.IsTransactionScoped).toBe(true);
    expect(node.properties.Methods[0].Parameters).toHaveLength(1);
  });

  it("method default'ları (Visibility/Parameters/IsAsync/Throws)", () => {
    const node = parse({ ...validProperties, Methods: [{ MethodName: "ping", ReturnType: "void" }] });
    const m = node.properties.Methods[0];
    expect(m.Visibility).toBe("public");
    expect(m.Parameters).toEqual([]);
    expect(m.IsAsync).toBe(false);
    expect(m.Throws).toEqual([]);
  });

  it("Dependencies (DI) default boş, geçerli Kind kabul eder", () => {
    expect(parse(validProperties).properties.Dependencies).toEqual([]);
    const node = parse({ ...validProperties, Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }] });
    expect(node.properties.Dependencies[0].Kind).toBe("Repository");
  });

  it("geçersiz Dependency Kind reddeder", () => {
    expect(() => parse({ ...validProperties, Dependencies: [{ Kind: "Database", Ref: "x" }] })).toThrow();
  });

  it("eski InputParams alanını reddeder (strict)", () => {
    expect(() => parse({ ...validProperties, Methods: [{ MethodName: "x", InputParams: [], ReturnType: "void" }] })).toThrow();
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("Methods boşsa fırlatır", () => {
    expect(() => parse({ ...validProperties, Methods: [] })).toThrow();
  });
});
