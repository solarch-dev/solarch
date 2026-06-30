import { describe, it, expect } from "vitest";
import { BaseNodeSchema, PositionSchema } from "./base.schema";

describe("PositionSchema", () => {
  it("geçerli position'ı parse eder", () => {
    const result = PositionSchema.parse({ x: 150, y: 300 });
    expect(result).toEqual({ x: 150, y: 300 });
  });

  it("x veya y eksikse fırlatır", () => {
    expect(() => PositionSchema.parse({ x: 150 })).toThrow();
  });

  it("x veya y number değilse fırlatır", () => {
    expect(() => PositionSchema.parse({ x: "150", y: 300 })).toThrow();
  });
});

describe("BaseNodeSchema", () => {
  const valid = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    projectId: "550e8400-e29b-41d4-a716-446655440001",
    position: { x: 0, y: 0 },
    createdAt: "2026-05-21T10:30:00.000Z",
    updatedAt: "2026-05-21T10:30:00.000Z",
  };

  it("geçerli base node'u parse eder", () => {
    expect(() => BaseNodeSchema.parse(valid)).not.toThrow();
  });

  it("id UUID değilse fırlatır", () => {
    expect(() => BaseNodeSchema.parse({ ...valid, id: "abc" })).toThrow();
  });

  it("createdAt ISO datetime değilse fırlatır", () => {
    expect(() => BaseNodeSchema.parse({ ...valid, createdAt: "yesterday" })).toThrow();
  });

  it("projectId UUID değilse fırlatır", () => {
    expect(() => BaseNodeSchema.parse({ ...valid, projectId: "p1" })).toThrow();
  });
});
