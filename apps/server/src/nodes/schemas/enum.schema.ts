import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

export const EnumNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Enum"),
  properties: z.object({
    Name: z.string().min(1),
    Description: z.string().min(1),
    BackingType: z.enum(["string", "int"]).default("string"),
    Values: z.array(z.object({
      Key: z.string().min(1),
      Value: z.string().optional().describe("backing value (Key is used if absent)"),
      Description: z.string().optional(),
    })).min(1),
    Transitions: z
      .array(
        z.object({
          From: z.string().min(1).describe("source state (enum member Key)"),
          To: z.array(z.string().min(1)).min(1).describe("allowed target states (enum member Keys)"),
        }),
      )
      .optional()
      .describe(
        "STATE-MACHINE: allowed state transitions (From Key -> To Keys). If provided, the emitter " +
          "generates a transition-map + canTransition<Enum> + assert<Enum>Transition guard alongside the enum; " +
          "status-updating services use this guard (rejecting illegal transitions).",
      ),
  }).strict(),
}).strict();

export type EnumNode = z.infer<typeof EnumNodeSchema>;
