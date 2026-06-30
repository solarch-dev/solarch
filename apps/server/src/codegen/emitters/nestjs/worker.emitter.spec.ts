import { describe, it, expect } from "vitest";
import { emitWorker } from "./worker.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ── Fixture helpers ──────────────────────────────────────────────── */
const PROJECT = "00000000-0000-4000-8000-000000000000";
const TAB = "22222222-2222-4222-8222-222222222222";

function node(type: StoredNode["type"], id: string, properties: Record<string, unknown>): StoredNode {
  return {
    id,
    type,
    projectId: PROJECT,
    positionX: 0,
    positionY: 0,
    homeTabId: TAB,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function edge(id: string, kind: EdgeKind, sourceNodeId: string, targetNodeId: string): StoredEdge {
  return {
    id,
    projectId: PROJECT,
    sourceNodeId,
    targetNodeId,
    kind,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: false },
  };
}

function ctxFrom(nodes: StoredNode[], edges: StoredEdge[]): EmitterContext {
  return { graph: buildCodeGraph(nodes, edges), target: "nestjs" };
}

/* ── ID'ler ─────────────────────────────────────────────────────────────── */
const WORKER = "30000000-0000-4000-8000-000000000001";
const SVC = "30000000-0000-4000-8000-000000000002";
const SVC2 = "30000000-0000-4000-8000-000000000003";
const CACHE = "30000000-0000-4000-8000-000000000004";
const CTRL = "30000000-0000-4000-8000-000000000005";

/* ── Node fixtures ──────────────────────────────────────────────────── */
const thumbnailService = node("Service", SVC, {
  ServiceName: "ThumbnailService",
  Description: "Thumbnail business logic",
  IsTransactionScoped: false,
  Dependencies: [],
  Methods: [
    {
      MethodName: "generate",
      Visibility: "public",
      Parameters: [],
      ReturnType: "void",
      IsAsync: true,
      Throws: [],
    },
  ],
});

// Worker'i bir feature'a dusurmek icin onu CALLS eden bir Controller-Service
// zinciri kuruyoruz: ThumbnailController -> ThumbnailService -> (feature "thumbnail").
const thumbnailController = node("Controller", CTRL, {
  ControllerName: "ThumbnailController",
  Description: "Thumbnail endpoints",
  BasePath: "/thumbnails",
  Endpoints: [],
});

const thumbnailWorker = node("Worker", WORKER, {
  WorkerName: "ThumbnailWorker",
  Description: "Periodically cleans old thumbnails",
  Schedule: "0 3 * * *",
  TaskToExecute: "Delete expired thumbnail records",
  TimeoutSeconds: 120,
  RetryPolicy: { MaxRetries: 3, BackoffStrategy: "exponential", DelaySeconds: 5 },
  IsEnabled: true,
});

describe("emitWorker", () => {
  it("tam worker — snapshot (@Cron, DI Service, surgical handler)", () => {
    const ctx = ctxFrom(
      [thumbnailWorker, thumbnailService, thumbnailController],
      [
        edge("e-ctrl-svc", "CALLS", CTRL, SVC),
        edge("e-worker-svc", "CALLS", WORKER, SVC),
      ],
    );
    const [file] = emitWorker(ctx.graph.byId(WORKER)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { Injectable } from "@nestjs/common";
      import { Cron } from "@nestjs/schedule";
      import { ThumbnailService } from "./thumbnail.service";

      /** Periodically cleans old thumbnails */
      @Injectable()
      export class ThumbnailWorker {
        constructor(
          private readonly thumbnailService: ThumbnailService,
        ) {}

        @Cron("0 3 * * *")
        async handleThumbnail(): Promise<void> {
          // @solarch:surgical id=30000000-0000-4000-8000-000000000001#handleThumbnail
          // Delete expired thumbnail records
          // deps: this.thumbnailService
          throw new Error("NOT_IMPLEMENTED: ThumbnailWorker.handleThumbnail");
        }
      }
      ",
        "language": "typescript",
        "path": "thumbnail/thumbnail.worker.ts",
        "surgicalMarkers": 1,
      }
    `);
  });

  it("dosya yolu ctx.filePathFor ile feature-aware (.worker.ts, rol son-eki tekrarsiz)", () => {
    const ctx = ctxFrom(
      [thumbnailWorker, thumbnailService, thumbnailController],
      [edge("e-ctrl-svc", "CALLS", CTRL, SVC), edge("e-worker-svc", "CALLS", WORKER, SVC)],
    );
    const [file] = emitWorker(ctx.graph.byId(WORKER)!, ctx);
    expect(file.path).toBe("thumbnail/thumbnail.worker.ts");
  });

  it("@nestjs/schedule Cron + @nestjs/common Injectable import edilir", () => {
    const ctx = ctxFrom([thumbnailWorker], []);
    const [file] = emitWorker(ctx.graph.byId(WORKER)!, ctx);
    expect(file.content).toContain('import { Injectable } from "@nestjs/common";');
    expect(file.content).toContain('import { Cron } from "@nestjs/schedule";');
  });

  it("@Cron(<Schedule>) cron ifadesini kullanir", () => {
    const ctx = ctxFrom([thumbnailWorker], []);
    const [file] = emitWorker(ctx.graph.byId(WORKER)!, ctx);
    expect(file.content).toContain('@Cron("0 3 * * *")');
  });

  it("Schedule bossa makul default'a duser (her gece yarisi)", () => {
    const w = node("Worker", WORKER, {
      WorkerName: "CleanupWorker",
      Description: "Temizlik",
      Schedule: "",
      TaskToExecute: "Temizlik yap",
      TimeoutSeconds: 60,
      RetryPolicy: { MaxRetries: 0 },
      IsEnabled: true,
    });
    const ctx = ctxFrom([w], []);
    const [file] = emitWorker(ctx.graph.byId(WORKER)!, ctx);
    expect(file.content).toContain('@Cron("0 0 * * *")');
  });

  it("CALLS ettigi Service'i DI eder + handler govdesinde erisilebilir (surgical deps)", () => {
    const ctx = ctxFrom(
      [thumbnailWorker, thumbnailService, thumbnailController],
      [edge("e-ctrl-svc", "CALLS", CTRL, SVC), edge("e-worker-svc", "CALLS", WORKER, SVC)],
    );
    const [file] = emitWorker(ctx.graph.byId(WORKER)!, ctx);
    expect(file.content).toContain("private readonly thumbnailService: ThumbnailService,");
    expect(file.content).toMatch(/import \{ ThumbnailService \} from ".*thumbnail\.service"/);
    expect(file.content).toContain("// deps: this.thumbnailService");
  });

  it("birden cok Service CALLS -> DEDUP + isme gore sirali DI", () => {
    const cleanupService = node("Service", SVC2, {
      ServiceName: "AuditService",
      Description: "Denetim",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        { MethodName: "log", Visibility: "public", Parameters: [], ReturnType: "void", IsAsync: true, Throws: [] },
      ],
    });
    const ctx = ctxFrom(
      [thumbnailWorker, thumbnailService, cleanupService, thumbnailController],
      [
        edge("e-ctrl-svc", "CALLS", CTRL, SVC),
        edge("e-worker-svc", "CALLS", WORKER, SVC),
        edge("e-worker-svc-dup", "CALLS", WORKER, SVC), // duplicate -> tek alan
        edge("e-worker-svc2", "CALLS", WORKER, SVC2),
      ],
    );
    const [file] = emitWorker(ctx.graph.byId(WORKER)!, ctx);
    // DEDUP: thumbnailService tek kez.
    const occurrences = file.content.split("private readonly thumbnailService").length - 1;
    expect(occurrences).toBe(1);
    // Isme gore sirali: auditService (a) thumbnailService'ten (t) FIRST.
    const auditIdx = file.content.indexOf("private readonly auditService");
    const thumbIdx = file.content.indexOf("private readonly thumbnailService");
    expect(auditIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeLessThan(thumbIdx);
  });

  it("CALLS hedefi Service degilse DI etmez (yalniz Service enjekte edilir)", () => {
    const someCache = node("Cache", CACHE, { CacheName: "ThumbnailCache" });
    const ctx = ctxFrom(
      [thumbnailWorker, someCache],
      [edge("e-worker-cache", "CALLS", WORKER, CACHE)],
    );
    const [file] = emitWorker(ctx.graph.byId(WORKER)!, ctx);
    expect(file.content).not.toContain("constructor(");
    expect(file.content).not.toContain("Cache");
  });

  it("handler icin surgical marker + NOT_IMPLEMENTED govdesi", () => {
    const ctx = ctxFrom([thumbnailWorker], []);
    const [file] = emitWorker(ctx.graph.byId(WORKER)!, ctx);
    expect(file.surgicalMarkers).toBe(1);
    expect(file.content).toContain("// @solarch:surgical id=30000000-0000-4000-8000-000000000001#handleThumbnail");
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: ThumbnailWorker.handleThumbnail");');
  });

  it("DI yoksa constructor uretilmez", () => {
    const ctx = ctxFrom([thumbnailWorker], []);
    const [file] = emitWorker(ctx.graph.byId(WORKER)!, ctx);
    expect(file.content).not.toContain("constructor(");
    // Handler yine de var.
    expect(file.content).toContain("async handleThumbnail(): Promise<void> {");
  });

  it("content ends with single newline", () => {
    const ctx = ctxFrom([thumbnailWorker], []);
    const [file] = emitWorker(ctx.graph.byId(WORKER)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMINISM: two independent graph builds -> byte-identical", () => {
    const nodes = [thumbnailWorker, thumbnailService, thumbnailController];
    const edges = [edge("e-ctrl-svc", "CALLS", CTRL, SVC), edge("e-worker-svc", "CALLS", WORKER, SVC)];
    const ctxA = ctxFrom(nodes, edges);
    const a = emitWorker(ctxA.graph.byId(WORKER)!, ctxA)[0].content;
    const ctxB = ctxFrom(nodes, edges);
    const b = emitWorker(ctxB.graph.byId(WORKER)!, ctxB)[0].content;
    expect(a).toBe(b);
  });

  it("edge-case: kayip/bicimsiz property + kopuk CALLS — throw etmez", () => {
    const bareWorker = node("Worker", WORKER, {
      WorkerName: "BareWorker",
      // Description/Schedule/TaskToExecute NONE -> savunmaci okuma bos string.
      TimeoutSeconds: 30,
      RetryPolicy: { MaxRetries: 0 },
      IsEnabled: true,
    });
    // CALLS hedefi graph'ta yok (kopuk edge).
    const ctx = ctxFrom([bareWorker], [edge("e-dangling", "CALLS", WORKER, SVC)]);
    let file: { content: string; surgicalMarkers: number; path: string } | undefined;
    expect(() => {
      file = emitWorker(ctx.graph.byId(WORKER)!, ctx)[0];
    }).not.toThrow();
    // Schedule yok -> default; kopuk CALLS -> DI yok.
    expect(file!.content).toContain('@Cron("0 0 * * *")');
    expect(file!.content).not.toContain("constructor(");
    expect(file!.content).toContain("async handleBare(): Promise<void> {");
    expect(file!.surgicalMarkers).toBe(1);
  });
});
