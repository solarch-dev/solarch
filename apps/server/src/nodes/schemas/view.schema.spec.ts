import { describe, it, expect } from "vitest";
import { ViewNodeSchema } from "./view.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  ViewName: "active_users_view",
  Description: "Returns active users",
  Definition: "SELECT id, email FROM users WHERE active = true",
  SourceTables: ["users"],
  Materialized: false,
};

const parse = (properties: unknown) =>
  ViewNodeSchema.parse({ ...validBase, type: "View", properties });

describe("ViewNodeSchema (enriched)", () => {
  it("parses valid View", () => {
    const node = parse(validProperties);
    expect(node.properties.SourceTables).toEqual(["users"]);
  });

  it("defaults Columns to empty array when omitted", () => {
    const node = parse(validProperties);
    expect(node.properties.Columns).toEqual([]);
  });

  it("accepts Columns + materialized RefreshStrategy", () => {
    const node = parse({
      ...validProperties,
      Materialized: true,
      RefreshStrategy: "scheduled",
      Columns: [{ Name: "id", DataType: "UUID" }, { Name: "email", DataType: "VARCHAR" }],
    });
    expect(node.properties.RefreshStrategy).toBe("scheduled");
    expect(node.properties.Columns).toHaveLength(2);
  });

  it("rejects invalid RefreshStrategy", () => {
    expect(() => parse({ ...validProperties, RefreshStrategy: "always" })).toThrow();
  });

  it("throws when Definition is empty", () => {
    expect(() => parse({ ...validProperties, Definition: "" })).toThrow();
  });

  it("throws when SourceTables is empty", () => {
    expect(() => parse({ ...validProperties, SourceTables: [] })).toThrow();
  });

  it("throws when Materialized is not boolean", () => {
    expect(() => parse({ ...validProperties, Materialized: "no" })).toThrow();
  });
});
