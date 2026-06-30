import { z } from "zod";

export const ProjectStatusSchema = z.enum(["draft", "active", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string(), // may be empty
  status: ProjectStatusSchema,
  // Ownership / multi-tenancy (ownerId from LocalAuthGuard or API key)
  ownerId: z.string(),
  orgId: z.string().nullable(), // reserved for workspace scoping; null in OSS edition
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type Project = z.infer<typeof ProjectSchema>;
