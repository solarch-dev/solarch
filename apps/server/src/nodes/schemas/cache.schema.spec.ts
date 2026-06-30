import { describe, it, expect } from "vitest";
import { CacheNodeSchema } from "./cache.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  CacheName: "UserSessionCache",
  Description: "Active session cache",
  KeyPattern: "user:session:{userId}",
  TTL_Seconds: 3600,
  Engine: "Redis" as const,
};

const parse = (properties: unknown) =>
  CacheNodeSchema.parse({ ...validBase, type: "Cache", properties });

describe("CacheNodeSchema (enriched)", () => {
  it("parses valid Cache", () => {
    expect(parse(validProperties).properties.Engine).toBe("Redis");
  });

  it("accepts EvictionPolicy + MaxSizeMB + Serialization", () => {
    const node = parse({ ...validProperties, EvictionPolicy: "LRU", MaxSizeMB: 256, Serialization: "json" });
    expect(node.properties.EvictionPolicy).toBe("LRU");
    expect(node.properties.MaxSizeMB).toBe(256);
  });

  it("rejects invalid EvictionPolicy", () => {
    expect(() => parse({ ...validProperties, EvictionPolicy: "Random" })).toThrow();
  });

  it("rejects unknown Engine", () => {
    expect(() => parse({ ...validProperties, Engine: "Hazelcast" })).toThrow();
  });

  it("TTL_Seconds must be positive", () => {
    expect(() => parse({ ...validProperties, TTL_Seconds: 0 })).toThrow();
  });
});
