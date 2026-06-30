/** Auto-arrange — Dagre hierarchical layered layout.
 *
 *  SceneNode/SceneEdge → Dagre graph → world positions (top-left corner).
 *  No group/parent support (not in our model). Simplified version of
 *  web-old's layout.ts (frame/subgraph phase skipped). */

import dagre from "@dagrejs/dagre";
import type { SceneNode, SceneEdge } from "./types";
import { nodeDisplayH } from "./renderer";

export type ArrangeDirection = "LR" | "TB" | "RL" | "BT";

const NODE_SEP = 80;   // gap between side-by-side nodes at the same rank (world px)
const RANK_SEP = 140;  // gap between ranks
const EDGE_SEP = 24;   // gap between edges
const MARGIN = 48;
const COLLISION_PAD = 16;  // minimum gap after overlap correction

export function arrangeNodes(
  nodes: SceneNode[],
  edges: SceneEdge[],
  direction: ArrangeDirection = "LR",
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return out;

  // multigraph: count parallel edges between the same pair separately —
  // they actually factor into dagre's edgesep (a plain graph collapsed them to one).
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: direction,
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    edgesep: EDGE_SEP,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // IMPORTANT: Give Dagre the ACTUAL render height — DB's n.h is fixed (stub),
  // real display = HEADER + content rows. Otherwise large nodes overlap.
  const heights = new Map<string, number>();
  for (const n of nodes) {
    const realH = nodeDisplayH(n);
    heights.set(n.id, realH);
    g.setNode(n.id, { width: n.w, height: realH });
  }
  for (const e of edges) {
    // Self-loop breaks the rank computation — not passed to layout (rendering unaffected).
    if (e.source === e.target) continue;
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target, {}, e.id);
  }

  dagre.layout(g);

  for (const n of nodes) {
    const d = g.node(n.id);
    if (!d) continue;
    const realH = heights.get(n.id) ?? n.h;
    // Dagre returns center coords → convert to top-left (using real height)
    out.set(n.id, { x: Math.round(d.x - n.w / 2), y: Math.round(d.y - realH / 2) });
  }

  // Post-process: AABB collision repair — resolve small overlaps remaining after Dagre layout
  resolveOverlaps(out, nodes, heights);

  return out;
}

/** Axis-aligned bounding box overlap resolver — simple greedy.
 *  Iterates sorted nodes, pushes any node colliding with another right/down
 *  (perpendicular to rank direction). Repeats for a few passes (total <O(n²)). */
function resolveOverlaps(
  out: Map<string, { x: number; y: number }>,
  nodes: SceneNode[],
  heights: Map<string, number>,
): void {
  const items = nodes.map((n) => {
    const p = out.get(n.id);
    if (!p) return null;
    return { id: n.id, x: p.x, y: p.y, w: n.w, h: heights.get(n.id) ?? n.h };
  }).filter(Boolean) as Array<{ id: string; x: number; y: number; w: number; h: number }>;

  const overlap = (a: typeof items[number], b: typeof items[number]) =>
    a.x < b.x + b.w + COLLISION_PAD &&
    a.x + a.w + COLLISION_PAD > b.x &&
    a.y < b.y + b.h + COLLISION_PAD &&
    a.y + a.h + COLLISION_PAD > b.y;

  // Max 4 passes — practically 1-2 passes suffice.
  // Push direction is fixed PERPENDICULAR to the rank axis (LR/RL → Y only): a
  // horizontal push shifted rank columns and caused progressive skew. Horizontal
  // push only when a vertical fix is meaningless (same y-center, vertical push opens a huge gap).
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (!overlap(a, b)) continue;

        const dx = (a.x + a.w / 2) - (b.x + b.w / 2);
        const dy = (a.y + a.h / 2) - (b.y + b.h / 2);
        // If the vertical shift needed is under 3x the horizontal one, push vertically (rank preserved).
        const neededY = (a.h / 2 + b.h / 2 + COLLISION_PAD) - Math.abs(dy);
        const neededX = (a.w / 2 + b.w / 2 + COLLISION_PAD) - Math.abs(dx);
        const pushY = neededY <= neededX * 3;

        if (pushY) {
          if (neededY > 0) {
            const shift = Math.ceil(neededY / 2);
            if (dy >= 0) { a.y += shift; b.y -= shift; }
            else { a.y -= shift; b.y += shift; }
            moved = true;
          }
        } else {
          if (neededX > 0) {
            const shift = Math.ceil(neededX / 2);
            if (dx >= 0) { a.x += shift; b.x -= shift; }
            else { a.x -= shift; b.x += shift; }
            moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }

  for (const it of items) {
    out.set(it.id, { x: Math.round(it.x), y: Math.round(it.y) });
  }
}
