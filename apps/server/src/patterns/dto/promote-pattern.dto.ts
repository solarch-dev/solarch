import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const PromotePatternSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  nodeIds: z.array(z.string().uuid()).optional(),
}).strict();

export type PromotePatternInput = z.infer<typeof PromotePatternSchema>;

export class PromotePatternDto extends createZodDto(PromotePatternSchema) {}
