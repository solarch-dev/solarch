import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const CustomQuerySchema = z.object({
  QueryName: z.string().min(1),
  QueryType: z.enum(["find", "findOne", "aggregate", "raw", "custom"]).default("custom"),
  Parameters: z.array(z.object({ Name: z.string().min(1), Type: z.string().min(1) })).default([]),
  ReturnType: z.string().min(1),
  Description: z.string().optional(),
}).strict();

export const RepositoryNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Repository"),
  properties: z.object({
    RepositoryName: z.string().min(1),
    Description: z.string().min(1),
    EntityReference: z.string().min(1).describe("Managed → Model/Table node Name"),
    BaseClass: z.string().optional().describe("Inherited repository base class"),
    IsCached: z.boolean().default(false),
    CustomQueries: z.array(CustomQuerySchema).default([]),
  }).strict(),
}).strict();

export type RepositoryNode = z.infer<typeof RepositoryNodeSchema>;
