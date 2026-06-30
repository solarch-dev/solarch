import { z } from "zod";

export const CreateTabSchema = z.object({
  name: z.string().min(1),
  moduleNodeId: z.string().uuid().optional(),
}).strict();

export const UpdateTabSchema = z.object({
  name: z.string().min(1).optional(),
  order: z.number().int().nonnegative().optional(),
}).strict();

export const ReferenceSchema = z.object({
  x: z.number(),
  y: z.number(),
}).strict();

export const LayoutSchema = z.object({
  items: z.array(z.object({
    nodeId: z.string().uuid(),
    x: z.number(),
    y: z.number(),
  }).strict()).min(1),
}).strict();

export type CreateTabInput = z.infer<typeof CreateTabSchema>;
export type UpdateTabInput = z.infer<typeof UpdateTabSchema>;
export type ReferenceInput = z.infer<typeof ReferenceSchema>;
export type LayoutInput = z.infer<typeof LayoutSchema>;

export interface StoredTab {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  order: number;
  moduleNodeId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Bir sekmenin render içeriği: pozisyonlu node'lar + aralarındaki edge'ler. */
export interface TabGraphMember {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  position: { x: number; y: number };
  version: number; // optimistic concurrency — frontend autosave bunu expectedVersion olarak gönderir
  isReference: boolean;
  origin?: string; // referans ise node'un ev sekmesi (homeTabId)
  // İmplementasyon sayaçları (CLI/eklenti raporu) — canvas doluluk rozeti.
  implTotal?: number;
  implFilled?: number;
  implAi?: number;
}
export interface TabGraphEdge {
  id: string;
  kind: string;
  sourceNodeId: string;
  targetNodeId: string;
}
export interface TabGraph {
  tab: StoredTab;
  nodes: TabGraphMember[];
  edges: TabGraphEdge[];
}
