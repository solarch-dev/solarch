import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { EdgeKindSchema } from "../../edges/schemas/edge.schema";

// mutations.nodes[]: tempId + type + properties (kind-specific validation
// GraphService'te NodeSchema ile yapılır). edges[]: tempId referansları.
const MutationNodeSchema = z.object({
  tempId: z.string().min(1),
  type: z.string().min(1),
  properties: z.record(z.unknown()),
}).strict();

// Edge uçları iki biçimden biri: tempId (batch içi yeni node) VEYA id (mevcut
// cloud node UUID'si). Her uç için tam olarak biri verilmeli — CLI push bu
// köprüyle yeni node'ları mevcut grafa bağlar.
const MutationEdgeSchema = z.object({
  sourceTempId: z.string().min(1).optional(),
  sourceId: z.string().uuid().optional(),
  targetTempId: z.string().min(1).optional(),
  targetId: z.string().uuid().optional(),
  edgeType: EdgeKindSchema,
  label: z.string().optional(),
}).strict()
  .refine((e) => (e.sourceTempId ? 1 : 0) + (e.sourceId ? 1 : 0) === 1, {
    message: "Exactly one of sourceTempId / sourceId is required.",
    path: ["sourceTempId"],
  })
  .refine((e) => (e.targetTempId ? 1 : 0) + (e.targetId ? 1 : 0) === 1, {
    message: "Exactly one of targetTempId / targetId is required.",
    path: ["targetTempId"],
  });

export const ApplyGraphSchema = z.object({
  tabId: z.string().uuid().optional(), // üretilen node'ların ev sekmesi (verilmezse default)
  /** Çatışma koruması: istemcinin delta hesapladığı graf revizyonu. Verilirse
   *  ve sunucudaki graphRevision farklıysa hiçbir şey yazılmadan 409 dönülür. */
  baseRevision: z.number().int().nonnegative().optional(),
  mutations: z.object({
    nodes: z.array(MutationNodeSchema),
    edges: z.array(MutationEdgeSchema),
  }).strict(),
}).strict();

export type ApplyGraphInput = z.infer<typeof ApplyGraphSchema>;

export class ApplyGraphDto extends createZodDto(ApplyGraphSchema) {}
