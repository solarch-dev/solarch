import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { PositionSchema } from "../schemas/base.schema";

// `type` opsiyonel string — schema kabul eder, service ERR_KIND_IMMUTABLE reddeder.
// Böylece kullanıcı plan'a uygun semantik hata kodunu görür.
export const UpdateNodeSchema = z.object({
  position: PositionSchema.optional(),
  properties: z.record(z.unknown()).optional(),
  type: z.string().optional(),
  // Optimistic concurrency: client'ın gördüğü son version. Verilmezse eski
  // son-yazan-kazanır davranış (geriye uyum). Verilirse uyuşmazlıkta 409.
  expectedVersion: z.number().int().nonnegative().optional(),
}).strict();

export type UpdateNodeInput = z.infer<typeof UpdateNodeSchema>;

export class UpdateNodeDto extends createZodDto(UpdateNodeSchema) {}
