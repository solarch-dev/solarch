import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

export const EnvironmentVariableNodeSchema = BaseNodeSchema.extend({
  type: z.literal("EnvironmentVariable"),
  properties: z.object({
    Key: z.string().min(1),
    Description: z.string().min(1),
    DataType: z.enum(["String", "Number", "Boolean"]),
    IsSecret: z.boolean(),
    Environment: z.array(z.enum(["Dev", "Staging", "Prod"])).min(1),
    DefaultValue: z.string().optional(),
    IsRequired: z.boolean().default(true),
    ValidationPattern: z.string().optional().describe("regex validation pattern"),
  }).strict(),
}).strict();

export type EnvironmentVariableNode = z.infer<typeof EnvironmentVariableNodeSchema>;
