import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { ProjectStatusSchema } from "../schemas/project.schema";

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  status: ProjectStatusSchema.optional(),
}).strict();

export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export class UpdateProjectDto extends createZodDto(UpdateProjectSchema) {}
