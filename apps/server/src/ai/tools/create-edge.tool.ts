import { z } from "zod";
import { EDGE_KINDS } from "../../edges/schemas/edge.schema";

/** Atomic create_edge tool — iki mevcut node arasında edge yaratır.
 *  sourceNodeId ve targetNodeId önceki create_node çağrılarında dönen
 *  gerçek backend ID'leri olmalı (tempId yok). Rules Engine her create'de
 *  inline çalışır — kural ihlali varsa { ok: false, suggestion } döner,
 *  LLM kendini düzeltir (ReAct). */

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
