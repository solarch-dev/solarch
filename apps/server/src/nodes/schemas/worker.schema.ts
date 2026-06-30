import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const RetryPolicySchema = z.object({
  MaxRetries: z.number().int().nonnegative(),
  BackoffStrategy: z.enum(["fixed", "exponential"]).optional(),
  DelaySeconds: z.number().int().nonnegative().optional(),
}).strict();

export const WorkerNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Worker"),
  properties: z.object({
    WorkerName: z.string().min(1),
    Description: z.string().min(1),
    Schedule: z.string().min(1).describe("cron ifadesi"),
    TaskToExecute: z.string().min(1),
    TimeoutSeconds: z.number().int().positive(),
    RetryPolicy: RetryPolicySchema,
    Concurrency: z.number().int().positive().optional(),
    IsEnabled: z.boolean().default(true),
  }).strict(),
}).strict();

export type WorkerNode = z.infer<typeof WorkerNodeSchema>;
