import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const MethodParamSchema = z.object({
  Name: z.string().min(1),
  Type: z.string().min(1),
  Optional: z.boolean().default(false),
  Default: z.string().optional(),
  DtoRef: z.string().optional().describe("If the parameter type is a DTO → DTO node Name"),
}).strict();

const ServiceMethodSchema = z.object({
  MethodName: z.string().min(1),
  Visibility: z.enum(["public", "private", "protected"]).default("public"),
  Parameters: z.array(MethodParamSchema).default([]),
  ReturnType: z.string().min(1),
  ReturnDtoRef: z.string().optional().describe("If the return type is a DTO → DTO node Name"),
  ReturnsCollection: z
    .boolean()
    .optional()
    .describe(
      "SINGLE SOURCE of cardinality: does the operation return a collection? When declared, " +
        "the emitter forces the return type to DTO[] (aligned with the controller's route inference). " +
        "When omitted, falls back to the [] in ReturnType / method-name list semantics.",
    ),
  IsAsync: z.boolean().default(false),
  Throws: z.array(z.string().min(1)).default([]).describe("throwable → Exception node Names"),
  Description: z.string().optional(),
}).strict();

const DependencySchema = z.object({
  Kind: z.enum(["Repository", "Service", "Cache", "ExternalService"]),
  Ref: z.string().min(1).describe("Name of the dependency node (DI)"),
}).strict();

export const ServiceNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Service"),
  properties: z.object({
    ServiceName: z.string().min(1),
    Description: z.string().min(1),
    IsTransactionScoped: z.boolean(),
    Methods: z.array(ServiceMethodSchema).min(1),
    Dependencies: z.array(DependencySchema).default([]),
  }).strict(),
}).strict();

export type ServiceNode = z.infer<typeof ServiceNodeSchema>;
