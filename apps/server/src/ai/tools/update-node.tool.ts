import { z } from "zod";

/** Modifies an existing node — rename, description/flag, or replace an array.
 *  Given properties shallow-merge over current properties; result passes strict
 *  schema validation. Node type CANNOT be changed. */

export const UPDATE_NODE_TOOL_NAME = "update_node";

export const UpdateNodeArgsSchema = z.object({
  nodeId: z.string().uuid().describe("ID of the existing node to modify (from the current-graph list)."),
  properties: z.record(z.unknown()).describe(
    "Top-level property fields to change; merged over the node's current properties (untouched fields are kept). " +
      "To RENAME, send just the name field (e.g. { ServiceName: 'AccountService' }). " +
      "To edit an ARRAY field (Columns/Endpoints/Methods/Fields), first call get_node, then send the COMPLETE new " +
      "array — arrays REPLACE, they do not append. The merged result is strictly schema-validated.",
  ),
});

export type UpdateNodeArgs = z.infer<typeof UpdateNodeArgsSchema>;

export const UPDATE_NODE_DESCRIPTION =
  "Modifies an existing node (rename, change a description/flag, or replace an array field). The node type cannot " +
  "be changed. The provided properties are merged over the current ones and the result is strictly validated. " +
  "Response: { ok: true, id, version } on success, { ok: false, code, message, suggestion } on error " +
  "(e.g. ERR_VERSION_CONFLICT, ERR_NAME_DUPLICATE, validation errors).";
