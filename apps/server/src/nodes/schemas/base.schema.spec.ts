import { describe, it, expect } from "vitest";
import { BaseNodeSchema, PositionSchema } from "./base.schema";

describe("PositionSchema", () => {
  it("parses valid position", () => {
    const result = PositionSchema.parse({ x: 150, y: 300 });
    expect(result).toEqual({ x: 150, y: 300 });
  });

  it("throws when x or y is missing", () => {
    expect(() => PositionSchema.parse({ x: 150 })).toThrow();
  });

  it("throws when x or y is not a number", () => {
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

  it("parses valid base node", () => {
    expect(() => BaseNodeSchema.parse(valid)).not.toThrow();
  });

  it("throws when id is not a UUID", () => {
    expect(() => BaseNodeSchema.parse({ ...valid, id: "abc" })).toThrow();
  });

  it("throws when createdAt is not ISO datetime", () => {
    expect(() => BaseNodeSchema.parse({ ...valid, createdAt: "yesterday" })).toThrow();
  });

  it("throws when projectId is not a UUID", () => {
    expect(() => BaseNodeSchema.parse({ ...valid, projectId: "p1" })).toThrow();
  });
});
