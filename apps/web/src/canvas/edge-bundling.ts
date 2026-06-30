/** Edge bundling — port-spread, "wiring panel / cable harness" aesthetic.
 *
 *  Groups each node's outgoing (source) and incoming (target) edges separately,
 *  sorts spatially by the opposite endpoint node's position → applies indexed
 *  perpendicular offset. Result: edges sharing the same port fan-out / fan-in,
 *  flowing side by side like a cable bundle.
 *
 *  Simple adaptation of web-old/edge-bundling.ts for single-port model
 *  (right output / left input) — no handle ID layer.
 *
 *  Renderer applies perpendicular offset on the non-dominant axis:
 *   - horizontally dominant edge → Y-axis offset (cables spread top-bottom)
 *   - vertically dominant edge → X-axis offset (cables spread left-right) */

import type { SceneEdge, SceneNode } from "./types";
import { nodeDisplayH } from "./renderer";

const SPACING = 14;       // default spacing within bundle (px world)
const MAX_SPREAD = 120;   // max total spread for large bundles
const NODE_EDGE_PAD = 24; // keep port entries from overflowing card corners (top+bottom pad)

export interface Bundles {
  src: Map<string, number>; // edgeId → source end offset
  tgt: Map<string, number>; // edgeId → target end offset
}

const EMPTY: Bundles = { src: new Map(), tgt: new Map() };

/** Offset now shifts the port entry too, so spread is bounded by node height
 *  — entries always stay on the card's left/right edge. */
function spreadOffset(i: number, n: number, nodeH: number): number {
  if (n <= 1) return 0;
  const maxTotal = Math.min(MAX_SPREAD, Math.max(0, nodeH - NODE_EDGE_PAD));
  const spacing = Math.min(SPACING, maxTotal / (n - 1));
  return (i - (n - 1) / 2) * spacing;
}

/** Sort by opposite endpoint node's Y position — for right-out/left-in port
 *  convention, always Y-axis spread (dominant-axis logic unnecessary). */
const yCompare = (a: SceneNode, b: SceneNode) => (a.y + a.h / 2) - (b.y + b.h / 2);

export function computeBundles(
  edges: SceneEdge[],
  nodeIndex: Map<string, SceneNode>,
): Bundles {
  if (edges.length === 0) return EMPTY;

  const outgoing = new Map<string, SceneEdge[]>();
  const incoming = new Map<string, SceneEdge[]>();
  for (const e of edges) {
    let og = outgoing.get(e.source);
    if (!og) { og = []; outgoing.set(e.source, og); }
    og.push(e);
    let ig = incoming.get(e.target);
    if (!ig) { ig = []; incoming.set(e.target, ig); }
    ig.push(e);
  }

  const src = new Map<string, number>();
  const tgt = new Map<string, number>();

  // Source end — A→{B,C,D}: sort by target.y → fan-out
  for (const [nodeId, list] of outgoing) {
    if (list.length <= 1) continue;
    const node = nodeIndex.get(nodeId);
    const nodeH = node ? nodeDisplayH(node) : MAX_SPREAD;
    list.sort((a, b) => {
      const ta = nodeIndex.get(a.target), tb = nodeIndex.get(b.target);
      if (!ta || !tb) return 0;
      return yCompare(ta, tb);
    });
    for (let i = 0; i < list.length; i++) {
      src.set(list[i].id, spreadOffset(i, list.length, nodeH));
    }
  }

  // Target end — {A,B,C}→D: sort by source.y → fan-in
  for (const [nodeId, list] of incoming) {
    if (list.length <= 1) continue;
    const node = nodeIndex.get(nodeId);
    const nodeH = node ? nodeDisplayH(node) : MAX_SPREAD;
    list.sort((a, b) => {
      const sa = nodeIndex.get(a.source), sb = nodeIndex.get(b.source);
      if (!sa || !sb) return 0;
      return yCompare(sa, sb);
    });
    for (let i = 0; i < list.length; i++) {
      tgt.set(list[i].id, spreadOffset(i, list.length, nodeH));
    }
  }

  return { src, tgt };
}

