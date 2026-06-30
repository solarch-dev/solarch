import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { PositionSchema } from "../schemas/base.schema";

// `type` optional string — schema accepts, service rejects with ERR_KIND_IMMUTABLE.
// So user sees semantically correct error code per plan.
export const UpdateNodeSchema = z.object({
  position: PositionSchema.optional(),
  properties: z.record(z.unknown()).optional(),
  type: z.string().optional(),
  // Optimistic concurrency: client's last seen version. When omitted, legacy
  // last-write-wins (backward compatible). When set, mismatch -> 409.
  expectedVersion: z.number().int().nonnegative().optional(),
}).strict();

export type UpdateNodeInput = z.infer<typeof UpdateNodeSchema>;

export class UpdateNodeDto extends createZodDto(UpdateNodeSchema) {}
