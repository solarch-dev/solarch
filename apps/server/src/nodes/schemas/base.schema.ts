import { z } from "zod";

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const BaseNodeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  position: PositionSchema,
  homeTabId: z.string().uuid().optional(), // node's home tab
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Optimistic concurrency — +1 on each successful update. default(1): legacy/parsed
  // objects (fixture, seed, pre-migration nodes) must not break.
  version: z.number().int().nonnegative().default(1),
  // Implementation counters (written by CLI `status --report` / VS Code extension).
  // NOT inside properties — top-level meta like position, without touching strict
  // kind schemas. Canvas badge is omitted when absent (never reported).
  implTotal: z.number().int().nonnegative().optional(),
  implFilled: z.number().int().nonnegative().optional(),
  implAi: z.number().int().nonnegative().optional(),
});

export type BaseNode = z.infer<typeof BaseNodeSchema>;
export type Position = z.infer<typeof PositionSchema>;
