import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const ExtEndpointSchema = z.object({
  Name: z.string().min(1),
  Method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  Path: z.string().min(1),
}).strict();

export const ExternalServiceNodeSchema = BaseNodeSchema.extend({
  type: z.literal("ExternalService"),
  properties: z.object({
    ServiceName: z.string().min(1),
    Description: z.string().min(1),
    BaseURL: z.string().url(),
    AuthType: z.enum(["None", "Basic", "Bearer", "API_Key"]),
    TimeoutSeconds: z.number().int().positive(),
    Endpoints: z.array(ExtEndpointSchema).default([]),
    RetryPolicy: z.object({ MaxRetries: z.number().int().nonnegative(), DelaySeconds: z.number().int().nonnegative().optional() }).optional(),
    RateLimit: z.object({ Requests: z.number().int().positive(), WindowSeconds: z.number().int().positive() }).optional(),
    CircuitBreaker: z.object({ FailureThreshold: z.number().int().positive(), ResetSeconds: z.number().int().positive() }).optional(),
  }).strict(),
}).strict();

export type ExternalServiceNode = z.infer<typeof ExternalServiceNodeSchema>;
