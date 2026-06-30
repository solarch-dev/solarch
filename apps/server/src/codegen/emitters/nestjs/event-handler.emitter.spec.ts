import { describe, it, expect } from "vitest";
import { emitEventHandler } from "./event-handler.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ── Fixture yardımcıları ──────────────────────────────────────────────── */
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
const HANDLER = "10000000-0000-4000-8000-000000000001";
const QUEUE = "10000000-0000-4000-8000-000000000002";
const SVC = "10000000-0000-4000-8000-000000000003";
const CACHE = "10000000-0000-4000-8000-000000000004";

/* ── Node fixture'ları ──────────────────────────────────────────────────── */
const imageQueue = node("MessageQueue", QUEUE, {
  QueueName: "ImageJobsQueue",
  Description: "Görsel işleme kuyruğu",
  Type: "Queue",
  Provider: "RabbitMQ",
  MessageFormat: "ImageJobDto",
});

const imageService = node("Service", SVC, {
  ServiceName: "ImageService",
  Description: "Görsel iş mantığı",
  IsTransactionScoped: false,
  Dependencies: [],
  Methods: [
    {
      MethodName: "process",
      Visibility: "public",
      Parameters: [],
      ReturnType: "void",
      IsAsync: true,
      Throws: [],
    },
  ],
});

const imageCache = node("Cache", CACHE, {
  CacheName: "ImageCache",
});

// Kuyruk-tabanlı handler: ImageJobsQueue'yu dinler, ImageService'i çağırır.
const queueHandler = node("EventHandler", HANDLER, {
  HandlerName: "ImageJobEventHandler",
  Description: "Görsel işleme job'unu tüketir",
  EventName: "image.job.created",
  IsAsync: true,
  QueueRef: "ImageJobsQueue",
  RetryPolicy: { MaxRetries: 3, DelaySeconds: 10 },
  DeadLetterQueue: "ImageJobsDLQ",
});

// Olay-tabanlı handler: kuyruk YOK, sadece bir olay dinler.
const eventHandler = node("EventHandler", HANDLER, {
  HandlerName: "OrderCreatedEventHandler",
  Description: "Sipariş oluşturulduğunda tetiklenir",
  EventName: "order.created",
  IsAsync: false,
});

