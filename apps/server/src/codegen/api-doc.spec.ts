import { describe, it, expect } from "vitest";
import { CodegenService, applyDescribeOperation } from "./codegen.service";
import { projectOpenApi } from "./openapi.emitter";
import { buildCodeGraph } from "./ir";
import type { StoredNode } from "../nodes/nodes.repository";

/* ────────────────────────────────────────────────────────────────────────
 * api-doc.spec.ts — CodegenService.apiDoc (baseline path).
 *
 * Mirrors the simpleSketchModel test shape: a small Controller fixture fed
 * through stubbed repositories. The "baseline" stage is fully deterministic
 * (no AI, no persistence touched), so it asserts that apiDoc yields the
 * projected OpenAPI doc with paths and source "deterministic" regardless of
 * whether AI is configured. The AI-enriched path lands in Task 4.
 * ──────────────────────────────────────────────────────────────────────── */

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
function node(type: StoredNode["type"], properties: Record<string, unknown>): StoredNode {
  return {
    id: uuid(),
    type,
    projectId: "p",
    positionX: 0,
    positionY: 0,
    homeTabId: "t",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function usersController(): StoredNode {
  return node("Controller", {
    ControllerName: "UsersController",
    Description: "User ops",
    BaseRoute: "/users",
    Endpoints: [
      { HttpMethod: "POST", Route: "/", RequestDTORef: "CreateUserDto", ResponseDTORef: "UserDto", RequiresAuth: true, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [{ Code: 201, Description: "Created" }] },
      { HttpMethod: "GET", Route: "/:id", ResponseDTORef: "UserDto", RequiresAuth: false, PathParams: [{ Name: "id", DataType: "string" }], QueryParams: [], StatusCodes: [] },
    ],
  });
}

function makeService(nodes: StoredNode[]): CodegenService {
  const projects = { exists: async () => true } as never;
  const nodesRepo = { list: async () => nodes } as never;
  const edgesRepo = { list: async () => [] } as never;
  const surgicalFills = { getAllForProject: async () => [] } as never;
  return new CodegenService(projects, nodesRepo, edgesRepo, surgicalFills);
}

const PROJECT_ID = "00000000-0000-4000-8000-0000000000ff";

describe("CodegenService.apiDoc — baseline (no AI)", () => {
  it("returns the deterministic OpenAPI doc with paths and source 'deterministic'", async () => {
    const service = makeService([usersController()]);
    const result = await service.apiDoc(PROJECT_ID, "baseline");

    expect(result.source).toBe("deterministic");
    expect(typeof result.aiConfigured).toBe("boolean");
    expect(result.doc.openapi).toMatch(/^3\.1/);
    expect(Object.keys(result.doc.paths).length).toBeGreaterThan(0);
    expect(result.doc.paths["/users"]?.post).toBeTruthy();
    expect(result.doc.paths["/users/{id}"]?.get).toBeTruthy();
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * AI Documentize grounding (Task 4). The LLM itself is non-deterministic, so
 * instead of driving a live agent we unit-test the grounded apply-helper the
 * agent's tool calls funnel through. The guarantee under test: the helper only
 * mutates EXISTING operations; an unknown operationId is a no-op that never
 * adds a path or operation (the agent can annotate but can never invent API).
 * ──────────────────────────────────────────────────────────────────────── */
describe("aiDocumentizeOpenApi grounding — applyDescribeOperation", () => {
  it("sets summary/description only when the operationId exists; unknown ids are no-ops", () => {
    const doc = projectOpenApi(buildCodeGraph([usersController()], []));
    const post = doc.paths["/users"]!.post as { operationId: string; summary?: string; description?: string };
    const existingId = post.operationId;
    const pathsBefore = JSON.stringify(doc.paths);

    const hit = applyDescribeOperation(doc, {
      operationId: existingId,
      summary: "Create a user",
      description: "Creates a new user account and returns it.",
    });
    expect(hit.ok).toBe(true);
    const after = doc.paths["/users"]!.post as { summary?: string; description?: string };
    expect(after.summary).toBe("Create a user");
    expect(after.description).toBe("Creates a new user account and returns it.");

    const miss = applyDescribeOperation(doc, { operationId: "no_such_operation", summary: "ghost" });
    expect(miss.ok).toBe(false);
    // The doc keeps exactly the same paths/operations — nothing invented.
    expect(JSON.stringify(doc.paths)).not.toContain("ghost");
    expect(Object.keys(doc.paths)).toEqual(Object.keys(JSON.parse(pathsBefore)));
  });
});
