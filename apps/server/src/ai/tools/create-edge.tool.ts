import { z } from "zod";
import { EDGE_KINDS } from "../../edges/schemas/edge.schema";

/** Atomic create_edge tool — creates edge between two existing nodes.
 *  sourceNodeId and targetNodeId must be real backend IDs from prior create_node
 *  calls (no tempId). Rules Engine runs inline on each create — on violation
 *  returns { ok: false, suggestion }; LLM self-corrects (ReAct). */

export const CREATE_EDGE_TOOL_NAME = "create_edge";

export const CreateEdgeArgsSchema = z.object({
  sourceNodeId: z.string().uuid().describe(
    "ID of the node the connection originates from (the return value of a previous create_node call).",
  ),
  targetNodeId: z.string().uuid().describe(
    "ID of the node the connection goes to.",
  ),
  kind: z.enum(EDGE_KINDS as unknown as [string, ...string[]]).describe(
    "Edge type. Valid values: " + EDGE_KINDS.join(", "),
  ),
  label: z.string().optional().describe(
    "Short label to show on the arrow (optional). E.g.: 'validate password', 'create user'.",
  ),
});

export type CreateEdgeArgs = z.infer<typeof CreateEdgeArgsSchema>;

export const CREATE_EDGE_DESCRIPTION =
  "Creates a relationship (edge) between two existing nodes. The source and target nodes " +
  "must have been created previously with create_node — use the real IDs returned by that " +
  "function, not tempIds. The Solarch Rules Engine validates that the connection conforms " +
  "to the rules; on a violation it returns { ok: false, code, message, suggestion }. " +
  "Response: { ok: true, id } on success.";
