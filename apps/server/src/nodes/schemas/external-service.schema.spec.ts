import { describe, it, expect } from "vitest";
import { ExternalServiceNodeSchema } from "./external-service.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  ServiceName: "StripePaymentAPI",
  Description: "Stripe payment integration",
  BaseURL: "https://api.stripe.com/v1",
  AuthType: "Bearer" as const,
  TimeoutSeconds: 30,
};

const parse = (properties: unknown) =>
  ExternalServiceNodeSchema.parse({ ...validBase, type: "ExternalService", properties });

describe("ExternalServiceNodeSchema (enriched)", () => {
  it("parses valid ExternalService (Endpoints default empty)", () => {
    const node = parse(validProperties);
    expect(node.properties.AuthType).toBe("Bearer");
    expect(node.properties.Endpoints).toEqual([]);
  });

  it("accepts Endpoints + RetryPolicy + RateLimit + CircuitBreaker", () => {
    const node = parse({
      ...validProperties,
      Endpoints: [{ Name: "createCharge", Method: "POST", Path: "/charges" }],
      RetryPolicy: { MaxRetries: 3, DelaySeconds: 2 },
      RateLimit: { Requests: 100, WindowSeconds: 60 },
      CircuitBreaker: { FailureThreshold: 5, ResetSeconds: 30 },
    });
    expect(node.properties.Endpoints[0].Method).toBe("POST");
    expect(node.properties.CircuitBreaker?.FailureThreshold).toBe(5);
  });

  it("rejects invalid BaseURL", () => {
    expect(() => parse({ ...validProperties, BaseURL: "not-a-url" })).toThrow();
  });

  it("rejects unknown AuthType", () => {
    expect(() => parse({ ...validProperties, AuthType: "OAuth" })).toThrow();
  });
});
