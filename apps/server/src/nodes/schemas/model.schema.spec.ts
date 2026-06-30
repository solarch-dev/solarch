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
  Description: "Kullanıcı entity sınıfı",
  Properties: [
    { Name: "id", Type: "UUID" },
    { Name: "email", Type: "string" },
  ],
};

const parse = (properties: unknown) =>
  ModelNodeSchema.parse({ ...validBase, type: "Model", properties });

describe("ModelNodeSchema (enriched)", () => {
  it("geçerli Model'i parse eder", () => {
    const node = parse(validProperties);
    expect(node.properties.ClassName).toBe("User");
  });

  it("Property nullable/collection default false", () => {
    const node = parse(validProperties);
    expect(node.properties.Properties[0].IsNullable).toBe(false);
    expect(node.properties.Properties[0].IsCollection).toBe(false);
  });

  it("ilişkili property (OneToMany + RelatedModelRef) kabul eder", () => {
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

  it("geçersiz RelationType reddeder", () => {
    expect(() => parse({
      ...validProperties,
      Properties: [{ Name: "x", Type: "Y", RelationType: "ManyToNone" }],
    })).toThrow();
  });

  it("TableRef kabul eder", () => {
    const node = parse({ ...validProperties, TableRef: "users" });
    expect(node.properties.TableRef).toBe("users");
  });

  it("typed method signature (parametreler + async) kabul eder", () => {
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

  it("Properties boşsa fırlatır", () => {
    expect(() => parse({ ...validProperties, Properties: [] })).toThrow();
  });

  it("Methods default boş array", () => {
    const node = parse(validProperties);
    expect(node.properties.Methods).toEqual([]);
  });
});
