import { describe, it, expect } from "vitest";
import { ModelNodeSchema } from "./model.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  ClassName: "User",
  Description: "User entity class",
  Properties: [
    { Name: "id", Type: "UUID" },
    { Name: "email", Type: "string" },
  ],
};

const parse = (properties: unknown) =>
  ModelNodeSchema.parse({ ...validBase, type: "Model", properties });

describe("ModelNodeSchema (enriched)", () => {
  it("parses valid Model", () => {
    const node = parse(validProperties);
    expect(node.properties.ClassName).toBe("User");
  });

  it("Property nullable/collection default false", () => {
    const node = parse(validProperties);
    expect(node.properties.Properties[0].IsNullable).toBe(false);
    expect(node.properties.Properties[0].IsCollection).toBe(false);
  });

  it("accepts related property (OneToMany + RelatedModelRef)", () => {
    const node = parse({
      ...validProperties,
      Properties: [
        { Name: "id", Type: "UUID" },
        { Name: "orders", Type: "Order", IsCollection: true, RelationType: "OneToMany", RelatedModelRef: "Order" },
      ],
    });
    expect(node.properties.Properties[1].RelationType).toBe("OneToMany");
    expect(node.properties.Properties[1].RelatedModelRef).toBe("Order");
  });

  it("rejects invalid RelationType", () => {
    expect(() => parse({
      ...validProperties,
      Properties: [{ Name: "x", Type: "Y", RelationType: "ManyToNone" }],
    })).toThrow();
  });

  it("accepts TableRef", () => {
    const node = parse({ ...validProperties, TableRef: "users" });
    expect(node.properties.TableRef).toBe("users");
  });

  it("accepts typed method signature (parameters + async)", () => {
    const node = parse({
      ...validProperties,
      Methods: [{
        MethodName: "rename",
        Parameters: [{ Name: "name", Type: "string" }, { Name: "force", Type: "boolean", Optional: true }],
        ReturnType: "void",
        IsAsync: true,
      }],
    });
    const m = node.properties.Methods[0];
    expect(m.Visibility).toBe("public");
    expect(m.Parameters).toHaveLength(2);
    expect(m.Parameters[1].Optional).toBe(true);
    expect(m.IsAsync).toBe(true);
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("throws when Properties is empty", () => {
    expect(() => parse({ ...validProperties, Properties: [] })).toThrow();
  });

  it("defaults Methods to empty array", () => {
    const node = parse(validProperties);
    expect(node.properties.Methods).toEqual([]);
  });
});
