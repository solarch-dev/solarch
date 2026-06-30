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
  Description: "Aktif oturum cache'i",
  KeyPattern: "user:session:{userId}",
  TTL_Seconds: 3600,
  Engine: "Redis" as const,
};

const parse = (properties: unknown) =>
  CacheNodeSchema.parse({ ...validBase, type: "Cache", properties });

describe("CacheNodeSchema (enriched)", () => {
  it("geçerli Cache'i parse eder", () => {
    expect(parse(validProperties).properties.Engine).toBe("Redis");
  });

  it("EvictionPolicy + MaxSizeMB + Serialization kabul eder", () => {
    const node = parse({ ...validProperties, EvictionPolicy: "LRU", MaxSizeMB: 256, Serialization: "json" });
    expect(node.properties.EvictionPolicy).toBe("LRU");
    expect(node.properties.MaxSizeMB).toBe(256);
  });

  it("geçersiz EvictionPolicy reddeder", () => {
    expect(() => parse({ ...validProperties, EvictionPolicy: "Random" })).toThrow();
  });

  it("Bilinmeyen Engine reddeder", () => {
    expect(() => parse({ ...validProperties, Engine: "Hazelcast" })).toThrow();
  });

  it("TTL_Seconds pozitif olmalı", () => {
    expect(() => parse({ ...validProperties, TTL_Seconds: 0 })).toThrow();
  });
});
