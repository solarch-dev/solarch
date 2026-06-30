import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const RouteSchema = z.object({
  Path: z.string().min(1),
  ComponentRef: z.string().optional().describe("→ UIComponent node Name"),
}).strict();

export const FrontendAppNodeSchema = BaseNodeSchema.extend({
  type: z.literal("FrontendApp"),
  properties: z.object({
    AppName: z.string().min(1),
    Description: z.string().min(1),
    Framework: z.enum(["React", "Vue", "Angular", "Svelte", "Vanilla"]),
    DeploymentType: z.enum(["SPA", "SSR", "SSG"]),
    StateManagement: z.enum(["Redux", "Zustand", "Context", "Pinia", "Vuex", "NgRx", "None"]).optional(),
    StylingApproach: z.enum(["CSS", "SCSS", "Tailwind", "StyledComponents", "CSSModules"]).optional(),
    Routes: z.array(RouteSchema).default([]),
  }).strict(),
}).strict();

export type FrontendAppNode = z.infer<typeof FrontendAppNodeSchema>;
