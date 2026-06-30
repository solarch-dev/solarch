import { z } from "zod";

/** Deletes an edge (connection). To REWIRE a connection:
 *  delete_edge(oldId) + create_edge(new endpoints) — rules re-run. */

export const DELETE_EDGE_TOOL_NAME = "delete_edge";

export const DeleteEdgeArgsSchema = z.object({
  edgeId: z.string().uuid().describe("ID of the existing edge to delete (from the current-graph edge list)."),
});

export type DeleteEdgeArgs = z.infer<typeof DeleteEdgeArgsSchema>;

export const DELETE_EDGE_DESCRIPTION =
  "Deletes a relationship (edge) between two nodes. To REWIRE a connection, delete the old edge then call " +
  "create_edge with the new endpoints. Response: { ok: true, id } on success, { ok: false, code, message } if not found.";
