import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { EdgeKindSchema, EdgePropertiesSchema } from "../schemas/edge.schema";

// id/createdAt/updatedAt generated server-side — client does not send them.
export const CreateEdgeSchema = z.object({
  projectId: z.string().uuid(),
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  kind: EdgeKindSchema,
  properties: EdgePropertiesSchema,
}).strict();

export type CreateEdgeInput = z.infer<typeof CreateEdgeSchema>;

export class CreateEdgeDto extends createZodDto(CreateEdgeSchema) {}
