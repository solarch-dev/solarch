import { z } from "zod";

/** Bir node'u (ve ona bağlı edge'leri) kalıcı siler. Refactor için: bir
 *  bileşeni kaldırma, yanlış yaratılmış bir node'u temizleme. */

export const DELETE_NODE_TOOL_NAME = "delete_node";

export const DeleteNodeArgsSchema = z.object({
  nodeId: z.string().uuid().describe("ID of the existing node to delete. Its connected edges are removed too."),
});

export type DeleteNodeArgs = z.infer<typeof DeleteNodeArgsSchema>;

export const DELETE_NODE_DESCRIPTION =
  "Permanently deletes a node and its connected edges. Use for refactors such as removing a component. " +
  "Response: { ok: true, id } on success, { ok: false, code, message } if the node is not found.";
