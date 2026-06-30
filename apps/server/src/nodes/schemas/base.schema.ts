import { z } from "zod";

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const BaseNodeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  position: PositionSchema,
  homeTabId: z.string().uuid().optional(), // node'un ev sekmesi
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Optimistic concurrency — her başarılı update'te +1. default(1): eski/parse
  // edilen objeler (fixture, seed, migration öncesi node) kırılmasın.
  version: z.number().int().nonnegative().default(1),
  // İmplementasyon sayaçları (CLI `status --report` / VS Code eklentisi yazar).
  // properties İÇİNDE DEĞİL — strict kind şemalarına dokunmadan, position gibi
  // top-level meta. Yoksa hiç rapor edilmemiştir (canvas rozet çizmez).
  implTotal: z.number().int().nonnegative().optional(),
  implFilled: z.number().int().nonnegative().optional(),
  implAi: z.number().int().nonnegative().optional(),
});

export type BaseNode = z.infer<typeof BaseNodeSchema>;
export type Position = z.infer<typeof PositionSchema>;
