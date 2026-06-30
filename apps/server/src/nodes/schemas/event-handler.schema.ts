import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const EHRetryPolicySchema = z.object({
  MaxRetries: z.number().int().nonnegative(),
  DelaySeconds: z.number().int().nonnegative().optional(),
}).strict();

export const EventHandlerNodeSchema = BaseNodeSchema.extend({
  type: z.literal("EventHandler"),
  properties: z.object({
    HandlerName: z.string().min(1),
    Description: z.string().min(1),
    EventName: z.string().min(1),
    IsAsync: z.boolean(),
    QueueRef: z.string().optional().describe("Subscribed → MessageQueue node Name"),
    RetryPolicy: EHRetryPolicySchema.optional(),
    DeadLetterQueue: z.string().optional(),
  }).strict(),
}).strict();

export type EventHandlerNode = z.infer<typeof EventHandlerNodeSchema>;
