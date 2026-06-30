import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const VALIDATION_RULES = ["Min", "Max", "MinLength", "MaxLength", "Email", "Url", "Regex", "Pattern", "Positive", "Negative"] as const;

const ValidationRuleSchema = z.object({
  Rule: z.enum(VALIDATION_RULES),
  Value: z.string().optional().describe("Min/Max/Length value or Regex pattern"),
}).strict();

const FieldSchema = z.object({
  Name: z.string().min(1),
  DataType: z.string().min(1),
  IsRequired: z.boolean(),
  IsArray: z.boolean(),
  ValidationRules: z.array(ValidationRuleSchema).default([]),
  DefaultValue: z.string().optional(),
  NestedDTORef: z.string().optional().describe("→ DTO node Name (nested DTO)"),
  EnumRef: z.string().optional().describe("→ Enum node Name"),
  Description: z.string().optional(),
}).strict();

export const DTONodeSchema = BaseNodeSchema.extend({
  type: z.literal("DTO"),
  properties: z.object({
    Name: z.string().min(1),
    Description: z.string().min(1),
    Fields: z.array(FieldSchema).min(1),
  }).strict(),
}).strict();

export type DTONode = z.infer<typeof DTONodeSchema>;
