import { describe, it, expect } from "vitest";
import { MiddlewareNodeSchema } from "./middleware.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  MiddlewareName: "RateLimiterMiddleware",
  Description: "Request rate limiting",
  AppliesTo: "Global" as const,
  ExecutionOrder: 1,
};

const parse = (properties: unknown) =>
  MiddlewareNodeSchema.parse({ ...validBase, type: "Middleware", properties });

describe("MiddlewareNodeSchema (enriched)", () => {
  it("parses valid Middleware (Config default empty)", () => {
    const node = parse(validProperties);
    expect(node.properties.ExecutionOrder).toBe(1);
    expect(node.properties.Config).toEqual([]);
  });

  it("accepts MiddlewareType + Config", () => {
    const node = parse({
      ...validProperties,
      MiddlewareType: "RateLimit",
      Config: [{ Key: "limit", Value: "100" }, { Key: "window", Value: "60s" }],
    });
    expect(node.properties.MiddlewareType).toBe("RateLimit");
    expect(node.properties.Config).toHaveLength(2);
  });

  it("rejects invalid MiddlewareType", () => {
    expect(() => parse({ ...validProperties, MiddlewareType: "Caching" })).toThrow();
  });

  it("rejects unknown AppliesTo", () => {
    expect(() => parse({ ...validProperties, AppliesTo: "Module" })).toThrow();
  });

  it("ExecutionOrder cannot be negative", () => {
    expect(() => parse({ ...validProperties, ExecutionOrder: -1 })).toThrow();
  });
});
