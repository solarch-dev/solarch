import { describe, it, expect } from "vitest";
import { ControllerNodeSchema } from "./controller.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  ControllerName: "UserController",
  Description: "User API",
  BaseRoute: "/api/v1/users",
  Version: "v1",
  Endpoints: [
    {
      HttpMethod: "POST",
      Route: "/register",
      RequestDTORef: "RegisterUserRequestDTO",
      ResponseDTORef: "UserResponseDTO",
      RequiresAuth: false,
    },
  ],
};

const parse = (properties: unknown) =>
  ControllerNodeSchema.parse({ ...validBase, type: "Controller", properties });

describe("ControllerNodeSchema (enriched)", () => {
  it("parses valid Controller", () => {
    const node = parse(validProperties);
    expect(node.properties.Endpoints[0].HttpMethod).toBe("POST");
    expect(node.properties.Endpoints[0].RequestDTORef).toBe("RegisterUserRequestDTO");
    expect(node.properties.Version).toBe("v1");
  });

  it("endpoint default arrays (RequiredRoles/PathParams/QueryParams/...)", () => {
    const ep = parse(validProperties).properties.Endpoints[0];
    expect(ep.RequiredRoles).toEqual([]);
    expect(ep.PathParams).toEqual([]);
    expect(ep.QueryParams).toEqual([]);
    expect(ep.StatusCodes).toEqual([]);
    expect(ep.MiddlewareRefs).toEqual([]);
  });

  it("accepts rich endpoint (path/query params + status + rate limit + middleware)", () => {
    const node = parse({
      ...validProperties,
      Endpoints: [{
        HttpMethod: "GET",
        Route: "/:id",
        RequiresAuth: true,
        PathParams: [{ Name: "id", Type: "UUID" }],
        QueryParams: [{ Name: "expand", Type: "string", Required: false }],
        StatusCodes: [{ Code: 200, Description: "OK" }, { Code: 404 }],
        MiddlewareRefs: ["AuthMiddleware"],
        RateLimit: { Requests: 100, WindowSeconds: 60 },
      }],
    });
    const ep = node.properties.Endpoints[0];
    expect(ep.PathParams[0].Name).toBe("id");
    expect(ep.QueryParams[0].Required).toBe(false);
    expect(ep.RateLimit?.Requests).toBe(100);
    expect(ep.MiddlewareRefs).toEqual(["AuthMiddleware"]);
  });

  it("rejects legacy RequestDTO/ResponseDTO field (strict)", () => {
    expect(() => parse({
      ...validProperties,
      Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false, RequestDTO: "X" }],
    })).toThrow();
  });

  it("Description is required", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("throws when Endpoints is empty", () => {
    expect(() => parse({ ...validProperties, Endpoints: [] })).toThrow();
  });

  it("rejects unknown HttpMethod", () => {
    expect(() => parse({ ...validProperties, Endpoints: [{ HttpMethod: "FETCH", Route: "/", RequiresAuth: false }] })).toThrow();
  });
});
