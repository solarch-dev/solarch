import { describe, it, expect } from "vitest";
import { RepositoryNodeSchema } from "./repository.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  RepositoryName: "UserRepository",
  Description: "User data access layer",
  EntityReference: "User",
  CustomQueries: [
    { QueryName: "findByEmail", QueryType: "findOne" as const, Parameters: [{ Name: "email", Type: "string" }], ReturnType: "User" },
  ],
};

const parse = (properties: unknown) =>
  RepositoryNodeSchema.parse({ ...validBase, type: "Repository", properties });

describe("RepositoryNodeSchema (enriched)", () => {
  it("parses valid Repository", () => {
    const node = parse(validProperties);
    expect(node.properties.CustomQueries[0].QueryName).toBe("findByEmail");
  });

  it("IsCached default false, QueryType/Parameters default", () => {
    const node = parse({ ...validProperties, IsCached: undefined, CustomQueries: [{ QueryName: "all", ReturnType: "User[]" }] });
    expect(node.properties.IsCached).toBe(false);
    expect(node.properties.CustomQueries[0].QueryType).toBe("custom");
    expect(node.properties.CustomQueries[0].Parameters).toEqual([]);
  });

  it("accepts BaseClass + IsCached", () => {
    const node = parse({ ...validProperties, BaseClass: "TypeOrmRepository", IsCached: true });
    expect(node.properties.BaseClass).toBe("TypeOrmRepository");
    expect(node.properties.IsCached).toBe(true);
  });

  it("rejects legacy string[] CustomQueries format", () => {
    expect(() => parse({ ...validProperties, CustomQueries: ["findByEmail"] })).toThrow();
  });

  it("EntityReference is required", () => {
    const { EntityReference, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("defaults CustomQueries to empty array", () => {
    const { CustomQueries, ...partial } = validProperties;
    expect(parse(partial).properties.CustomQueries).toEqual([]);
  });
});
