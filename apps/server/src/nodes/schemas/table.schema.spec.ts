import { describe, it, expect } from "vitest";
import { TableNodeSchema } from "./table.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const col = (over: Record<string, unknown> = {}) => ({
  Name: "id",
  DataType: "UUID",
  IsPrimaryKey: true,
  IsNotNull: true,
  IsUnique: true,
  AutoIncrement: false,
  ...over,
});

const validProperties = {
  TableName: "users",
  Description: "Registered users",
  Columns: [col()],
};

const parse = (properties: unknown) =>
  TableNodeSchema.parse({ ...validBase, type: "Table", properties });

describe("TableNodeSchema (enriched)", () => {
  it("parses valid Table node", () => {
    const node = parse(validProperties);
    expect(node.properties.TableName).toBe("users");
  });

  it("defaults constraint arrays to empty when omitted", () => {
    const node = parse(validProperties);
    expect(node.properties.ForeignKeys).toEqual([]);
    expect(node.properties.UniqueConstraints).toEqual([]);
    expect(node.properties.CheckConstraints).toEqual([]);
    expect(node.properties.Indexes).toEqual([]);
  });

  it("composite PrimaryKey kabul eder", () => {
    const node = parse({
      ...validProperties,
      Columns: [col({ Name: "order_id", IsPrimaryKey: false }), col({ Name: "product_id", IsPrimaryKey: false })],
      PrimaryKey: { Columns: ["order_id", "product_id"] },
    });
    expect(node.properties.PrimaryKey?.Columns).toEqual(["order_id", "product_id"]);
  });

  it("ForeignKey FK action default NO_ACTION", () => {
    const node = parse({
      ...validProperties,
      ForeignKeys: [{ Columns: ["org_id"], ReferencesTable: "orgs", ReferencesColumns: ["id"] }],
    });
    expect(node.properties.ForeignKeys[0].OnDelete).toBe("NO_ACTION");
    expect(node.properties.ForeignKeys[0].OnUpdate).toBe("NO_ACTION");
  });

  it("ForeignKey OnDelete=CASCADE kabul eder", () => {
    const node = parse({
      ...validProperties,
      ForeignKeys: [{ Columns: ["org_id"], ReferencesTable: "orgs", ReferencesColumns: ["id"], OnDelete: "CASCADE" }],
    });
    expect(node.properties.ForeignKeys[0].OnDelete).toBe("CASCADE");
  });

  it("rejects invalid FK action", () => {
    expect(() => parse({
      ...validProperties,
      ForeignKeys: [{ Columns: ["x"], ReferencesTable: "t", ReferencesColumns: ["id"], OnDelete: "DROP" }],
    })).toThrow();
  });

  it("accepts DECIMAL precision/scale and ENUM EnumRef columns", () => {
    const node = parse({
      ...validProperties,
      Columns: [
        col(),
        col({ Name: "price", DataType: "DECIMAL", Precision: 10, Scale: 2, IsPrimaryKey: false, IsUnique: false }),
        col({ Name: "status", DataType: "ENUM", EnumRef: "OrderStatus", IsPrimaryKey: false, IsUnique: false }),
      ],
    });
    expect(node.properties.Columns[1].Precision).toBe(10);
    expect(node.properties.Columns[2].EnumRef).toBe("OrderStatus");
  });

  it("accepts rich Index (unique + partial + WhereClause)", () => {
    const node = parse({
      ...validProperties,
      Indexes: [{ IndexName: "idx_active", Columns: ["id"], Type: "GIN", IsUnique: true, IsPartial: true, WhereClause: "active = true" }],
    });
    expect(node.properties.Indexes[0].Type).toBe("GIN");
    expect(node.properties.Indexes[0].IsPartial).toBe(true);
  });

  it("Index Type/IsUnique default", () => {
    const node = parse({
      ...validProperties,
      Indexes: [{ IndexName: "idx_id", Columns: ["id"] }],
    });
    expect(node.properties.Indexes[0].Type).toBe("BTree");
    expect(node.properties.Indexes[0].IsUnique).toBe(false);
  });

  it("CheckConstraint kabul eder", () => {
    const node = parse({
      ...validProperties,
      CheckConstraints: [{ Name: "age_chk", Expression: "age >= 0" }],
    });
    expect(node.properties.CheckConstraints[0].Expression).toBe("age >= 0");
  });

  it("throws when Description is missing", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("throws when Columns is empty", () => {
    expect(() => parse({ ...validProperties, Columns: [] })).toThrow();
  });

  it("rejects unknown DataType", () => {
    expect(() => parse({ ...validProperties, Columns: [col({ DataType: "FOOBAR" })] })).toThrow();
  });

  it("rejects legacy IsForeignKey/References field (strict)", () => {
    expect(() => parse({ ...validProperties, Columns: [col({ IsForeignKey: false })] })).toThrow();
  });

  it("rejects unknown field in properties (strict)", () => {
    expect(() => parse({ ...validProperties, ExtraField: "x" })).toThrow();
  });
});
