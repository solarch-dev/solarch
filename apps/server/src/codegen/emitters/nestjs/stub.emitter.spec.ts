import { describe, it, expect } from "vitest";
import { emitStub } from "./stub.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { NodeKind } from "../../../nodes/schemas";

/* ── Fixture helpers ──────────────────────────────────────────────── */
function node(type: NodeKind, properties: Record<string, unknown>, id: string): StoredNode {
  return {
    id,
    type,
    projectId: "00000000-0000-4000-8000-000000000000",
    positionX: 0,
    positionY: 0,
    homeTabId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function edge(kind: StoredEdge["kind"], sourceNodeId: string, targetNodeId: string, id: string): StoredEdge {
  return {
    id,
    projectId: "00000000-0000-4000-8000-000000000000",
    sourceNodeId,
    targetNodeId,
    kind,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: false },
  };
}

function ctxFor(nodes: StoredNode[], edges: StoredEdge[]): { ctx: EmitterContext } {
  const graph = buildCodeGraph(nodes, edges);
  return { ctx: { graph, target: "nestjs" } };
}

/* Fixed UUIDs — determinism + readability. */
const ID_CACHE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_SERVICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_QUEUE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ID_VIEW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ID_DANGLING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ID_APP = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ID_UI = "11111111-aaaa-4aaa-8aaa-111111111111";

const CACHE_PROPS = {
  CacheName: "UserSessionCache",
  Description: "Redis cache for session data",
  KeyPattern: "session:{userId}",
  TTL_Seconds: 3600,
  Engine: "Redis",
};

/* Cache/View now have full emitters (filePathFor routes them to .cache.ts / migration)
 * -> emitStub uses remaining out-of-scope types for stub path (stubs/...stub.ts):
 * FrontendApp / UIComponent (EXCLUDED_KINDS, default stub branch). */
const APP_PROPS = {
  AppName: "AdminWebApp",
  Description: "Admin single-page application",
  Framework: "React",
};

describe("emitStub (12 out-of-scope types — single stub emitter)", () => {
  it("FrontendApp (remaining out-of-scope) + edge summary — snapshot", () => {
    const app = node("FrontendApp", APP_PROPS, ID_APP);
    const svc = node("Service", { ServiceName: "UserService" }, ID_SERVICE);
    const queue = node("MessageQueue", { QueueName: "EventsQueue" }, ID_QUEUE);
    // Service -CALLS-> FrontendApp (incoming), FrontendApp -REQUESTS-> MessageQueue (outgoing)
    const edges = [
      edge("CALLS", ID_SERVICE, ID_APP, "10000000-0000-4000-8000-000000000001"),
      edge("REQUESTS", ID_APP, ID_QUEUE, "10000000-0000-4000-8000-000000000002"),
    ];
    const { ctx } = ctxFor([app, svc, queue], edges);
    const [file] = emitStub(ctx.graph.byId(ID_APP)!, ctx);
    // FrontendApp is NOT an injected provider -> no @Injectable(). File lives under
    // <feature>/stubs/ not feature root (don't mix with real code).
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "/**
       * FrontendApp — out-of-scope node (the v1 backend chain does not generate it).
       *
       * This file is intentionally a STUB: generated so the node is not dropped from the graph.
       * Surgical AI fills in the target behavior at the marked point below.
       */
      // @solarch:surgical id=ffffffff-ffff-4fff-8fff-ffffffffffff#stub
      // out-of-scope: FrontendApp "AdminWebApp" is not deterministically generated in v1
      // Admin single-page application
      //
      // edges:
      //   REQUESTS -> MessageQueue EventsQueue
      //   Service UserService -> CALLS (incoming)
      export class AdminWebAppStub {}
      ",
        "language": "typescript",
        "path": "user/stubs/admin-web-app.frontend-app.stub.ts",
        "surgicalMarkers": 1,
      }
    `);
  });

  it("leaves exactly 1 surgical marker", () => {
    const cache = node("Cache", CACHE_PROPS, ID_CACHE);
    const { ctx } = ctxFor([cache], []);
    const [file] = emitStub(ctx.graph.byId(ID_CACHE)!, ctx);
    expect(file.surgicalMarkers).toBe(1);
    expect(file.content).toContain(`// @solarch:surgical id=${ID_CACHE}#stub`);
  });

  it("emits exported placeholder class (not silently dropped)", () => {
    const cache = node("Cache", CACHE_PROPS, ID_CACHE);
    const { ctx } = ctxFor([cache], []);
    const [file] = emitStub(ctx.graph.byId(ID_CACHE)!, ctx);
    expect(file.content).toContain("export class UserSessionCacheStub {}");
    expect(file.language).toBe("typescript");
  });

  it("file path via filePathFor as <feature>/stubs/<kebab>.<kindkebab>.stub.ts", () => {
    // FrontendApp is a remaining out-of-scope type -> filePathFor default stub branch.
    const app = node("FrontendApp", APP_PROPS, ID_APP);
    const { ctx } = ctxFor([app], []);
    const [file] = emitStub(ctx.graph.byId(ID_APP)!, ctx);
    // Stubs not scattered at feature root; separate stubs/ subfolder (don't mix with real code).
    expect(file.path).toBe("common/stubs/admin-web-app.frontend-app.stub.ts");
    expect(file.path.includes("/stubs/")).toBe(true);
    expect(file.path.endsWith(".stub.ts")).toBe(true);
  });

  it("outgoing + incoming edges summarized with correct direction markers", () => {
    const cache = node("Cache", CACHE_PROPS, ID_CACHE);
    const svc = node("Service", { ServiceName: "UserService" }, ID_SERVICE);
    const queue = node("MessageQueue", { QueueName: "EventsQueue" }, ID_QUEUE);
    const edges = [
      edge("CACHES_IN", ID_SERVICE, ID_CACHE, "10000000-0000-4000-8000-000000000001"),
      edge("PUBLISHES", ID_CACHE, ID_QUEUE, "10000000-0000-4000-8000-000000000002"),
    ];
    const { ctx } = ctxFor([cache, svc, queue], edges);
    const [file] = emitStub(ctx.graph.byId(ID_CACHE)!, ctx);
    expect(file.content).toContain("PUBLISHES -> MessageQueue EventsQueue");
    expect(file.content).toContain("Service UserService -> CACHES_IN (incoming)");
  });

  it("EDGE-CASE: disconnected node -> 'edges: (none)'", () => {
    // UIComponent is a remaining out-of-scope type (View now emits real SQL migration).
    const ui = node("UIComponent", { ComponentName: "UserCard", Description: "User card" }, ID_UI);
    const { ctx } = ctxFor([ui], []);
    const [file] = emitStub(ctx.graph.byId(ID_UI)!, ctx);
    expect(file.content).toContain("// edges: (none)");
    expect(file.content).toContain("export class UserCardStub {}");
    // UIComponent is non-injected stub -> no @Injectable().
    expect(file.content).not.toContain("@Injectable()");
    expect(file.path).toBe("common/stubs/user-card.ui-component.stub.ts");
  });

  it("EDGE-CASE: edge with missing ref endpoint -> '(?)' (does not throw)", () => {
    const cache = node("Cache", CACHE_PROPS, ID_CACHE);
    // target node not in fixture -> resolve null -> expect "(?)".
    const edges = [edge("PUBLISHES", ID_CACHE, ID_DANGLING, "10000000-0000-4000-8000-000000000003")];
    const { ctx } = ctxFor([cache], edges);
    expect(() => emitStub(ctx.graph.byId(ID_CACHE)!, ctx)).not.toThrow();
    const [file] = emitStub(ctx.graph.byId(ID_CACHE)!, ctx);
    expect(file.content).toContain("PUBLISHES -> (?)");
  });

  it("content ends with single newline", () => {
    const cache = node("Cache", CACHE_PROPS, ID_CACHE);
    const { ctx } = ctxFor([cache], []);
    const [file] = emitStub(ctx.graph.byId(ID_CACHE)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMINISM: same node twice -> byte-identical", () => {
    const cache = node("Cache", CACHE_PROPS, ID_CACHE);
    const svc = node("Service", { ServiceName: "UserService" }, ID_SERVICE);
    const edges = [edge("CACHES_IN", ID_SERVICE, ID_CACHE, "10000000-0000-4000-8000-000000000001")];
    const { ctx } = ctxFor([cache, svc], edges);
    const a = emitStub(ctx.graph.byId(ID_CACHE)!, ctx)[0].content;
    const b = emitStub(ctx.graph.byId(ID_CACHE)!, ctx)[0].content;
    expect(a).toBe(b);
  });

  it("node without Description -> description line skipped (no throw)", () => {
    const worker = node("Worker", { WorkerName: "CleanupWorker" }, ID_VIEW);
    const { ctx } = ctxFor([worker], []);
    const [file] = emitStub(ctx.graph.byId(ID_VIEW)!, ctx);
    expect(file.content).toContain('out-of-scope: Worker "CleanupWorker"');
    expect(file.content).toContain("export class CleanupWorkerStub {}");
  });
});
