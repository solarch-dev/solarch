import { z } from "zod";

/** plans/AI Agent & Tool Şeması — apply_architecture_graph fonksiyon şeması.
 *  LLM bu şemaya uygun {nodes, edges} üretir; GraphService.apply işler. */
export const ApplyArchitectureArgsSchema = z.object({
  nodes: z.array(
    z.object({
      tempId: z.string().describe("Temporary unique ID for reference in edges (e.g. 'temp_user_controller')."),
      type: z.string().describe("Node tipi (Table, Service, Controller, ...)."),
      properties: z.record(z.unknown()).describe("Type-specific fields (e.g. TableName + Columns for Table)."),
    }),
  ).describe("Architecture components to be created."),
  edges: z.array(
    z.object({
      sourceTempId: z.string().describe("tempId of the node the connection originates from."),
      targetTempId: z.string().describe("tempId of the node the connection goes to."),
      edgeType: z.string().describe("Relationship type (CALLS, WRITES, REQUESTS, ...)."),
      label: z.string().optional().describe("Short label on the arrow (optional)."),
    }),
  ).describe("Relationships between nodes."),
});

export type ApplyArchitectureArgs = z.infer<typeof ApplyArchitectureArgsSchema>;

export const APPLY_ARCHITECTURE_TOOL_NAME = "apply_architecture_graph";

export const APPLY_ARCHITECTURE_DESCRIPTION =
  "Adds new Nodes and Edges to the system according to the user's request. " +
  "The submitted draft is strictly checked by the Solarch Rules Engine. " +
  "If you violate the rules, the system returns the errors and fix suggestions — " +
  "you must read these, revise the structure, and call the function again.";
