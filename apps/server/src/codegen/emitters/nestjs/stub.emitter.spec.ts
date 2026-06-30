import { describe, it, expect } from "vitest";
import { emitStub } from "./stub.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { NodeKind } from "../../../nodes/schemas";

/* ── Fixture yardımcıları ──────────────────────────────────────────────── */
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

/* Sabit UUID'ler — determinizm + okunabilirlik. */
const ID_CACHE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_SERVICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_QUEUE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ID_VIEW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ID_DANGLING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ID_APP = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ID_UI = "11111111-aaaa-4aaa-8aaa-111111111111";

const CACHE_PROPS = {
  CacheName: "UserSessionCache",
  Description: "Oturum verisi için Redis cache",
  KeyPattern: "session:{userId}",
  TTL_Seconds: 3600,
  Engine: "Redis",
};

/* Cache/View ARTIK tam emitter'lı (filePathFor onları .cache.ts / migration'a
 * yönlendirir) -> emitStub stub-yolu (stubs/...stub.ts) için kapsam-dışı KALAN
 * tipler kullanılır: FrontendApp / UIComponent (EXCLUDED_KINDS, default stub kolu). */
const APP_PROPS = {
  AppName: "AdminWebApp",
  Description: "Yönetici tek-sayfa uygulaması",
  Framework: "React",
};

describe("emitStub (kapsam-dışı 12 tip — tek stub emitter)", () => {
  it("FrontendApp (kapsam-dışı KALAN) + edge özeti — snapshot", () => {
    const app = node("FrontendApp", APP_PROPS, ID_APP);
    const svc = node("Service", { ServiceName: "UserService" }, ID_SERVICE);
    const queue = node("MessageQueue", { QueueName: "EventsQueue" }, ID_QUEUE);
    // Service -CALLS-> FrontendApp (gelen), FrontendApp -REQUESTS-> MessageQueue (çıkan)
    const edges = [
      edge("CALLS", ID_SERVICE, ID_APP, "10000000-0000-4000-8000-000000000001"),
      edge("REQUESTS", ID_APP, ID_QUEUE, "10000000-0000-4000-8000-000000000002"),
    ];
    const { ctx } = ctxFor([app, svc, queue], edges);
    const [file] = emitStub(ctx.graph.byId(ID_APP)!, ctx);
    // FrontendApp enjekte edilen bir provider DEĞİL -> @Injectable() YOK. Dosya
    // feature kökünde DEĞİL, <feature>/stubs/ altında (gerçek kod ile karışmasın).
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
      // Yönetici tek-sayfa uygulaması
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

  it("tam olarak 1 surgical marker bırakır", () => {
    const cache = node("Cache", CACHE_PROPS, ID_CACHE);
    const { ctx } = ctxFor([cache], []);
    const [file] = emitStub(ctx.graph.byId(ID_CACHE)!, ctx);
    expect(file.surgicalMarkers).toBe(1);
    expect(file.content).toContain(`// @solarch:surgical id=${ID_CACHE}#stub`);
  });

  it("export edilen placeholder sınıf üretir (sessizce düşmez)", () => {
    const cache = node("Cache", CACHE_PROPS, ID_CACHE);
    const { ctx } = ctxFor([cache], []);
    const [file] = emitStub(ctx.graph.byId(ID_CACHE)!, ctx);
    expect(file.content).toContain("export class UserSessionCacheStub {}");
    expect(file.language).toBe("typescript");
  });

  it("dosya yolu filePathFor ile <feature>/stubs/<kebab>.<kindkebab>.stub.ts", () => {
    // FrontendApp kapsam-dışı KALAN bir tip -> filePathFor default stub kolu.
    const app = node("FrontendApp", APP_PROPS, ID_APP);
    const { ctx } = ctxFor([app], []);
    const [file] = emitStub(ctx.graph.byId(ID_APP)!, ctx);
    // Stub'lar feature KÖKÜNE saçılmaz; ayrı stubs/ alt klasöründe (gerçek kod
    // ile karışmasın).
    expect(file.path).toBe("common/stubs/admin-web-app.frontend-app.stub.ts");
    expect(file.path.includes("/stubs/")).toBe(true);
    expect(file.path.endsWith(".stub.ts")).toBe(true);
  });

  it("çıkan + gelen edge'ler doğru yön işaretiyle özetlenir", () => {
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

  it("EDGE-CASE: bağlantısız node -> 'edges: (yok)'", () => {
    // UIComponent kapsam-dışı KALAN bir tip (View artık gerçek SQL migration üretir).
    const ui = node("UIComponent", { ComponentName: "UserCard", Description: "Kullanıcı kartı" }, ID_UI);
    const { ctx } = ctxFor([ui], []);
    const [file] = emitStub(ctx.graph.byId(ID_UI)!, ctx);
    expect(file.content).toContain("// edges: (none)");
    expect(file.content).toContain("export class UserCardStub {}");
    // UIComponent enjekte edilmeyen bir stub -> @Injectable() YOK.
    expect(file.content).not.toContain("@Injectable()");
    expect(file.path).toBe("common/stubs/user-card.ui-component.stub.ts");
  });

  it("EDGE-CASE: kayıp ref'li edge ucu -> '(?)' (throw etmez)", () => {
    const cache = node("Cache", CACHE_PROPS, ID_CACHE);
    // hedef node fixture'da YOK -> resolve null -> "(?)" beklenir.
    const edges = [edge("PUBLISHES", ID_CACHE, ID_DANGLING, "10000000-0000-4000-8000-000000000003")];
    const { ctx } = ctxFor([cache], edges);
    expect(() => emitStub(ctx.graph.byId(ID_CACHE)!, ctx)).not.toThrow();
    const [file] = emitStub(ctx.graph.byId(ID_CACHE)!, ctx);
    expect(file.content).toContain("PUBLISHES -> (?)");
  });

  it("içerik tek satır sonu ile biter", () => {
    const cache = node("Cache", CACHE_PROPS, ID_CACHE);
    const { ctx } = ctxFor([cache], []);
    const [file] = emitStub(ctx.graph.byId(ID_CACHE)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMİNİZM: aynı node iki kez -> byte-identical", () => {
    const cache = node("Cache", CACHE_PROPS, ID_CACHE);
    const svc = node("Service", { ServiceName: "UserService" }, ID_SERVICE);
    const edges = [edge("CACHES_IN", ID_SERVICE, ID_CACHE, "10000000-0000-4000-8000-000000000001")];
    const { ctx } = ctxFor([cache, svc], edges);
    const a = emitStub(ctx.graph.byId(ID_CACHE)!, ctx)[0].content;
    const b = emitStub(ctx.graph.byId(ID_CACHE)!, ctx)[0].content;
    expect(a).toBe(b);
  });

  it("Description olmayan node -> açıklama satırı atlanır (throw yok)", () => {
    const worker = node("Worker", { WorkerName: "CleanupWorker" }, ID_VIEW);
    const { ctx } = ctxFor([worker], []);
    const [file] = emitStub(ctx.graph.byId(ID_VIEW)!, ctx);
    expect(file.content).toContain('out-of-scope: Worker "CleanupWorker"');
    expect(file.content).toContain("export class CleanupWorkerStub {}");
  });
});
