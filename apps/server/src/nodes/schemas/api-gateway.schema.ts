import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const RouteSchema = z.object({
  Path: z.string().min(1),
  TargetRef: z.string().min(1).describe("→ Controller veya Service node Name"),
  Methods: z.array(z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"])).min(1),
  AuthRequired: z.boolean().default(false),
  RateLimit: z.object({ Requests: z.number().int().positive(), WindowSeconds: z.number().int().positive() }).optional(),
}).strict();

export const APIGatewayNodeSchema = BaseNodeSchema.extend({
  type: z.literal("APIGateway"),
  properties: z.object({
    GatewayName: z.string().min(1),
    Description: z.string().min(1),
    Provider: z.enum(["Kong", "Nginx", "AWS_API_Gateway", "Azure_API_Management", "Generic"]),
    AuthMode: z.enum(["None", "JWT", "OAuth2", "ApiKey"]).optional(),
    CorsEnabled: z.boolean().optional(),
    Routes: z.array(RouteSchema).default([]),
  }).strict(),
}).strict();

export type APIGatewayNode = z.infer<typeof APIGatewayNodeSchema>;
