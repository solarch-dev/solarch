import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { ProjectStatusSchema } from "../schemas/project.schema";

// Meaningful fields only — id/createdAt/updatedAt generated server-side.
export const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  status: ProjectStatusSchema.default("draft"),
}).strict();

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}
