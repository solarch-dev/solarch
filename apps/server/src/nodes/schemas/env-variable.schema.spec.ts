import { describe, it, expect } from "vitest";
import { EnvironmentVariableNodeSchema } from "./env-variable.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  Key: "DB_PASSWORD",
  Description: "Database password",
  DataType: "String" as const,
  IsSecret: true,
  Environment: ["Dev", "Prod"] as const,
};

const parse = (properties: unknown) =>
  EnvironmentVariableNodeSchema.parse({ ...validBase, type: "EnvironmentVariable", properties });

describe("EnvironmentVariableNodeSchema (enriched)", () => {
  it("parses valid EnvironmentVariable (IsRequired defaults to true)", () => {
    const node = parse(validProperties);
    expect(node.properties.IsSecret).toBe(true);
    expect(node.properties.IsRequired).toBe(true);
  });

  it("accepts DefaultValue + ValidationPattern + IsRequired=false", () => {
    const node = parse({
      ...validProperties,
      IsSecret: false,
      DefaultValue: "5432",
      ValidationPattern: "^[0-9]+$",
      IsRequired: false,
    });
    expect(node.properties.DefaultValue).toBe("5432");
    expect(node.properties.IsRequired).toBe(false);
  });

  it("throws when Environment is empty", () => {
    expect(() => parse({ ...validProperties, Environment: [] })).toThrow();
  });

  it("rejects unknown Environment", () => {
    expect(() => parse({ ...validProperties, Environment: ["UAT"] })).toThrow();
  });
});
