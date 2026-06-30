import { describe, it, expect } from "vitest";
import { emitMessageQueue } from "./message-queue.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ── Fixture helpers (same shape as service.emitter.spec.ts) ───────── */
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
const MQ = "30000000-0000-4000-8000-000000000001";
const DTO_JOB = "30000000-0000-4000-8000-000000000002";
const SVC = "30000000-0000-4000-8000-000000000003";

/* ── Node fixtures ──────────────────────────────────────────────────── */
const imageJobDto = node("DTO", DTO_JOB, {
  Name: "ImageJobDto",
  Description: "Production job body",
  Fields: [{ Name: "prompt", DataType: "string", IsRequired: true, IsArray: false }],
});

const imageQueue = node("MessageQueue", MQ, {
  QueueName: "ImageMessageQueue",
  Description: "Image production queue",
  Type: "Queue",
  Provider: "Generic",
  MessageFormat: "ImageJobDto",
  DeliveryGuarantee: "at-least-once",
  MaxRetries: 3,
  DeadLetterQueue: "image-dlq",
});

// Kuyrugu kullanan bir Service -> feature inference kuyrugu "image" feature'ina ceker.
const imageService = node("Service", SVC, {
  ServiceName: "ImageService",
  Description: "Image business logic",
  IsTransactionScoped: false,
  Dependencies: [],
  Methods: [],
});

