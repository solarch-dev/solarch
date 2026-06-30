import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const RELATION = ["OneToOne", "OneToMany", "ManyToOne", "ManyToMany"] as const;

const PropertySchema = z.object({
  Name: z.string().min(1),
  Type: z.string().min(1),
  IsNullable: z.boolean().default(false),
  IsCollection: z.boolean().default(false),
  RelationType: z.enum(RELATION).optional(),
  RelatedModelRef: z.string().optional().describe("→ Model node ClassName"),
}).strict();

const MethodSchema = z.object({
  MethodName: z.string().min(1),
  Visibility: z.enum(["public", "private", "protected"]).default("public"),
  Parameters: z.array(z.object({
    Name: z.string().min(1),
    Type: z.string().min(1),
    Optional: z.boolean().default(false),
    Default: z.string().optional(),
  })).default([]),
  ReturnType: z.string().min(1),
  IsAsync: z.boolean().default(false),
  IsStatic: z.boolean().default(false),
}).strict();

export const ModelNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Model"),
  properties: z.object({
    ClassName: z.string().min(1),
    Description: z.string().min(1),
    TableRef: z.string().optional().describe("→ Table node TableName"),
    Properties: z.array(PropertySchema).min(1),
    Methods: z.array(MethodSchema).default([]),
  }).strict(),
}).strict();

export type ModelNode = z.infer<typeof ModelNodeSchema>;
