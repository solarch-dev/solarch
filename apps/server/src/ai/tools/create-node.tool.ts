import { z } from "zod";
import { NODE_KINDS } from "../../nodes/schemas";

/** Atomic create_node tool — streaming agent loop'unda LLM tek node yaratır,
 *  backend gerçek node ID'sini tool result olarak döner. Bir sonraki turn'de
 *  LLM bu ID'yi create_edge'de kullanabilir.
 *
 *  apply-architecture-graph (monolithic) yerine kullanılır. Atomic args
 *  (~1-2K char) tool-call payload bozulma eşiğinin (10K) çok altında —
 *  v4-flash + non-thinking + tools deterministik çalışır. */

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
