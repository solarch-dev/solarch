import { z } from "zod";

export const ProjectStatusSchema = z.enum(["draft", "active", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string(), // boş olabilir
  status: ProjectStatusSchema,
  // ── Sahiplik / çok-kiracılık (Clerk) ──
  ownerId: z.string(), // projeyi oluşturan Clerk user id
  orgId: z.string().nullable(), // aktif Clerk org (workspace) id; kişisel projede null
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type Project = z.infer<typeof ProjectSchema>;
