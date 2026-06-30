import { z } from "zod";
import { NODE_KINDS } from "../../nodes/schemas";

/** Atomic create_node tool — in streaming agent loop LLM creates one node,
 *  backend returns real node ID as tool result. Next turn LLM uses this ID in create_edge.
 *
 *  Used instead of apply-architecture-graph (monolithic). Atomic args
 *  (~1-2K char) well below tool-call payload corruption threshold (10K) —
 *  v4-flash + non-thinking + tools run deterministically. */

export const CREATE_NODE_TOOL_NAME = "create_node";

export const CreateNodeArgsSchema = z.object({
  type: z.enum(NODE_KINDS as [string, ...string[]]).describe(
    "Node type. Valid values: " + NODE_KINDS.join(", "),
  ),
  properties: z.record(z.unknown()).describe(
    "Type-specific fields. Example: for Table { TableName, Columns: [...] }, " +
      "for Controller { ControllerName, Endpoints: [...] }. Each type's " +
      "schema is strictly validated — if a field is missing/wrong an error is returned.",
  ),
});

export type CreateNodeArgs = z.infer<typeof CreateNodeArgsSchema>;

export const CREATE_NODE_DESCRIPTION =
  "Creates a single component (node) of the architecture. It passes schema validation " +
  "and returns the real node ID. You must create the relevant nodes before creating edges. " +
  "Response: { ok: true, id, type } on success, { ok: false, code, message, suggestion } on error. " +
  "On error, apply the suggestion and try again.";
