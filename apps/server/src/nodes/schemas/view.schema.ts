import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

export const ViewNodeSchema = BaseNodeSchema.extend({
  type: z.literal("View"),
  properties: z.object({
    ViewName: z.string().min(1),
    Description: z.string().min(1),
    Definition: z.string().min(1).describe("SQL/aggregate definition"),
    SourceTables: z.array(z.string().min(1)).min(1).describe("→ Table Name'leri"),
    Materialized: z.boolean(),
    Columns: z.array(z.object({ Name: z.string().min(1), DataType: z.string().min(1) })).default([]),
    RefreshStrategy: z.enum(["onDemand", "scheduled", "onChange"]).optional().describe("refresh strategy for the materialized view"),
  }).strict(),
}).strict();

export type ViewNode = z.infer<typeof ViewNodeSchema>;
