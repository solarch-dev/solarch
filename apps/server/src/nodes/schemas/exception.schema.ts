import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

export const ExceptionNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Exception"),
  properties: z.object({
    ExceptionName: z.string().min(1),
    Description: z.string().min(1),
    HttpStatusCode: z.number().int().min(100).max(599),
    LogSeverity: z.enum(["Info", "Warning", "Error", "Critical"]),
    ErrorCode: z.string().optional().describe("application error code, e.g. ERR_USER_NOT_FOUND"),
    ParentExceptionRef: z.string().optional().describe("inherited → Exception node Name"),
  }).strict(),
}).strict();

export type ExceptionNode = z.infer<typeof ExceptionNodeSchema>;
