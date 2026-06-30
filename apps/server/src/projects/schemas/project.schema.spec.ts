import { describe, it, expect } from "vitest";
import { ProjectSchema, ProjectStatusSchema } from "./project.schema";

const valid = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "E-Ticaret Mikroservisleri",
  description: "Ana mimari",
  status: "draft" as const,
  ownerId: "user_123",
  orgId: null,
  createdAt: "2026-05-22T10:00:00.000Z",
  updatedAt: "2026-05-22T10:00:00.000Z",
};

describe("ProjectSchema", () => {
  it("geçerli project'i parse eder", () => {
    expect(ProjectSchema.parse(valid).name).toBe("E-Ticaret Mikroservisleri");
  });

  it("name boşsa fırlatır", () => {
    expect(() => ProjectSchema.parse({ ...valid, name: "" })).toThrow();
  });

  it("description zorunlu", () => {
    const { description, ...rest } = valid;
    expect(() => ProjectSchema.parse(rest)).toThrow();
  });

  it("bilinmeyen status reddeder", () => {
    expect(() => ProjectSchema.parse({ ...valid, status: "live" })).toThrow();
  });

  it("ProjectStatusSchema 3 değer içerir", () => {
    expect(ProjectStatusSchema.options).toEqual(["draft", "active", "archived"]);
  });
});
