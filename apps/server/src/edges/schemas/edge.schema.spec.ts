import { describe, it, expect } from "vitest";
import { EdgeSchema, EdgePropertiesSchema, EDGE_KINDS } from "./edge.schema";

const validEdge = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  sourceNodeId: "550e8400-e29b-41d4-a716-446655440010",
  targetNodeId: "550e8400-e29b-41d4-a716-446655440020",
  kind: "CALLS" as const,
  createdAt: "2026-05-22T10:30:00.000Z",
  updatedAt: "2026-05-22T10:30:00.000Z",
  properties: { IsAsync: false, Label: "fetchUser()" },
};

describe("EdgeSchema", () => {
  it("geçerli edge'i parse eder", () => {
    const e = EdgeSchema.parse(validEdge);
    expect(e.kind).toBe("CALLS");
  });

  it("16 EDGE_KINDS içerir", () => {
    expect(EDGE_KINDS).toHaveLength(16);
    expect(EDGE_KINDS).toContain("CALLS");
    expect(EDGE_KINDS).toContain("THROWS");
    expect(EDGE_KINDS).toContain("ROUTES_TO");
  });

  it("Bilinmeyen kind reddeder", () => {
    expect(() => EdgeSchema.parse({ ...validEdge, kind: "FOO" })).toThrow();
  });

  it("sourceNodeId UUID değilse reddeder", () => {
    expect(() => EdgeSchema.parse({ ...validEdge, sourceNodeId: "abc" })).toThrow();
  });

  it("properties.IsAsync zorunlu", () => {
    expect(() => EdgeSchema.parse({
      ...validEdge,
      properties: { Label: "x" } as any,
    })).toThrow();
  });

  it("bilinmeyen properties alanı reddeder (strict)", () => {
    expect(() => EdgeSchema.parse({
      ...validEdge,
      properties: { IsAsync: false, Foo: "bar" } as any,
    })).toThrow();
  });
});

describe("EdgePropertiesSchema", () => {
  it("Protocol opsiyonel + enum", () => {
    expect(EdgePropertiesSchema.parse({ IsAsync: true, Protocol: "HTTP" }).Protocol).toBe("HTTP");
    expect(() => EdgePropertiesSchema.parse({ IsAsync: true, Protocol: "FTP" })).toThrow();
  });

  it("RetryCount negatif olamaz", () => {
    expect(() => EdgePropertiesSchema.parse({ IsAsync: true, RetryCount: -1 })).toThrow();
  });
});
