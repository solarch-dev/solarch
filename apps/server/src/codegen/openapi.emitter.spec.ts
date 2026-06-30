import { describe, it, expect } from "vitest";
import { buildCodeGraph } from "./ir";
import { projectOpenApi } from "./openapi.emitter";
import type { StoredNode } from "../nodes/nodes.repository";

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
function node(type: StoredNode["type"], properties: Record<string, unknown>): StoredNode {
  return { id: uuid(), type, projectId: "p", positionX: 0, positionY: 0, homeTabId: "t",
    createdAt: "2026-06-29T00:00:00.000Z", updatedAt: "2026-06-29T00:00:00.000Z", version: 1, properties };
}
function fixture() {
  const ctrl = node("Controller", {
    ControllerName: "UsersController", Description: "User ops", BaseRoute: "/users",
    Endpoints: [
      { HttpMethod: "POST", Route: "/", RequestDTORef: "CreateUserDto", ResponseDTORef: "UserDto", RequiresAuth: true, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [{ Code: 201, Description: "Created" }] },
      { HttpMethod: "GET", Route: "/:id", ResponseDTORef: "UserDto", RequiresAuth: false, PathParams: [{ Name: "id", DataType: "string" }], QueryParams: [], StatusCodes: [] },
    ],
  });
  return buildCodeGraph([ctrl], []);
}

describe("projectOpenApi — paths", () => {
  it("emits an operation per endpoint with method, full path, params, security, tags", () => {
    const doc = projectOpenApi(fixture());
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.paths["/users"]?.post).toBeTruthy();
    expect(doc.paths["/users/{id}"]?.get).toBeTruthy();
    const post = doc.paths["/users"]!.post!;
    expect(post.tags).toContain("UsersController");
    expect(post.security?.length).toBeGreaterThan(0); // RequiresAuth → security
    expect((post.responses as Record<string, unknown>)["201"]).toBeTruthy();
    const get = doc.paths["/users/{id}"]!.get!;
    expect(get.parameters?.some((p) => (p as { name: string }).name === "id")).toBe(true);
    expect(get.security ?? []).toHaveLength(0); // public
  });
});

describe("projectOpenApi — component schemas", () => {
  it("emits a schema per DTO with typed/required fields, enum and nested $refs", () => {
    const dto = node("DTO", { Name: "CreateUserDto", Description: "New user", Fields: [
      { Name: "email", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "Email" }] },
      { Name: "role", DataType: "string", IsRequired: false, IsArray: false, EnumRef: "UserRole" },
      { Name: "tags", DataType: "string", IsRequired: false, IsArray: true, ValidationRules: [] },
    ] });
    const en = node("Enum", { Name: "UserRole", Values: [{ Key: "ADMIN" }, { Key: "USER" }] });
    const graph = buildCodeGraph([dto, en], []);
    const doc = projectOpenApi(graph);
    const s = doc.components!.schemas!["CreateUserDto"] as { type: string; required?: string[]; properties: Record<string, { type?: string; format?: string; $ref?: string; items?: unknown }> };
    expect(s.type).toBe("object");
    expect(s.required).toContain("email");
    expect(s.required ?? []).not.toContain("role");
    expect(s.properties.email.format).toBe("email");
    expect(s.properties.role.$ref).toBe("#/components/schemas/UserRole");
    expect(s.properties.tags.type).toBe("array");
    expect(doc.components!.schemas!["UserRole"]).toBeTruthy(); // enum schema present
  });
});
