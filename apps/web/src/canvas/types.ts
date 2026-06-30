export interface SceneNode {
  id: string;
  type: string;
  name: string;
  family?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isReference: boolean;
  version?: number; // optimistic concurrency — canvas rename's expectedVersion
  /** Implementation counters from code (CLI/extension report) — completion badge. */
  implTotal?: number;
  implFilled?: number;
  implAi?: number;
  properties: Record<string, unknown>;
  /** AI streaming pop animation — performance.now() when first seen. */
  enterStart?: number;
  /** Arrange target position — render loop lerps current x/y towards this. */
  targetX?: number;
  targetY?: number;
}

export interface SceneEdge {
  id: string;
  kind: string;
  source: string; // node id
  target: string;
  isAsync?: boolean; // backend properties.IsAsync — undefined if absent
  label?: string;    // backend properties.Label or Protocol
  /** AI streaming fade-in animation — performance.now() when first seen. */
  enterStart?: number;
}

// Animation timing — zen ease-out, no bounce
export const ANIM_NODE_POP_MS = 320;   // scale 0.88→1 + opacity 0→1
export const ANIM_EDGE_FADE_MS = 280;  // opacity 0→1
export const ANIM_EDGE_DELAY_MS = 80;  // let node settle, then edge catches up
export const ANIM_LERP_FACTOR = 0.18;  // position lerp per frame (≈400ms convergence)

// ── Selection spotlight (focus subgraph) ──────────────────────────
// When a node is selected: the node + its 1-hop neighbours + incident edges
// stay full opacity; everything else fades back to FOCUS_DIM_ALPHA.
export const FOCUS_DIM_ALPHA = 0.16;   // out-of-focus element opacity at full dim
export const FOCUS_FADE_FACTOR = 0.22; // dim transition lerp per frame (short fade)

/** Spotlight focus set — selected node + 1-hop neighbours + incident edges.
 *  null = no selection → full render (no dimming). */
export interface FocusSet {
  nodes: Set<string>;
  edges: Set<string>;
}

export interface Scene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  index: Map<string, SceneNode>; // id → node (fast lookup during edge drawing)
}

/** Screen = world * zoom + pan. */
export interface Viewport {
  x: number; // pan (screen px)
  y: number;
  zoom: number;
}

export const NODE_W = 168;
export const NODE_H = 60;
