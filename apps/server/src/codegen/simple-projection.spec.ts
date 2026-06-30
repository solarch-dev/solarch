/** simple-projection — CodeGraph -> Simple View (non-dev) projection.
 *  System map (feature boxes + dependsOn arrows) is FULLY deterministic;
 *  capabilities are honestly derived from endpoints + RequiresAuth guard. */

import { describe, it, expect } from "vitest";
import { buildCodeGraph } from "./ir";
import { projectSimpleView, projectSimpleSketchModel } from "./simple-projection";
import type { StoredNode } from "../nodes/nodes.repository";
import type { StoredEdge } from "../edges/edges.repository";
import type { NodeKind } from "../nodes/schemas";
import type { EdgeKind } from "../edges/schemas/edge.schema";

let idSeq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, "0")}`;

function node(type: NodeKind, properties: Record<string, unknown>): StoredNode {
  return {
    id: uuid(), type, projectId: "11111111-1111-4111-8111-111111111111",
    positionX: 0, positionY: 0, homeTabId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", version: 1, properties,
  };
}
function edge(kind: EdgeKind, s: StoredNode, t: StoredNode): StoredEdge {
  return {
    id: uuid(), projectId: "11111111-1111-4111-8111-111111111111",
    sourceNodeId: s.id, targetNodeId: t.id, kind,
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", properties: { IsAsync: false },
  };
}

/** auth (register, public) + messaging (send message, authed; uses UserRepository
 *  cross-feature -> messaging dependsOn auth). */
function fixture() {
  const authCtrl = node("Controller", {
    ControllerName: "AuthController", Description: "x", BaseRoute: "/auth",
    Endpoints: [{ HttpMethod: "POST", Route: "/register", RequiresAuth: false, RequestDTORef: "RegisterDto" }],
  });
  const authSvc = node("Service", { ServiceName: "AuthService", Description: "x", Dependencies: [], Methods: [] });
  const userRepo = node("Repository", { RepositoryName: "UserRepository", Description: "x", EntityReference: "User", CustomQueries: [] });
  const userModel = node("Model", { ClassName: "User", Description: "x", Fields: [] });

  const msgCtrl = node("Controller", {
    ControllerName: "MessageController", Description: "x", BaseRoute: "/messages",
    Endpoints: [
      { HttpMethod: "POST", Route: "/messages", RequiresAuth: true, RequestDTORef: "SendMessageDto", ResponseDTORef: "MessageDto" },
      { HttpMethod: "GET", Route: "/messages", RequiresAuth: true, ReturnsCollection: true },
    ],
  });
  const msgSvc = node("Service", { ServiceName: "MessageService", Description: "x", Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }], Methods: [] });
  const msgRepo = node("Repository", { RepositoryName: "MessageRepository", Description: "x", EntityReference: "Message", CustomQueries: [] });
  const msgModel = node("Model", { ClassName: "Message", Description: "x", Fields: [] });

  const edges = [
    edge("CALLS", authCtrl, authSvc),
    edge("CALLS", authSvc, userRepo),
    edge("CALLS", msgCtrl, msgSvc),
    edge("CALLS", msgSvc, msgRepo),
  ];
  return buildCodeGraph([authCtrl, authSvc, userRepo, userModel, msgCtrl, msgSvc, msgRepo, msgModel], edges);
}

describe("projectSimpleView — system map (deterministic)", () => {
  it("feature boxes + tier (auth base=0, messaging=1)", () => {
    const m = projectSimpleView(fixture());
    const auth = m.features.find((f) => f.slug === "auth")!;
    const msg = m.features.find((f) => f.slug === "messaging")! ?? m.features.find((f) => f.slug === "message")!;
    expect(auth).toBeTruthy();
    expect(auth.title).toBe("Auth");
    expect(auth.tier).toBe(0);
    expect(msg.tier).toBe(1); // messaging uses UserRepository (auth) -> tier+1
  });

  it("arrow: messaging → auth 'uses' (dependsOn)", () => {
    const m = projectSimpleView(fixture());
    const msgSlug = m.features.find((f) => f.slug === "messaging" || f.slug === "message")!.slug;
    const arr = m.arrows.find((a) => a.from === msgSlug && a.to === "auth");
    expect(arr).toBeTruthy();
    expect(arr!.label).toBe("uses");
  });

  it("DETERMINISM: same graph twice → identical projection", () => {
    const g = fixture();
    expect(JSON.stringify(projectSimpleView(g))).toBe(JSON.stringify(projectSimpleView(g)));
  });
});

describe("projectSimpleView — capabilities + logic flow", () => {
  it("POST endpoint → write capability (actor=logged-in, data=writes)", () => {
    const m = projectSimpleView(fixture());
    const msg = m.features.find((f) => f.slug === "messaging" || f.slug === "message")!;
    expect(msg.capabilityCount).toBe(2);
    const post = msg.capabilities.find((c) => c.action.includes("Creates") || c.action.includes("Message"))!;
    expect(post.actor).toBe("Signed-in user");
    expect(post.data[0]).toEqual({ access: "writes", label: "Message" });
    expect(post.hidden).toBeGreaterThanOrEqual(2); // request + response DTO
  });

  it("authed feature → ONE shared 'Signed in?' gate + operation leaves (deduped, no Start/End)", () => {
    const m = projectSimpleView(fixture());
    const msg = m.features.find((f) => f.slug === "messaging" || f.slug === "message")!;
    const fg = msg.flowGraph!;
    // The auth check appears EXACTLY ONCE for the whole feature (no per-endpoint repetition).
    const gates = fg.nodes.filter((n) => n.kind === "decision" && n.label === "Signed in?");
    expect(gates.length).toBe(1);
    // Both operations are process leaves hanging off the single gate.
    expect(fg.nodes.filter((n) => n.kind === "process").length).toBe(2);
    expect(fg.edges.filter((e) => e.from === "gate").length).toBe(2);
    // No Start/End ceremony, no per-operation outcome terminals.
    expect(fg.nodes.some((n) => n.kind === "terminal" || n.kind === "end")).toBe(false);
  });

  it("structured model — colored groups + member ops + GROUP-level cross-feature edge", () => {
    const m = projectSimpleSketchModel(fixture());
    // one COLORED group per feature; NO separate feature node (the group region IS the feature box).
    expect(m.groups.some((g) => g.id === "auth" && !!g.color)).toBe(true);
    const msgGroup = m.groups.find((g) => g.id === "messaging" || g.id === "message")!;
    expect(msgGroup).toBeTruthy();
    expect(m.nodes.some((n) => n.kind === "feature")).toBe(false);
    // op nodes hang under their feature group; the gate is a decision kind.
    expect(m.nodes.some((n) => n.kind === "decision")).toBe(true);
    expect(m.nodes.every((n) => !n.group || m.groups.some((g) => g.id === n.group))).toBe(true);
    // cross-feature dependency arrow connects the GROUP ids (the group acts as a box).
    expect(m.edges.some((e) => e.from === msgGroup.id && e.to === "auth" && e.label === "uses")).toBe(true);
    // every edge endpoint is a real node id OR a group id.
    const ids = new Set([...m.nodes.map((n) => n.id), ...m.groups.map((g) => g.id)]);
    expect(m.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
  });

  it("public feature → NO auth gate, but its action still flows to the data it saves", () => {
    const m = projectSimpleView(fixture());
    const auth = m.features.find((f) => f.slug === "auth")!;
    const fg = auth.flowGraph!;
    // No fabricated auth check for a public feature.
    expect(fg.nodes.some((n) => n.kind === "decision")).toBe(false);
    const procs = fg.nodes.filter((n) => n.kind === "process");
    expect(procs.length).toBe(1); // POST /register
    expect(fg.edges.some((e) => e.from === "gate")).toBe(false); // not gated
    // DFD enrichment: a data store + a labeled "Saves" flow from the action into it.
    const store = fg.nodes.find((n) => n.kind === "data")!;
    expect(store).toBeTruthy();
    const flow = fg.edges.find((e) => e.from === procs[0]!.id && e.to === store.id)!;
    expect(flow.label).toBe("Saves");
    expect(auth.capabilities[0]!.actor).toBe("Any user");
  });
});
