import { z } from "zod";
import { EdgeKindSchema } from "../../edges/schemas/edge.schema";

// graphJson: SAME format as GraphService.apply input (tempId-based) -> pattern
// can be applied directly later (Phase 5).
export const PatternGraphSchema = z.object({
  nodes: z.array(z.object({
    tempId: z.string().min(1),
    type: z.string().min(1),
    properties: z.record(z.unknown()),
  }).strict()).min(1),
  edges: z.array(z.object({
    sourceTempId: z.string().min(1),
    targetTempId: z.string().min(1),
    edgeType: EdgeKindSchema,
    label: z.string().optional(),
  }).strict()).default([]),
}).strict();

export const CreatePatternSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  graph: PatternGraphSchema,
}).strict();

export const SearchPatternSchema = z.object({
  query: z.string().min(1),
  k: z.number().int().positive().max(20).optional(),
  minScore: z.number().min(0).max(1).optional(),
}).strict();

export type PatternGraph = z.infer<typeof PatternGraphSchema>;
export type CreatePatternInput = z.infer<typeof CreatePatternSchema>;
export type SearchPatternInput = z.infer<typeof SearchPatternSchema>;

/** Full stored + returned Pattern (embedding not included in API response). */
export interface StoredPattern {
  id: string;
  name: string;
  description: string;
  tags: string[];
  graph: PatternGraph;
  source: "seed" | "promoted";
  createdAt: string;
}

export interface PatternSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  source: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
}
