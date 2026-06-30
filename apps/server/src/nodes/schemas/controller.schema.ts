import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const ParamSchema = z.object({
  Name: z.string().min(1),
  Type: z.string().min(1),
}).strict();

const QueryParamSchema = z.object({
  Name: z.string().min(1),
  Type: z.string().min(1),
  Required: z.boolean().default(false),
}).strict();

const EndpointSchema = z.object({
  HttpMethod: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  Route: z.string().min(1),
  RequestDTORef: z.string().optional().describe("→ DTO node Name"),
  ResponseDTORef: z.string().optional().describe("→ DTO node Name"),
  ReturnsCollection: z
    .boolean()
    .optional()
    .describe(
      "SINGLE SOURCE of cardinality: does the endpoint return a collection? When set, " +
        "the controller uses this field NOT the route-shape heuristic (DTO[] vs DTO). " +
        "Same field as service.emitter -> both ends guaranteed aligned.",
    ),
  RequiresAuth: z.boolean(),
  RequiredRoles: z.array(z.string()).default([]),
  PathParams: z.array(ParamSchema).default([]),
  QueryParams: z.array(QueryParamSchema).default([]),
  StatusCodes: z.array(z.object({ Code: z.number().int(), Description: z.string().optional() })).default([]),
  MiddlewareRefs: z.array(z.string().min(1)).default([]).describe("→ Middleware node Names"),
  RateLimit: z.object({ Requests: z.number().int().positive(), WindowSeconds: z.number().int().positive() }).optional(),
  Description: z.string().optional(),
}).strict();

export const ControllerNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Controller"),
  properties: z.object({
    ControllerName: z.string().min(1),
    Description: z.string().min(1),
    BaseRoute: z.string().min(1),
    Version: z.string().optional().describe("API version, e.g. 'v1'"),
    Endpoints: z.array(EndpointSchema).min(1),
  }).strict(),
}).strict();

export type ControllerNode = z.infer<typeof ControllerNodeSchema>;
