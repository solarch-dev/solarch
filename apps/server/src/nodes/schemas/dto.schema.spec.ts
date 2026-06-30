import { describe, it, expect } from "vitest";
import { DTONodeSchema } from "./dto.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  Name: "CreateUserRequestDTO",
  Description: "New user registration request",
  Fields: [
    { Name: "email", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "Email" }] },
    { Name: "age", DataType: "number", IsRequired: false, IsArray: false },
  ],
};

const parse = (properties: unknown) =>
  DTONodeSchema.parse({ ...validBase, type: "DTO", properties });

describe("DTONodeSchema (enriched)", () => {
  it("parses valid DTO", () => {
    const node = parse(validProperties);
    expect(node.properties.Fields).toHaveLength(2);
  });

  it("defaults ValidationRules to empty array when omitted", () => {
    const node = parse(validProperties);
    expect(node.properties.Fields[1].ValidationRules).toEqual([]);
  });

  it("ValidationRule Value (MinLength) kabul eder", () => {
    const node = parse({
      ...validProperties,
      Fields: [{ Name: "password", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "MinLength", Value: "8" }] }],
    });
    expect(node.properties.Fields[0].ValidationRules[0].Value).toBe("8");
  });

  it("rejects invalid validation rule", () => {
    expect(() => parse({
      ...validProperties,
      Fields: [{ Name: "x", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "Bogus" }] }],
    })).toThrow();
  });

  it("accepts NestedDTORef and EnumRef", () => {
    const node = parse({
      ...validProperties,
      Fields: [
        { Name: "address", DataType: "object", IsRequired: true, IsArray: false, NestedDTORef: "AddressDTO" },
        { Name: "status", DataType: "string", IsRequired: true, IsArray: false, EnumRef: "OrderStatus" },
      ],
    });
    expect(node.properties.Fields[0].NestedDTORef).toBe("AddressDTO");
    expect(node.properties.Fields[1].EnumRef).toBe("OrderStatus");
  });

  it("throws when Description is missing", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("throws when Fields is empty", () => {
    expect(() => parse({ ...validProperties, Fields: [] })).toThrow();
  });

  it("throws when IsRequired is not boolean", () => {
    expect(() => parse({ ...validProperties, Fields: [{ Name: "x", DataType: "string", IsRequired: "yes", IsArray: false }] })).toThrow();
  });

  it("rejects legacy ValidationRule (string) field (strict)", () => {
    expect(() => parse({
      ...validProperties,
      Fields: [{ Name: "x", DataType: "string", IsRequired: true, IsArray: false, ValidationRule: "Email" }],
    })).toThrow();
  });
});