describe("emitEventHandler", () => {
  it("kuyruk-tabanlı (BullMQ @Processor) — snapshot", () => {
    const ctx = ctxFrom(
      [queueHandler, imageQueue, imageService, imageCache],
      [
        edge("e-sub", "SUBSCRIBES", HANDLER, QUEUE),
        edge("e-calls-svc", "CALLS", HANDLER, SVC),
        edge("e-calls-cache", "CALLS", HANDLER, CACHE),
      ],
    );
    const [file] = emitEventHandler(ctx.graph.byId(HANDLER)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { Processor, WorkerHost } from "@nestjs/bullmq";
      import { Injectable } from "@nestjs/common";
      import type { Job } from "bullmq";
      import { ImageService } from "../image/image.service";
      import { ImageCache } from "./image.cache";

      /** Görsel işleme job'unu tüketir */
      /** retry: maxRetries=3, delaySeconds=10 */
      /** dead-letter-queue: ImageJobsDLQ */
      @Processor("ImageJobsQueue")
      export class ImageJobEventHandler extends WorkerHost {
        constructor(
          private readonly imageCache: ImageCache,
          private readonly imageService: ImageService,
        ) {
          super();
        }

        async process(job: Job): Promise<void> {
          // @solarch:surgical id=10000000-0000-4000-8000-000000000001#process
          // Görsel işleme job'unu tüketir
          // Triggering queue: ImageJobsQueue.
          // deps: this.imageCache, this.imageService
          throw new Error("NOT_IMPLEMENTED: ImageJobEventHandler.process");
        }
      }
      ",
        "language": "typescript",
        "path": "common/image-job.handler.ts",
        "surgicalMarkers": 1,
      }
    `);
  });

  it("olay-tabanlı (@OnEvent) — snapshot", () => {
    const ctx = ctxFrom(
      [eventHandler, imageService],
      [edge("e-calls-svc", "CALLS", HANDLER, SVC)],
    );
    const [file] = emitEventHandler(ctx.graph.byId(HANDLER)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { Injectable } from "@nestjs/common";
      import { OnEvent } from "@nestjs/event-emitter";
      import { ImageService } from "./image.service";

      /** Sipariş oluşturulduğunda tetiklenir */
      @Injectable()
      export class OrderCreatedEventHandler {
        constructor(
          private readonly imageService: ImageService,
        ) {}

        @OnEvent("order.created")
        handleOrderCreated(payload: unknown): void {
          // @solarch:surgical id=10000000-0000-4000-8000-000000000001#handleOrderCreated
          // Sipariş oluşturulduğunda tetiklenir
          // Triggering event: order.created.
          // deps: this.imageService
          throw new Error("NOT_IMPLEMENTED: OrderCreatedEventHandler.handleOrderCreated");
        }
      }
      ",
        "language": "typescript",
        "path": "image/order-created.handler.ts",
        "surgicalMarkers": 1,
      }
    `);
  });

  it("QueueRef property'si (SUBSCRIBES edge yoksa) da kuyruk-tabanlı kola düşer", () => {
    const ctx = ctxFrom([queueHandler, imageQueue], []);
    const [file] = emitEventHandler(ctx.graph.byId(HANDLER)!, ctx);
    expect(file.content).toContain('@Processor("ImageJobsQueue")');
    expect(file.content).toContain("extends WorkerHost");
    expect(file.content).toContain("import { Processor, WorkerHost } from \"@nestjs/bullmq\";");
  });

  it("kuyruk çözülemezse (QueueRef + edge yok) olay-tabanlı kola düşer", () => {
    const orphanQueueHandler = node("EventHandler", HANDLER, {
      HandlerName: "GhostHandler",
      Description: "Kayıp kuyruk referansı",
      EventName: "ghost.event",
      IsAsync: true,
      QueueRef: "NonExistentQueue",
    });
    const ctx = ctxFrom([orphanQueueHandler], []);
    const [file] = emitEventHandler(ctx.graph.byId(HANDLER)!, ctx);
    expect(file.content).not.toContain("@Processor");
    expect(file.content).toContain('@OnEvent("ghost.event")');
    expect(file.content).toContain("@Injectable()");
  });

  it("CALLS hedefi handle/process metodunda surgical marker + NOT_IMPLEMENTED", () => {
    const ctx = ctxFrom([eventHandler, imageService], [edge("e", "CALLS", HANDLER, SVC)]);
    const [file] = emitEventHandler(ctx.graph.byId(HANDLER)!, ctx);
    expect(file.surgicalMarkers).toBe(1);
    expect(file.content).toContain("// @solarch:surgical id=");
    expect(file.content).toContain("// deps: this.imageService");
    expect(file.content).toContain(
      'throw new Error("NOT_IMPLEMENTED: OrderCreatedEventHandler.handleOrderCreated");',
    );
  });

  it("IsAsync -> Promise<void> + async; sync -> void", () => {
    const asyncCtx = ctxFrom([queueHandler, imageQueue], []);
    const asyncFile = emitEventHandler(asyncCtx.graph.byId(HANDLER)!, asyncCtx)[0];
    expect(asyncFile.content).toContain("async process(job: Job): Promise<void> {");

    const syncCtx = ctxFrom([eventHandler], []);
    const syncFile = emitEventHandler(syncCtx.graph.byId(HANDLER)!, syncCtx)[0];
    expect(syncFile.content).toContain("handleOrderCreated(payload: unknown): void {");
    expect(syncFile.content).not.toContain("async handleOrderCreated");
  });

  it("dosya yolu filePathFor ile (.handler.ts, rol son-eki tekrarsız)", () => {
    // Handler ImageService'i çağırır -> feature-inference onu "image" feature'ına
    // yerleştirir. baseNameOf("OrderCreatedEventHandler") -> "OrderCreated" ->
    // dosya kök adı "order-created", rol son-eki ("EventHandler") TEKRARLANMAZ.
    const ctx = ctxFrom([eventHandler, imageService], [edge("e", "CALLS", HANDLER, SVC)]);
    const [file] = emitEventHandler(ctx.graph.byId(HANDLER)!, ctx);
    expect(file.path).toBe("image/order-created.handler.ts");
  });

  it("dep yoksa constructor üretilmez (boş DI)", () => {
    const ctx = ctxFrom([eventHandler], []);
    const [file] = emitEventHandler(ctx.graph.byId(HANDLER)!, ctx);
    expect(file.content).not.toContain("constructor(");
  });

  it("DEDUP: aynı Service'e iki CALLS edge -> tek DI alanı", () => {
    const ctx = ctxFrom(
      [eventHandler, imageService],
      [edge("e1", "CALLS", HANDLER, SVC), edge("e2", "CALLS", HANDLER, SVC)],
    );
    const [file] = emitEventHandler(ctx.graph.byId(HANDLER)!, ctx);
    const occurrences = file.content.split("private readonly imageService").length - 1;
    expect(occurrences).toBe(1);
  });

  it("içerik tek satır sonu ile biter", () => {
    const ctx = ctxFrom([eventHandler], []);
    const [file] = emitEventHandler(ctx.graph.byId(HANDLER)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMİNİZM: iki bağımsız graph kuruluşu -> byte-identical", () => {
    const nodes = [queueHandler, imageQueue, imageService, imageCache];
    const edges = [
      edge("e-sub", "SUBSCRIBES", HANDLER, QUEUE),
      edge("e-calls-svc", "CALLS", HANDLER, SVC),
      edge("e-calls-cache", "CALLS", HANDLER, CACHE),
    ];
    const a = emitEventHandler(ctxFrom(nodes, edges).graph.byId(HANDLER)!, ctxFrom(nodes, edges)).at(0)!.content;
    const b = emitEventHandler(ctxFrom(nodes, edges).graph.byId(HANDLER)!, ctxFrom(nodes, edges)).at(0)!.content;
    expect(a).toBe(b);
  });

  it("edge-case: hiç edge/kuyruk yok — throw etmez, minimal @OnEvent handler", () => {
    const ctx = ctxFrom([eventHandler], []);
    let file: { content: string; surgicalMarkers: number } | undefined;
    expect(() => {
      file = emitEventHandler(ctx.graph.byId(HANDLER)!, ctx)[0];
    }).not.toThrow();
    expect(file!.surgicalMarkers).toBe(1);
    expect(file!.content).toContain("@OnEvent");
  });
});
