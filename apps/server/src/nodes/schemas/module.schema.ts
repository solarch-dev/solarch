import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

export const ModuleNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Module"),
  properties: z.object({
    ModuleName: z.string().min(1),
    Description: z.string().min(1),
    StrictBoundaries: z.boolean(),
    ExposedServices: z.array(z.string().min(1)).default([]).describe("exposed → Service node Names (public API)"),
    Dependencies: z.array(z.string().min(1)).default([]).describe("depended-on → Module node Names"),
  }).strict(),
}).strict();

export type ModuleNode = z.infer<typeof ModuleNodeSchema>;
