import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const PropSchema = z.object({
  Name: z.string().min(1),
  Type: z.string().min(1),
  Required: z.boolean().default(false),
}).strict();

const StateSchema = z.object({
  Name: z.string().min(1),
  Type: z.string().min(1),
}).strict();

const EventSchema = z.object({
  Name: z.string().min(1),
  PayloadType: z.string().optional(),
}).strict();

export const UIComponentNodeSchema = BaseNodeSchema.extend({
  type: z.literal("UIComponent"),
  properties: z.object({
    ComponentName: z.string().min(1),
    Description: z.string().min(1),
    Props: z.array(PropSchema).default([]),
    State: z.array(StateSchema).default([]),
    Events: z.array(EventSchema).default([]),
    ChildComponentRefs: z.array(z.string().min(1)).default([]).describe("→ UIComponent node Name'leri"),
  }).strict(),
}).strict();

export type UIComponentNode = z.infer<typeof UIComponentNodeSchema>;
