import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const StepSchema = z.object({
  StepName: z.string().min(1),
  ServiceRef: z.string().min(1).describe("Step-executing → Service node Name"),
  Action: z.string().min(1),
  CompensationAction: z.string().optional().describe("Saga geri-alma aksiyonu"),
  OnFailure: z.enum(["retry", "compensate", "abort"]).default("abort"),
}).strict();

export const OrchestratorNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Orchestrator"),
  properties: z.object({
    OrchestratorName: z.string().min(1),
    Description: z.string().min(1),
    Pattern: z.enum(["Saga", "CompensatingTransaction", "StateMachine", "ProcessManager"]),
    Steps: z.array(StepSchema).default([]),
  }).strict(),
}).strict();

export type OrchestratorNode = z.infer<typeof OrchestratorNodeSchema>;
