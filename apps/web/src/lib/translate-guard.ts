/** Chrome auto-translate (Google Translate) and similar extensions wrap text
 *  nodes in <font> tags and move them around the DOM. When the React reconciler
 *  later calls removeChild/insertBefore with its stale reference, the whole app
 *  crashes with
 *  "NotFoundError: The node to be removed is not a child of this node."
 *  (facebook/react#11538 — a known limitation; this patch is the recommended
 *  workaround). Instead of blocking translation we recover silently:
 *  translation stays on, the app does not crash.
 */
export function installTranslateGuard(): void {
  if (typeof Node !== "function" || !Node.prototype) return;

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      console.warn("[translate-guard] removeChild skipped — node moved to a different parent (likely page translation)");
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      console.warn("[translate-guard] insertBefore skipped — reference node moved to a different parent (likely page translation)");
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}
