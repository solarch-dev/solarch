/** Edge crossing hops (circuit-diagram "jump") — which edge jumps over another,
 *  and at what point?
 *
 *  Rule: the edge drawn LATER (rendered on top) jumps over earlier ones. Each
 *  edge's path is reduced to a world-coordinate point list via edgePolylineWorld;
 *  segment-segment intersections are found.
 *
 *  Cost is O(E² · S²), so it's only called when the scene is settled and is
 *  sig-cached in CanvasView (hop-free drawing during animation/drag). */

import type { Scene } from "./types";
import { edgePolylineWorld, computeTrunkSets, type EdgeHop, type EdgePathMode } from "./renderer";

/** Port/marker region — crossings this close to path endpoints are skipped (world px). */
const END_GUARD = 16;
/** Minimum distance between two hops on the same edge (world px) — near-parallel
 *  crossings (flattened bezier) collapse to a single hop. */
const MIN_HOP_GAP = 14;
/** Hop cap per edge — beyond this is visual noise, drawn hop-free. */
const MAX_HOPS_PER_EDGE = 24;

interface Poly {
  id: string;
  pts: { x: number; y: number }[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function segIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): { x: number; y: number; t: number } | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null; // parallel/collinear — no hop
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y, t };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export function computeEdgeHops(
  scene: Scene,
  mode: EdgePathMode,
  getBend: (edgeId: string) => number | undefined,
  getBundle: (edgeId: string) => { src: number; tgt: number } | undefined,
  corridors: Map<string, number> | null,
): Map<string, EdgeHop[]> {
  const out = new Map<string, EdgeHop[]>();
  if (scene.edges.length < 2) return out;

  const { trunkOut, trunkIn } = computeTrunkSets(scene);

  const polys: Poly[] = [];
  for (const e of scene.edges) {
    const a = scene.index.get(e.source);
    const b = scene.index.get(e.target);
    if (!a || !b) continue;
    const bun = getBundle(e.id);
    const pts = edgePolylineWorld(
      a, b, mode, getBend(e.id),
      bun?.src ?? 0, bun?.tgt ?? 0,
      corridors?.get(e.id) ?? 0,
      trunkOut.has(e.source), trunkIn.has(e.target),
    );
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    polys.push({ id: e.id, pts, minX, minY, maxX, maxY });
  }

  for (let i = 1; i < polys.length; i++) {
    const A = polys[i]; // drawn later — the side that jumps over
    const aStart = A.pts[0];
    const aEnd = A.pts[A.pts.length - 1];
    const found: EdgeHop[] = [];

    for (let j = 0; j < i && found.length <= MAX_HOPS_PER_EDGE; j++) {
      const B = polys[j];
      // Coarse bbox cull
      if (A.minX > B.maxX || B.minX > A.maxX || A.minY > B.maxY || B.minY > A.maxY) continue;
      const bStart = B.pts[0];
      const bEnd = B.pts[B.pts.length - 1];

      for (let s = 0; s < A.pts.length - 1; s++) {
        const a0 = A.pts[s], a1 = A.pts[s + 1];
        const sMinX = Math.min(a0.x, a1.x), sMaxX = Math.max(a0.x, a1.x);
        const sMinY = Math.min(a0.y, a1.y), sMaxY = Math.max(a0.y, a1.y);
        if (sMinX > B.maxX || B.minX > sMaxX || sMinY > B.maxY || B.minY > sMaxY) continue;
        for (let k = 0; k < B.pts.length - 1; k++) {
          const hit = segIntersect(a0, a1, B.pts[k], B.pts[k + 1]);
          if (!hit) continue;
          // Endpoint regions (port/marker) — skip if near either path's ends.
          if (
            dist(hit, aStart) < END_GUARD || dist(hit, aEnd) < END_GUARD ||
            dist(hit, bStart) < END_GUARD || dist(hit, bEnd) < END_GUARD
          ) continue;
          found.push({ x: hit.x, y: hit.y, seg: s, t: hit.t });
        }
      }
    }

    if (found.length === 0 || found.length > MAX_HOPS_PER_EDGE) continue;

    // Sort by path order, collapse very close ones into one.
    found.sort((p, q) => (p.seg - q.seg) || (p.t - q.t));
    const dedup: EdgeHop[] = [];
    for (const h of found) {
      const last = dedup[dedup.length - 1];
      if (last && Math.hypot(h.x - last.x, h.y - last.y) < MIN_HOP_GAP) continue;
      dedup.push(h);
    }
    out.set(A.id, dedup);
  }

  return out;
}
