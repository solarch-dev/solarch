import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

export const MessageQueueNodeSchema = BaseNodeSchema.extend({
  type: z.literal("MessageQueue"),
  properties: z.object({
    QueueName: z.string().min(1),
    Description: z.string().min(1),
    Type: z.enum(["Queue", "Topic"]),
    Provider: z.enum(["RabbitMQ", "Kafka", "AWS_SQS", "Generic"]),
    MessageFormat: z.string().min(1).describe("Message body → DTO node Name"),
    DeliveryGuarantee: z.enum(["at-least-once", "exactly-once", "at-most-once"]).optional(),
    MaxRetries: z.number().int().nonnegative().optional(),
    DeadLetterQueue: z.string().optional(),
    RetentionSeconds: z.number().int().positive().optional(),
  }).strict(),
}).strict();

export type MessageQueueNode = z.infer<typeof MessageQueueNodeSchema>;
