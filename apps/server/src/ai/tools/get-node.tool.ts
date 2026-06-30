import { z } from "zod";

/** Read-only — reads full properties of an existing node. Agent calls this FIRST
 *  before editing an ARRAY field (Columns/Endpoints/Methods/Fields) to see the
 *  full array, then sends the complete new array to update_node. */

export const GET_NODE_TOOL_NAME = "get_node";

export const GetNodeArgsSchema = z.object({
  nodeId: z.string().uuid().describe(
    "ID of an existing node (from the current-graph list) to read its full properties before editing.",
  ),
});

export type GetNodeArgs = z.infer<typeof GetNodeArgsSchema>;

export const GET_NODE_DESCRIPTION =
  "Reads the full current properties of an existing node. Call this BEFORE update_node when you need to edit " +
  "an array field (e.g. add a column to a Table or an endpoint to a Controller) so you can resend the complete " +
  "array. Response: { ok: true, id, type, version, properties }.";
