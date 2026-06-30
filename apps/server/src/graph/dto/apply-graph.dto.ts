import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { EdgeKindSchema } from "../../edges/schemas/edge.schema";

// mutations.nodes[]: tempId + type + properties (kind-specific validation
// done in GraphService via NodeSchema). edges[]: tempId references.
const MutationNodeSchema = z.object({
  tempId: z.string().min(1),
  type: z.string().min(1),
  properties: z.record(z.unknown()),
}).strict();

// Edge endpoints in one of two forms: tempId (new node in batch) OR id (existing
// cloud node UUID). Exactly one per endpoint must be given — CLI push uses this
// bridge to connect new nodes to existing graph.
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
  tabId: z.string().uuid().optional(), // home tab for generated nodes (default when omitted)
  /** Conflict protection: graph revision client used to compute delta. When set
   *  and server graphRevision differs, returns 409 without writing anything. */
  baseRevision: z.number().int().nonnegative().optional(),
  mutations: z.object({
    nodes: z.array(MutationNodeSchema),
    edges: z.array(MutationEdgeSchema),
  }).strict(),
}).strict();

export type ApplyGraphInput = z.infer<typeof ApplyGraphSchema>;

export class ApplyGraphDto extends createZodDto(ApplyGraphSchema) {}
