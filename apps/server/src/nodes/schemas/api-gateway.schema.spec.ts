import { describe, it, expect } from "vitest";
import { APIGatewayNodeSchema } from "./api-gateway.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-22T10:30:00.000Z",
  updatedAt: "2026-05-22T10:30:00.000Z",
};

const validProperties = {
  GatewayName: "MainGateway",
  Description: "Main entry gateway",
  Provider: "Kong" as const,
};

const parse = (properties: unknown) =>
  APIGatewayNodeSchema.parse({ ...validBase, type: "APIGateway", properties });

describe("APIGatewayNodeSchema (enriched)", () => {
  it("parses valid APIGateway (Routes default empty)", () => {
    const node = parse(validProperties);
    expect(node.properties.Provider).toBe("Kong");
    expect(node.properties.Routes).toEqual([]);
  });

  it("accepts AuthMode + CorsEnabled + Routes", () => {
    const node = parse({
      ...validProperties,
      AuthMode: "JWT",
      CorsEnabled: true,
      Routes: [{ Path: "/users", TargetRef: "UserController", Methods: ["GET", "POST"], AuthRequired: true, RateLimit: { Requests: 50, WindowSeconds: 60 } }],
    });
    expect(node.properties.AuthMode).toBe("JWT");
    expect(node.properties.Routes[0].Methods).toEqual(["GET", "POST"]);
    expect(node.properties.Routes[0].AuthRequired).toBe(true);
  });

  it("rejects invalid AuthMode", () => {
    expect(() => parse({ ...validProperties, AuthMode: "Basic" })).toThrow();
  });

  it("throws when Route Methods is empty", () => {
    expect(() => parse({ ...validProperties, Routes: [{ Path: "/x", TargetRef: "C", Methods: [] }] })).toThrow();
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("rejects unknown Provider", () => {
    expect(() => parse({ ...validProperties, Provider: "Apigee" })).toThrow();
  });
});
