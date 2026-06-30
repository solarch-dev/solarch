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
  Description: "Aktif kullanıcıları döner",
  Definition: "SELECT id, email FROM users WHERE active = true",
  SourceTables: ["users"],
  Materialized: false,
};

const parse = (properties: unknown) =>
  ViewNodeSchema.parse({ ...validBase, type: "View", properties });

describe("ViewNodeSchema (enriched)", () => {
  it("geçerli View'i parse eder", () => {
    const node = parse(validProperties);
    expect(node.properties.SourceTables).toEqual(["users"]);
  });

  it("Columns verilmezse default boş array", () => {
    const node = parse(validProperties);
    expect(node.properties.Columns).toEqual([]);
  });

  it("Columns + materialized RefreshStrategy kabul eder", () => {
    const node = parse({
      ...validProperties,
      Materialized: true,
      RefreshStrategy: "scheduled",
      Columns: [{ Name: "id", DataType: "UUID" }, { Name: "email", DataType: "VARCHAR" }],
    });
    expect(node.properties.RefreshStrategy).toBe("scheduled");
    expect(node.properties.Columns).toHaveLength(2);
  });

  it("geçersiz RefreshStrategy reddeder", () => {
    expect(() => parse({ ...validProperties, RefreshStrategy: "always" })).toThrow();
  });

  it("Definition boşsa fırlatır", () => {
    expect(() => parse({ ...validProperties, Definition: "" })).toThrow();
  });

  it("SourceTables boşsa fırlatır", () => {
    expect(() => parse({ ...validProperties, SourceTables: [] })).toThrow();
  });

  it("Materialized boolean değilse fırlatır", () => {
    expect(() => parse({ ...validProperties, Materialized: "no" })).toThrow();
  });
});