describe("emitMessageQueue", () => {
  it("tam producer — snapshot (BullMQ Queue DI, queue sabiti, payload DTO, surgical publish)", () => {
    const ctx = ctxFrom([imageQueue, imageJobDto, imageService], [edge("e-mq", "CALLS", SVC, MQ)]);
    const [file] = emitMessageQueue(ctx.graph.byId(MQ)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { InjectQueue } from "@nestjs/bullmq";
      import { Injectable } from "@nestjs/common";
      import type { Queue } from "bullmq";
      import type { ImageJobDto } from "../common/dto/image-job.dto";

      /** "MessageQueue" queue name — single source of truth shared between BullModule.registerQueue and @InjectQueue. */
      export const IMAGE_MESSAGE_QUEUE = "ImageMessageQueue";

      /** Image production queue */
      @Injectable()
      export class ImageMessageQueue {
        constructor(
          @InjectQueue(IMAGE_MESSAGE_QUEUE) private readonly queue: Queue,
        ) {}

        /** Adds a message/job to the queue. */
        async publish(payload: ImageJobDto): Promise<void> {
          // @solarch:surgical id=30000000-0000-4000-8000-000000000001#publish
          // Adds a job to the queue (BullMQ producer). ImageMessageQueue
          // delivery: at-least-once
          // maxRetries: 3
          // dead-letter: image-dlq
          // deps: this.queue
          // @solarch:filled by=codegen
          await this.queue.add("publish", payload);
        }
      }
      ",
        "language": "typescript",
        "path": "image/image.queue.ts",
        "surgicalMarkers": 0,
      }
    `);
  });

  it("BullMQ producer iskeleti: @Injectable, @InjectQueue, Queue tip importu", () => {
    const ctx = ctxFrom([imageQueue, imageJobDto, imageService], [edge("e-mq", "CALLS", SVC, MQ)]);
    const [file] = emitMessageQueue(ctx.graph.byId(MQ)!, ctx);
    expect(file.content).toContain('import { Injectable } from "@nestjs/common";');
    expect(file.content).toContain('import { InjectQueue } from "@nestjs/bullmq";');
    expect(file.content).toContain('import type { Queue } from "bullmq";');
    expect(file.content).toContain("@Injectable()");
    expect(file.content).toContain("export class ImageMessageQueue {");
  });

  it("queue adi sabiti @InjectQueue + (Wire) registerQueue icin TEK SOURCE", () => {
    const ctx = ctxFrom([imageQueue, imageJobDto, imageService], [edge("e-mq", "CALLS", SVC, MQ)]);
    const [file] = emitMessageQueue(ctx.graph.byId(MQ)!, ctx);
    expect(file.content).toContain('export const IMAGE_MESSAGE_QUEUE = "ImageMessageQueue";');
    expect(file.content).toContain("@InjectQueue(IMAGE_MESSAGE_QUEUE) private readonly queue: Queue,");
  });

  it("publish GERCEK govde tasir (queue.add) + marker + codegen-dolu damgasi (fill sayimi tutarli)", () => {
    const ctx = ctxFrom([imageQueue, imageJobDto, imageService], [edge("e-mq", "CALLS", SVC, MQ)]);
    const [file] = emitMessageQueue(ctx.graph.byId(MQ)!, ctx);
    expect(file.content).toContain("async publish(payload: ImageJobDto): Promise<void> {");
    expect(file.content).toContain('await this.queue.add("publish", payload);');
    expect(file.content).toContain(`// @solarch:surgical id=${MQ}#publish`);
    expect(file.content).toContain("// deps: this.queue");
    // Govde codegen tarafindan tam uretildi → @solarch:filled by=codegen damgasi.
    expect(file.content).toContain("// @solarch:filled by=codegen");
    // "Doldurulacak" SAYILMAZ (codegen-dolu) → 0; aksi halde 71 gosterilir 69 doldurulur.
    expect(file.surgicalMarkers).toBe(0);
  });

  it("MessageFormat -> DTO import edilir (payload tipi DTO sinifi)", () => {
    const ctx = ctxFrom([imageQueue, imageJobDto, imageService], [edge("e-mq", "CALLS", SVC, MQ)]);
    const [file] = emitMessageQueue(ctx.graph.byId(MQ)!, ctx);
    expect(file.content).toMatch(/import type \{ ImageJobDto \} from ".*image-job\.dto"/);
  });

  it("dosya yolu feature/<base>.queue.ts (rol son-eki TEKRARSIZ)", () => {
    const ctx = ctxFrom([imageQueue, imageJobDto, imageService], [edge("e-mq", "CALLS", SVC, MQ)]);
    const [file] = emitMessageQueue(ctx.graph.byId(MQ)!, ctx);
    // baseNameOf: "ImageMessageQueue" -> "Image" -> image.queue.ts.
    expect(file.path).toBe("image/image.queue.ts");
  });

  it("content ends with single newline", () => {
    const ctx = ctxFrom([imageQueue, imageJobDto, imageService], [edge("e-mq", "CALLS", SVC, MQ)]);
    const [file] = emitMessageQueue(ctx.graph.byId(MQ)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMINISM: two independent graph builds -> byte-identical", () => {
    const nodes = [imageQueue, imageJobDto, imageService];
    const edges = [edge("e-mq", "CALLS", SVC, MQ)];
    const a = emitMessageQueue(buildCodeGraph(nodes, edges).byId(MQ)!, ctxFrom(nodes, edges))[0].content;
    const b = emitMessageQueue(buildCodeGraph(nodes, edges).byId(MQ)!, ctxFrom(nodes, edges))[0].content;
    expect(a).toBe(b);
  });

  it("'Queue' son-ekli ad da calisir (ImageJobsQueue -> ImageJobs base)", () => {
    const q = node("MessageQueue", MQ, {
      QueueName: "ImageJobsQueue",
      Description: "Jobs",
      Type: "Queue",
      Provider: "Generic",
      MessageFormat: "ImageJobDto",
    });
    const ctx = ctxFrom([q, imageJobDto], []);
    const [file] = emitMessageQueue(ctx.graph.byId(MQ)!, ctx);
    // baseNameOf: "ImageJobsQueue" -> "ImageJobs" -> image-jobs.queue.ts.
    expect(file.path).toContain("image-jobs.queue.ts");
    expect(file.content).toContain('export const IMAGE_JOBS_QUEUE = "ImageJobsQueue";');
    expect(file.content).toContain("export class ImageJobsQueue {");
  });

  /* ── EDGE-CASE: kayip/bos MessageFormat — throw etmez, unknown'a duser ─── */
  it("edge-case: cozulemeyen MessageFormat -> payload unknown, import yok, throw yok", () => {
    const q = node("MessageQueue", MQ, {
      QueueName: "OrphanQueue",
      Description: "Yetim kuyruk",
      Type: "Topic",
      Provider: "Generic",
      MessageFormat: "GhostDto",
    });
    const ctx = ctxFrom([q], []);
    let file: { content: string; path: string; surgicalMarkers: number } | undefined;
    expect(() => {
      file = emitMessageQueue(ctx.graph.byId(MQ)!, ctx)[0];
    }).not.toThrow();
    expect(file!.content).toContain("async publish(payload: unknown): Promise<void> {");
    expect(file!.content).not.toContain("import type { GhostDto }");
    // queue.add govdesi yine GERCEK + tek surgical marker.
    expect(file!.content).toContain('await this.queue.add("publish", payload);');
    expect(file!.surgicalMarkers).toBe(0); // codegen-dolu (publish tam uretildi) → doldurulacak sayisi 0
  });

  it("edge-case: MessageFormat hic yok -> payload unknown", () => {
    const q = node("MessageQueue", MQ, {
      QueueName: "BareQueue",
      Description: "Bare",
      Type: "Queue",
      Provider: "Generic",
      MessageFormat: "",
    });
    const ctx = ctxFrom([q], []);
    const [file] = emitMessageQueue(ctx.graph.byId(MQ)!, ctx);
    expect(file.content).toContain("async publish(payload: unknown): Promise<void> {");
  });
});
