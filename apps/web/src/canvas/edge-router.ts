/** Obstacle-aware elbow routing — adapted from web-old/edge-routing.ts for bend-ratio.
 *
 *  Algorithm: if a 3-segment Z-shape path (start → corner1 → corner2 → end) collides
 *  with obstacle bboxes, shift the bend ratio to an obstacle-free position. Candidate
 *  ratios = mx (horizontal) / my (vertical) values passing through obstacle edges.
 *  Sorting: closest to default 0.5 first. First clear candidate wins.
 *
 *  If the user has manually set a bend, this function is not called — CanvasView
 *  gives priority to explicit overrides. No detour fallback (6-point polyline);
 *  if no candidate is clear, returns 0.5, leaving it for the user to manually adjust. */

import type { SceneNode } from "./types";
import { portOf, STUB_LEN_WORLD } from "./renderer";

const PAD = 16; // obstacle bbox inflation (prevents sticking to node)
const BEND_MIN = 0.05;
const BEND_MAX = 0.95;

interface Bounds { x: number; y: number; w: number; h: number }

const inflate = (b: Bounds): Bounds => ({ x: b.x - PAD, y: b.y - PAD, w: b.w + PAD * 2, h: b.h + PAD * 2 });

const rangesOverlap = (a0: number, a1: number, b0: number, b1: number): boolean => {
  const lo0 = Math.min(a0, a1), hi0 = Math.max(a0, a1);
  const lo1 = Math.min(b0, b1), hi1 = Math.max(b0, b1);
  return lo0 < hi1 && lo1 < hi0;
};

const vHits = (x: number, y0: number, y1: number, o: Bounds): boolean =>
  x > o.x && x < o.x + o.w && rangesOverlap(y0, y1, o.y, o.y + o.h);

const hHits = (y: number, x0: number, x1: number, o: Bounds): boolean =>
  y > o.y && y < o.y + o.h && rangesOverlap(x0, x1, o.x, o.x + o.w);

/** Does the 3-segment path for a given bend ratio collide with any obstacle? */
function isClear(
  start: { x: number; y: number }, end: { x: number; y: number },
  ratio: number, horiz: boolean, obs: Bounds[],
): boolean {
  if (horiz) {
    const mx = start.x + (end.x - start.x) * ratio;
    const xLo1 = Math.min(start.x, mx), xHi1 = Math.max(start.x, mx);
    const xLo2 = Math.min(mx, end.x), xHi2 = Math.max(mx, end.x);
    const yLo = Math.min(start.y, end.y), yHi = Math.max(start.y, end.y);
    for (const o of obs) {
      if (hHits(start.y, xLo1, xHi1, o)) return false;
      if (vHits(mx, yLo, yHi, o)) return false;
      if (hHits(end.y, xLo2, xHi2, o)) return false;
    }
  } else {
    const my = start.y + (end.y - start.y) * ratio;
    const yLo1 = Math.min(start.y, my), yHi1 = Math.max(start.y, my);
    const yLo2 = Math.min(my, end.y), yHi2 = Math.max(my, end.y);
    const xLo = Math.min(start.x, end.x), xHi = Math.max(start.x, end.x);
    for (const o of obs) {
      if (vHits(start.x, yLo1, yHi1, o)) return false;
      if (hHits(my, xLo, xHi, o)) return false;
      if (vHits(end.x, yLo2, yHi2, o)) return false;
    }
  }
  return true;
}

/** Called when no manual bend is set. Returns first clear candidate ratio; otherwise 0.5.
 *  Path scope: stubOut → middle path → stubIn. Obstacle check within this range. */
export function autoBendRatio(source: SceneNode, target: SceneNode, obstacles: SceneNode[]): number {
  const portOutW = portOf(source, "out");
  const portInW = portOf(target, "in");
  const start = { x: portOutW.x + STUB_LEN_WORLD, y: portOutW.y };
  const end = { x: portInW.x - STUB_LEN_WORLD, y: portInW.y };
  const dx = end.x - start.x, dy = end.y - start.y;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return 0.5;

  const horiz = Math.abs(dx) >= Math.abs(dy);
  const obs = obstacles.map((n) => inflate({ x: n.x, y: n.y, w: n.w, h: n.h }));

  // Is default clear? Exit early.
  if (isClear(start, end, 0.5, horiz, obs)) return 0.5;

  // Candidate ratios: mx/my values passing through obstacle edges
  const candidates: number[] = [];
  if (horiz && dx !== 0) {
    for (const o of obs) {
      candidates.push((o.x - 2 - start.x) / dx);          // just left of left edge
      candidates.push((o.x + o.w + 2 - start.x) / dx);    // just right of right edge
    }
  } else if (!horiz && dy !== 0) {
    for (const o of obs) {
      candidates.push((o.y - 2 - start.y) / dy);
      candidates.push((o.y + o.h + 2 - start.y) / dy);
    }
  }

  // Filter to valid range + sort (closest to default 0.5 first)
  const valid = candidates
    .filter((r) => r > BEND_MIN && r < BEND_MAX)
    .sort((a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5));

  for (const r of valid) {
    if (isClear(start, end, r, horiz, obs)) return r;
  }
  return 0.5; // fallback — obstructed but default; user can manually adjust
}
