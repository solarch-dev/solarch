import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { EdgePropertiesSchema } from "../schemas/edge.schema";

// kind / source / target immutable — verilirse service ERR_EDGE_IMMUTABLE reddeder.
export const UpdateEdgeSchema = z.object({
  properties: EdgePropertiesSchema.optional(),
  kind: z.string().optional(),
  sourceNodeId: z.string().optional(),
  targetNodeId: z.string().optional(),
}).strict();

export type UpdateEdgeInput = z.infer<typeof UpdateEdgeSchema>;

export class UpdateEdgeDto extends createZodDto(UpdateEdgeSchema) {}
