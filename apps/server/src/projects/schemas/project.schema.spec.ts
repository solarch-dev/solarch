import { describe, it, expect } from "vitest";
import { ProjectSchema, ProjectStatusSchema } from "./project.schema";

const valid = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "E-Commerce Microservices",
  description: "Main architecture",
  status: "draft" as const,
  ownerId: "user_123",
  orgId: null,
  createdAt: "2026-05-22T10:00:00.000Z",
  updatedAt: "2026-05-22T10:00:00.000Z",
};

describe("ProjectSchema", () => {
  it("parses valid project", () => {
    expect(ProjectSchema.parse(valid).name).toBe("E-Commerce Microservices");
  });

  it("throws when name is empty", () => {
    expect(() => ProjectSchema.parse({ ...valid, name: "" })).toThrow();
  });

  it("description is required", () => {
    const { description, ...rest } = valid;
    expect(() => ProjectSchema.parse(rest)).toThrow();
  });

  it("rejects unknown status", () => {
    expect(() => ProjectSchema.parse({ ...valid, status: "live" })).toThrow();
  });

  it("ProjectStatusSchema has 3 values", () => {
    expect(ProjectStatusSchema.options).toEqual(["draft", "active", "archived"]);
  });
});
