import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { EdgeKindSchema } from "../schemas/edge.schema";

// Pre-check için minimal payload — sadece source + target + kind.
// Phase 2A: nodes-exist + kind validity. Phase 2B: rules engine.
export const ValidateEdgeSchema = z.object({
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  kind: EdgeKindSchema,
}).strict();

export type ValidateEdgeInput = z.infer<typeof ValidateEdgeSchema>;

export class ValidateEdgeDto extends createZodDto(ValidateEdgeSchema) {}