// ── Corridor spread — elbow mid-segments side by side ──────────────
// Groups elbow edges sharing the same vertical corridor (close mx + overlapping
// y-range), giving each an indexed offset on the perpendicular axis → cables
// don't overlap, flowing side by side flush. Only horizontally-dominant edges
// (vertical mid-segment); symmetric logic for vertically-dominant ones (horizontal mid-segment).

const CORRIDOR_TOL = 12;     // mx/my proximity counted as the same corridor (world px)
const CORRIDOR_SPACING = 10; // cable spacing within corridor
const CORRIDOR_MAX = 40;     // max shift in one direction

interface MidSeg {
  id: string;
  axis: "v" | "h";   // mid-segment direction (v: vertical — horizontally-dominant elbow)
  pos: number;       // v → mx, h → my
  lo: number;        // segment's range on the perpendicular axis
  hi: number;
}

function corridorSpread(i: number, n: number): number {
  if (n <= 1) return 0;
  const spacing = Math.min(CORRIDOR_SPACING, (CORRIDOR_MAX * 2) / (n - 1));
  return (i - (n - 1) / 2) * spacing;
}

export function computeCorridors(
  edges: SceneEdge[],
  nodeIndex: Map<string, SceneNode>,
  getBend: (edgeId: string) => number | undefined,
  stubLen: number,
  portOf: (n: SceneNode, side: "in" | "out") => { x: number; y: number },
): Map<string, number> {
  const out = new Map<string, number>();
  if (edges.length < 2) return out;

  const segs: MidSeg[] = [];
  for (const e of edges) {
    const a = nodeIndex.get(e.source);
    const b = nodeIndex.get(e.target);
    if (!a || !b) continue;
    const pOut = portOf(a, "out");
    const pIn = portOf(b, "in");
    const start = { x: pOut.x + stubLen, y: pOut.y };
    const end = { x: pIn.x - stubLen, y: pIn.y };
    const dx = end.x - start.x, dy = end.y - start.y;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
    const ratio = getBend(e.id) ?? 0.5;
    if (Math.abs(dx) >= Math.abs(dy)) {
      // horizontally-dominant → vertical mid-segment x=mx, y∈[start.y, end.y]
      if (Math.abs(dy) < 4) continue; // mid-segment too short to count
      const mx = start.x + dx * ratio;
      segs.push({ id: e.id, axis: "v", pos: mx, lo: Math.min(start.y, end.y), hi: Math.max(start.y, end.y) });
    } else {
      if (Math.abs(dx) < 4) continue;
      const my = start.y + dy * ratio;
      segs.push({ id: e.id, axis: "h", pos: my, lo: Math.min(start.x, end.x), hi: Math.max(start.x, end.x) });
    }
  }
  if (segs.length < 2) return out;

  // Sort by pos per axis; close pos + overlapping range → same group.
  for (const axis of ["v", "h"] as const) {
    const axSegs = segs.filter((s) => s.axis === axis).sort((a, b) => a.pos - b.pos);
    let group: MidSeg[] = [];
    const flush = () => {
      if (group.length > 1) {
        // Deterministic order: by range center (so cables don't cross)
        group.sort((a, b) => (a.lo + a.hi) / 2 - (b.lo + b.hi) / 2 || (a.id < b.id ? -1 : 1));
        for (let i = 0; i < group.length; i++) {
          out.set(group[i].id, corridorSpread(i, group.length));
        }
      }
      group = [];
    };
    for (const s of axSegs) {
      const prev = group[group.length - 1];
      const near = prev !== undefined && s.pos - prev.pos <= CORRIDOR_TOL;
      const overlaps = group.some((g) => s.lo < g.hi && g.lo < s.hi);
      if (group.length > 0 && near && overlaps) group.push(s);
      else { flush(); group.push(s); }
    }
    flush();
  }

  return out;
}
