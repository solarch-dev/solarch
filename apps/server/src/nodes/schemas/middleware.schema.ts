import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

export const MiddlewareNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Middleware"),
  properties: z.object({
    MiddlewareName: z.string().min(1),
    Description: z.string().min(1),
    AppliesTo: z.enum(["Global", "SpecificRoutes"]),
    ExecutionOrder: z.number().int().nonnegative(),
    MiddlewareType: z.enum(["Auth", "Logging", "RateLimit", "Cors", "Compression", "ErrorHandler", "Custom"]).optional(),
    Config: z.array(z.object({ Key: z.string().min(1), Value: z.string() })).default([]).describe("middleware configuration key-values"),
  }).strict(),
}).strict();

export type MiddlewareNode = z.infer<typeof MiddlewareNodeSchema>;
