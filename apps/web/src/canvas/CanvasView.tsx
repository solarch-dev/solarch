import { useEffect, useRef } from "react";
import type { TabGraphData } from "../api/tabs";
import { drawScene, drawPendingEdge, PORT_R, BEND_HANDLE_R, STUB_LEN_WORLD, HOP_MIN_ZOOM, elbowGeom, portOf, nodeDisplayH, type EdgeHop } from "./renderer";
import { NODE_H, ANIM_NODE_POP_MS, ANIM_EDGE_FADE_MS, ANIM_EDGE_DELAY_MS, ANIM_LERP_FACTOR, FOCUS_FADE_FACTOR, type Scene, type SceneNode, type SceneEdge, type Viewport, type FocusSet } from "./types";
import { nameOf, familyOf } from "./families";
import { nodeDefaultW } from "./node-templates";
import { arrangeNodes } from "./arrange";
import { autoBendRatio } from "./edge-router";
import { computeBundles, computeCorridors, type Bundles } from "./edge-bundling";
import { computeEdgeHops } from "./edge-hops";
import { isAiActive } from "../api/ai";
import { useUiPrefs } from "../state/ui-prefs";
import { useCanvasState } from "../state/canvas-state";
import { useSelection } from "../state/selection";
import { useHistory } from "../state/history";
import { usePendingProposal } from "../state/pending-proposal";
import { useCanvasCommands } from "./canvas-commands";
import { hapticTap, hapticConfirm } from "../lib/haptics";
import { useTouchMode } from "../hooks/useTouchMode";
import { CanvasA11yMirror } from "./CanvasA11yMirror";
import "./CanvasView.css";

/** Diff-aware buildScene — for AI streaming + manual mutation.
 *  - New node/edge: enterStart=now → triggers pop animation
 *  - Existing node: position preserved (drag/optimistic update not broken),
 *    properties/name are refreshed.
 *  If prefersReducedMotion, pop animations are disabled (enterStart=undefined). */
interface BuildResult {
  scene: Scene;
  newNodeIds: string[];
  newEdgeIds: string[];
  /** Existing nodes whose version increased (content edited) → "edited" pulse. */
  editedNodeIds: string[];
}

function buildScene(graph: TabGraphData, prev: Scene | null, now: number, reducedMotion: boolean): BuildResult {
  const prevIdx = prev?.index;
  const prevEdgeIdx = prev ? new Map(prev.edges.map((e) => [e.id, e])) : null;
  const newNodeIds: string[] = [];
  const newEdgeIds: string[] = [];
  const editedNodeIds: string[] = [];

  const nodes: SceneNode[] = graph.nodes.map((m) => {
    const old = prevIdx?.get(m.id);
    if (old) {
      // Existing node — current pos & enterStart preserved (drag/anim continues),
      // only content fields refreshed (AI can update).
      // Version increased = content edited (rename/refactor) → "edited" pulse.
      if (m.version !== undefined && old.version !== undefined && m.version > old.version) {
        editedNodeIds.push(m.id);
      }
      return {
        ...old,
        type: m.type,
        name: nameOf(m.properties),
        family: familyOf(m.type),
        w: nodeDefaultW(m.type),
        isReference: m.isReference,
        version: m.version, // optimistic concurrency (canvas rename)
        implTotal: m.implTotal, implFilled: m.implFilled, implAi: m.implAi,
        properties: m.properties,
      };
    }
    // New node — backend provides position; arrange provides targetX/Y
    newNodeIds.push(m.id);
    return {
      id: m.id, type: m.type, name: nameOf(m.properties),
      family: familyOf(m.type),
      x: m.position.x, y: m.position.y,
      w: nodeDefaultW(m.type), h: NODE_H,
      isReference: m.isReference,
      version: m.version,
      implTotal: m.implTotal, implFilled: m.implFilled, implAi: m.implAi,
      properties: m.properties,
      enterStart: reducedMotion ? undefined : now,
    };
  });
  const index = new Map(nodes.map((n) => [n.id, n]));

  const edges: SceneEdge[] = graph.edges.map((e) => {
    const old = prevEdgeIdx?.get(e.id);
    if (old) {
      return { ...old, kind: e.kind, source: e.sourceNodeId, target: e.targetNodeId };
    }
    newEdgeIds.push(e.id);
    return {
      id: e.id, kind: e.kind, source: e.sourceNodeId, target: e.targetNodeId,
      enterStart: reducedMotion ? undefined : now,
    };
  });
  return { scene: { nodes, edges, index }, newNodeIds, newEdgeIds, editedNodeIds };
}

/** prefers-reduced-motion media query — accessibility. */
function getReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function CanvasView({ graph, onNodeMoved, onContextMenu, onEdgeDrop, onArrange, onApplyLayout, onEdgeDelete }: {
  graph: TabGraphData;
  onNodeMoved?: (nodeId: string, x: number, y: number) => void;
  onContextMenu?: (world: { x: number; y: number }, screen: { x: number; y: number }) => void;
  onEdgeDrop?: (nodeId: string, side: "in" | "out", world: { x: number; y: number }, screen: { x: number; y: number }, targetNodeId?: string) => void;
  onArrange?: (items: { nodeId: string; x: number; y: number }[]) => void;
  /** Programmatic layout apply for Undo/Redo buttons — routed to saveLayout.mutate(items). */
  onApplyLayout?: (items: { nodeId: string; x: number; y: number }[]) => void;
  onEdgeDelete?: (edgeId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vp = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const scene = useRef<Scene>({ nodes: [], edges: [], index: new Map() });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const raf = useRef(0);
  const fitted = useRef(false);
  const selected = useRef<string | null>(null);
  const hovered = useRef<string | null>(null);
  const pending = useRef<{ sourceId: string; side: "in" | "out"; cur: { x: number; y: number } } | null>(null);
  const hud = useRef<HTMLDivElement>(null);
  const hoveredEdge = useRef<string | null>(null);
  const selectedEdge = useRef<string | null>(null);
  const edgePath = useUiPrefs((s) => s.edgePath);
  const edgePathRef = useRef(edgePath);
  edgePathRef.current = edgePath;
  const edgeBends = useCanvasState((s) => s.edgeBends);
  const setBend = useCanvasState((s) => s.setBend);
  const edgeBendsRef = useRef(edgeBends);
  edgeBendsRef.current = edgeBends;
  // Touch mode (coarse pointer) — render loop + hit-tests read it via ref.
  const isTouchMode = useTouchMode().isTouch;
  const coarseRef = useRef(isTouchMode);
  coarseRef.current = isTouchMode;
  // Tap-to-connect: "armed" source port — tap port→ARM, next tap connects the target
  // (WCAG 2.5.7 drag-free alternative). Render loop reads it from ref for highlight.
  const armedPortRef = useRef<{ nodeId: string; side: "in" | "out" } | null>(null);
  // Pending AI proposal (green highlight) — render loop reads it via ref.
  const proposalNodes = usePendingProposal((s) => s.nodeIds);
  const proposalEdges = usePendingProposal((s) => s.edgeIds);
  const proposalRef = useRef<{ nodes: Set<string>; edges: Set<string> } | null>(null);
  // Global selection store for sidebar Inspector
  const selectNode = useSelection((s) => s.selectNode);
  const selectedFromStore = useSelection((s) => s.selectedNodeId);
  const selectedFromStoreRef = useRef(selectedFromStore);
  selectedFromStoreRef.current = selectedFromStore;
  // History — disabled state subscription for undo/redo buttons
  const canUndo = useHistory((s) => s.past.length > 0);
  const canRedo = useHistory((s) => s.future.length > 0);
  const onApplyLayoutRef = useRef(onApplyLayout);
  onApplyLayoutRef.current = onApplyLayout;
  const onEdgeDeleteRef = useRef(onEdgeDelete);
  onEdgeDeleteRef.current = onEdgeDelete;
  const onEdgeDropRef = useRef(onEdgeDrop);
  onEdgeDropRef.current = onEdgeDrop;

  // Optimistic apply: update scene instantly (visual immediate) + write to backend (async)
  const applyLayoutItems = (items: { nodeId: string; x: number; y: number }[]) => {
    for (const item of items) {
      const n = scene.current.index.get(item.nodeId);
      if (n) { n.x = item.x; n.y = item.y; }
    }
    schedule();
    onApplyLayoutRef.current?.(items);
  };

  const onUndoClick = () => { useHistory.getState().undo(); };
  const onRedoClick = () => { useHistory.getState().redo(); };

  // Soft focus for AI chat NodeChip / EdgeChip — viewport target + highlight halo.
  // When vpTarget is set, render loop lerps current viewport towards it each frame,
  // becomes undefined when settled. Highlight 600ms fade-out.
  const vpTarget = useRef<Viewport | null>(null);
  const focusHighlight = useRef<{ nodeIds: Set<string>; edgeId: string | null; start: number; duration: number } | null>(null);

  // autoBendRatio cache — computed once per edge as long as sceneSig hasn't changed.
  // If a node moves during drag, sig changes → entire cache is invalidated,
  // recomputed. In steady state, saves O(E) across frames.
  const routeCache = useRef<{ sig: number; map: Map<string, number> }>({ sig: -1, map: new Map() });

  // Bundle cache — same sceneSig pattern; computed once for all edges (port-spread).
  const bundleCache = useRef<{ sig: number; bundles: Bundles | null }>({ sig: -1, bundles: null });

  // Corridor cache — offsets that spread elbow middle segments side by side (same sig pattern).
  const corridorCache = useRef<{ sig: number; map: Map<string, number> | null }>({ sig: -1, map: null });

  // Hop cache — crossing hops. O(E²·S²) cost → computed only when the scene is settled
  // (no animation/lerp); during animation drawn without hops.
  const hopsCache = useRef<{ sig: number; mode: string; map: Map<string, EdgeHop[]> | null }>({ sig: -1, mode: "", map: null });

  // ── Selection spotlight (focus subgraph) ───────────────────────────
  // focusSet = selected node + its 1-hop neighbours + incident edges.
  // Recomputed ONCE per (selection, edge-topology) change — guarded by focusSig,
  // NOT per frame. dimAmount lerps 0→1 (focus on) / 1→0 (focus off) for a short fade.
  const focusSet = useRef<FocusSet | null>(null);
  const focusSig = useRef<string>("");
  const dimAmount = useRef(0);
  // Instruct-narration focus — the node currently being highlighted by an instruct
  // marker (focusNode({ instruct: true })). This is an ALTERNATE spotlight source,
  // independent of canvas selection (it never writes selectedNodeId). When set it
  // takes priority over the selection as the spotlight origin; cleared when the
  // instruct panel closes / a new stream starts.
  const instructFocusId = useRef<string | null>(null);

  /** Recompute focusSet if the spotlight source (instruct-focus OR selection) or the
   *  edge topology changed. Cheap O(E) numeric hash per frame; the actual set rebuild
   *  (also O(E)) only runs when the signature differs (≈ once per select / per instruct
   *  marker / per AI edge add), not every frame. */
  const ensureFocusSet = () => {
    // Spotlight source: active instruct-narration node takes priority, else canvas
    // selection. Either one lights up the same selected+1-hop+incident subgraph.
    const src = instructFocusId.current ?? selectedFromStoreRef.current;
    // Topology hash — folds edge id/source/target into a 32-bit int. Cheap, no
    // allocation; changes only when the edge set or its endpoints change.
    const sceneEdges = scene.current.edges;
    let topoHash = sceneEdges.length;
    for (const e of sceneEdges) {
      for (let i = 0; i < e.id.length; i++) topoHash = (topoHash * 31 + e.id.charCodeAt(i)) | 0;
      for (let i = 0; i < e.source.length; i++) topoHash = (topoHash * 31 + e.source.charCodeAt(i)) | 0;
      for (let i = 0; i < e.target.length; i++) topoHash = (topoHash * 31 + e.target.charCodeAt(i)) | 0;
    }
    const sig = (src ?? "∅") + "#" + topoHash;
    if (sig === focusSig.current) return;
    focusSig.current = sig;
    if (!src || !scene.current.index.has(src)) {
      focusSet.current = null;
      return;
    }
    const nodes = new Set<string>([src]);
    const edges = new Set<string>();
    for (const e of scene.current.edges) {
      if (e.source === src) { edges.add(e.id); nodes.add(e.target); }
      else if (e.target === src) { edges.add(e.id); nodes.add(e.source); }
    }
    focusSet.current = { nodes, edges };
  };

  // Render-time bend calculation: manual override takes priority, otherwise obstacle-aware auto-route (cached).
  const getBendForRender = (edgeId: string): number | undefined => {
    const explicit = edgeBendsRef.current[edgeId];
    if (explicit !== undefined) return explicit;
    if (edgePathRef.current !== "elbow") return undefined;
    const cached = routeCache.current.map.get(edgeId);
    if (cached !== undefined) return cached;
    const sc = scene.current;
    const e = sc.edges.find((x) => x.id === edgeId);
    if (!e) return undefined;
    const a = sc.index.get(e.source); const b = sc.index.get(e.target);
    if (!a || !b) return undefined;
    const obstacles = sc.nodes.filter((n) => n.id !== a.id && n.id !== b.id);
    const r = autoBendRatio(a, b, obstacles);
    routeCache.current.map.set(edgeId, r);
    return r;
  };

  const render = () => {
    raf.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ── AI streaming animation advance ─────────────────────────────
    // Nodes/edges whose enterStart duration has elapsed are marked "settled" (undef).
    // If targetX/Y exists, current x/y approaches via exponential lerp.
    // If at least one node/edge is still animating, frame loop re-arms itself.
    const now = performance.now();
    let stillAnimating = false;
    for (const n of scene.current.nodes) {
      if (n.enterStart !== undefined) {
        if (now - n.enterStart >= ANIM_NODE_POP_MS) n.enterStart = undefined;
        else stillAnimating = true;
      }
      if (n.targetX !== undefined && n.targetY !== undefined) {
        const dx = n.targetX - n.x;
        const dy = n.targetY - n.y;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          n.x = n.targetX; n.y = n.targetY;
          n.targetX = undefined; n.targetY = undefined;
        } else {
          n.x += dx * ANIM_LERP_FACTOR;
          n.y += dy * ANIM_LERP_FACTOR;
          stillAnimating = true;
        }
      }
    }
    for (const e of scene.current.edges) {
      if (e.enterStart !== undefined) {
        if (now - e.enterStart >= ANIM_NODE_POP_MS + ANIM_EDGE_DELAY_MS + ANIM_EDGE_FADE_MS) {
          e.enterStart = undefined;
        } else {
          stillAnimating = true;
        }
      }
    }

    // Viewport target lerp — set by focusNode/focusEdge calls
    if (vpTarget.current) {
      const t = vpTarget.current;
      const dx = t.x - vp.current.x;
      const dy = t.y - vp.current.y;
      const dz = t.zoom - vp.current.zoom;
      if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4 && Math.abs(dz) < 0.002) {
        vp.current = { ...t };
        vpTarget.current = null;
      } else {
        vp.current.x += dx * ANIM_LERP_FACTOR;
        vp.current.y += dy * ANIM_LERP_FACTOR;
        vp.current.zoom += dz * ANIM_LERP_FACTOR;
        stillAnimating = true;
      }
    }
    // Highlight halo expire
    if (focusHighlight.current) {
      if (now - focusHighlight.current.start >= focusHighlight.current.duration) {
        focusHighlight.current = null;
      } else {
        stillAnimating = true;
      }
    }

    // Selection spotlight — recompute focus set once (guarded), lerp dimAmount.
    ensureFocusSet();
    const dimTarget = focusSet.current ? 1 : 0;
    const dd = dimTarget - dimAmount.current;
    if (Math.abs(dd) > 0.002) {
      dimAmount.current += dd * FOCUS_FADE_FACTOR;
      stillAnimating = true;
    } else {
      dimAmount.current = dimTarget;
    }

    // Defer fit until size is known; fit once when known.
    if (!fitted.current && size.current.w > 0 && scene.current.nodes.length > 0) {
      fit();
      fitted.current = true;
    }
    // Cache invalidation — sceneSig is a topology+pos hash; all geometry caches share it.
    // Edge set and manual bends also change geometry → included in sig
    // (otherwise edge add/remove or bend drag leaves the corridor/hop cache stale).
    const ns = scene.current.nodes;
    let sig = ns.length;
    for (const n of ns) sig = (sig * 31 + n.x * 73 + n.y) | 0;
    for (const e of scene.current.edges) {
      for (let ci = 0; ci < e.id.length; ci += 7) sig = (sig * 33 + e.id.charCodeAt(ci)) | 0;
    }
    const bends = edgeBendsRef.current;
    for (const k in bends) sig = (sig * 31 + ((bends[k] * 1000) | 0)) | 0;
    if (edgePathRef.current === "elbow" && routeCache.current.sig !== sig) {
      routeCache.current.sig = sig;
      routeCache.current.map.clear();
    }
    if (bundleCache.current.sig !== sig) {
      bundleCache.current.sig = sig;
      bundleCache.current.bundles = computeBundles(scene.current.edges, scene.current.index);
    }
    const getBundle = (edgeId: string) => {
      const b = bundleCache.current.bundles;
      if (!b) return undefined;
      const s = b.src.get(edgeId) ?? 0;
      const t = b.tgt.get(edgeId) ?? 0;
      return s === 0 && t === 0 ? undefined : { src: s, tgt: t };
    };
    // Corridor spread — only meaningful in elbow mode (middle segment shift).
    if (edgePathRef.current === "elbow") {
      if (corridorCache.current.sig !== sig) {
        corridorCache.current.sig = sig;
        corridorCache.current.map = computeCorridors(
          scene.current.edges, scene.current.index, getBendForRender, STUB_LEN_WORLD, portOf,
        );
      }
    } else {
      corridorCache.current.map = null;
      corridorCache.current.sig = -1;
    }
    // Crossing hops — expensive; only when the scene is settled + sufficient zoom.
    // During animation the old sig is kept → hopless draw (visually natural:
    // a hop on a moving line is unreadable anyway).
    if (!stillAnimating && vp.current.zoom >= HOP_MIN_ZOOM) {
      if (hopsCache.current.sig !== sig || hopsCache.current.mode !== edgePathRef.current) {
        hopsCache.current.sig = sig;
        hopsCache.current.mode = edgePathRef.current;
        hopsCache.current.map = computeEdgeHops(
          scene.current, edgePathRef.current, getBendForRender,
          (id) => getBundle(id) ?? { src: 0, tgt: 0 },
          corridorCache.current.map,
        );
      }
    } else if (stillAnimating) {
      hopsCache.current.map = null;
      hopsCache.current.sig = -1;
    }
    ctx.setTransform(size.current.dpr, 0, 0, size.current.dpr, 0, 0);
    const p = pending.current;
    drawScene(ctx, size.current.w, size.current.h, scene.current, vp.current, selected.current, hovered.current, edgePathRef.current, getBendForRender, hoveredEdge.current, selectedEdge.current, getBundle, now, focusSet.current, dimAmount.current, proposalRef.current, corridorCache.current.map, hopsCache.current.map, coarseRef.current, armedPortRef.current);

    // Focus highlight halo (orange, fade out) — overlay after drawScene
    if (focusHighlight.current) {
      const fh = focusHighlight.current;
      const elapsed = now - fh.start;
      const t = Math.min(1, elapsed / fh.duration);
      const alpha = Math.max(0, 1 - t); // linear fade out
      ctx.save();
      ctx.strokeStyle = `rgba(255, 138, 61, ${alpha * 0.95})`;
      ctx.shadowColor = `rgba(255, 138, 61, ${alpha * 0.55})`;
      ctx.shadowBlur = 24;
      ctx.lineWidth = 3;
      for (const nid of fh.nodeIds) {
        const n = scene.current.index.get(nid);
        if (!n) continue;
        const x = n.x * vp.current.zoom + vp.current.x;
        const y = n.y * vp.current.zoom + vp.current.y;
        const w = n.w * vp.current.zoom;
        const h = nodeDisplayH(n) * vp.current.zoom;
        const pad = 6;
        ctx.beginPath();
        const r = 14;
        const rx = x - pad, ry = y - pad, rw = w + pad * 2, rh = h + pad * 2;
        ctx.moveTo(rx + r, ry);
        ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
        ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
        ctx.arcTo(rx, ry + rh, rx, ry, r);
        ctx.arcTo(rx, ry, rx + rw, ry, r);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }

    if (stillAnimating) {
      // Re-arm frame loop — auto-stops when settled.
      raf.current = requestAnimationFrame(render);
      return;
    }
    // Arrow-drag rubber-band (on top of scene)
    if (p) {
      const s = scene.current.index.get(p.sourceId);
      if (s) {
        const v = vp.current;
        const port = portOf(s, p.side);
        const portS = { x: port.x * v.zoom + v.x, y: port.y * v.zoom + v.y };
        const curS = { x: p.cur.x * v.zoom + v.x, y: p.cur.y * v.zoom + v.y };
        // output → cursor (forward); cursor → input (backward)
        drawPendingEdge(ctx, p.side === "out" ? portS : curS, p.side === "out" ? curS : portS);
      }
    }
    if (hud.current) hud.current.textContent = armedPortRef.current
      ? "Tap the target node to connect · Esc to cancel"
      : `${scene.current.nodes.length} node · ${scene.current.edges.length} edge · ${Math.round(vp.current.zoom * 100)}%`;

    // Sync canvas-commands store — BottomBar zoomPercent + NodeActionBar/HoverCard position
    useCanvasCommands.getState().set({
      viewport: { ...vp.current },
      nodes: scene.current.nodes,
      zoomPercent: vp.current.zoom * 100,
    });
  };
  const schedule = () => { if (!raf.current) raf.current = requestAnimationFrame(render); };

  const resize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    size.current = { w: rect.width, h: rect.height, dpr };
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    schedule();
  };

  const fit = () => {
    const ns = scene.current.nodes;
    const { w, h } = size.current;
    if (!ns.length || !w) { vp.current = { x: 0, y: 0, zoom: 1 }; return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of ns) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + nodeDisplayH(n));
    }
    const pad = 80;
    const zoom = clamp(Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1)), 0.1, 1.4);
    vp.current = {
      zoom,
      x: w / 2 - ((minX + maxX) / 2) * zoom,
      y: h / 2 - ((minY + maxY) / 2) * zoom,
    };
  };

  // Build scene when data changes. Fit only on first load (mount); on refetch
  // (e.g. node addition) don't re-fit to avoid viewport jump.
  //
  // AI streaming: setQueryData triggers this effect for each node/edge. Diff-aware
  // buildScene marks new arrivals with enterStart=now → renderer triggers pop animation.
  // If new nodes exist, arrange is called and targetX/Y is written → existing nodes
  // smooth-slide to new targets, new nodes spawn at target position. Positions are
  // persisted to backend via saveLayout → persist across reload.
  useEffect(() => {
    const prevSel = selected.current;
    const prev = scene.current.nodes.length > 0 ? scene.current : null;
    const now = performance.now();
    const reducedMotion = getReducedMotion();
    const { scene: newScene, newNodeIds, newEdgeIds, editedNodeIds } = buildScene(graph, prev, now, reducedMotion);
    scene.current = newScene;
    if (prevSel && !scene.current.index.has(prevSel)) selected.current = null;

    // Edited nodes (AI refactor / rename) → calm in-place "edited" pulse:
    // triggers the existing focus halo without panning. schedule() (end of effect) draws it.
    if (!reducedMotion && editedNodeIds.length > 0) {
      focusHighlight.current = { nodeIds: new Set(editedNodeIds), edgeId: null, start: now, duration: 700 };
    }

    // Arrange trigger: a new node ALWAYS; a new edge only during AI generation
    // or right after (covers edges from the post-stream refetch too;
    // a manually drawn edge must not disturb the user's hand layout).
    const aiEdgeArrived = newEdgeIds.length > 0 && prev !== null && isAiActive();
    if ((newNodeIds.length > 0 || aiEdgeArrived) && scene.current.nodes.length > 1) {
      // New node/AI edge arrived → run arrange for entire scene
      const pos = arrangeNodes(scene.current.nodes, scene.current.edges, "LR");
      const items: { nodeId: string; x: number; y: number }[] = [];
      const newSet = new Set(newNodeIds);
      for (const n of scene.current.nodes) {
        const p = pos.get(n.id);
        if (!p) continue;
        if (newSet.has(n.id)) {
          // New node: spawn at target position (pop from there) — no layout shift
          n.x = p.x; n.y = p.y;
        } else if (Math.abs(p.x - n.x) > 0.5 || Math.abs(p.y - n.y) > 0.5) {
          // Existing node: smooth lerp from current pos to target
          n.targetX = p.x; n.targetY = p.y;
        }
        items.push({ nodeId: n.id, x: p.x, y: p.y });
      }
      // Persist to backend — positions survive page reload
      onApplyLayoutRef.current?.(items);
    }
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Redraw when edgePath mode changes (graph unchanged, visual only)
  useEffect(() => { schedule(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [edgePath]);

  // On theme change (light↔dark) let the renderer re-read CSS variables → redraw once.
  useEffect(() => {
    const onTheme = () => schedule();
    window.addEventListener("solarch:theme-change", onTheme);
    return () => window.removeEventListener("solarch:theme-change", onTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inline AI proposal — pending green set; on change refresh the ref + redraw.
  useEffect(() => {
    proposalRef.current =
      proposalNodes.size > 0 || proposalEdges.size > 0
        ? { nodes: proposalNodes, edges: proposalEdges }
        : null;
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalNodes, proposalEdges]);

  // Redraw when bend changes (during drag setBend → store → flows here)
  useEffect(() => { schedule(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [edgeBends]);

  // Redraw when canonical selection changes (any source: click, AI chip, Inspector) →
  // spotlight focus set recomputes + dim transition fades in/out. Also sync the
  // local selection-halo ref so the orange highlight follows non-click selection
  // sources (AI chip / Inspector), keeping the halo and spotlight on the same node.
  useEffect(() => {
    selected.current = selectedFromStore;
    schedule();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [selectedFromStore]);

  // Auto-arrange: run dagre → optimistically update scene → write to backend via parent callback
  const doArrange = () => {
    const ns = scene.current.nodes;
    if (ns.length === 0) return;
    // History: "before" snapshot — current position of all nodes
    const before = ns.map((n) => ({ nodeId: n.id, x: n.x, y: n.y }));
    const pos = arrangeNodes(ns, scene.current.edges, "LR");
    const items: { nodeId: string; x: number; y: number }[] = [];
    for (const n of ns) {
      const p = pos.get(n.id);
      if (!p) continue;
      n.x = p.x; n.y = p.y;
      items.push({ nodeId: n.id, x: p.x, y: p.y });
    }
    fitted.current = false; // re-fit viewport to content after arrange
    schedule();
    onArrange?.(items);
    if (items.length > 0) {
      const beforeSnap = before;
      const afterSnap = items;
      useHistory.getState().record({
        undo: () => applyLayoutItems(beforeSnap),
        redo: () => applyLayoutItems(afterSnap),
      });
    }
  };

  // Alt+L shortcut — global (works even without canvas focus)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        doArrange();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Canvas setup + resize + interaction (imperative, outside React)
  useEffect(() => {
    const canvas = canvasRef.current!;
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    document.fonts.ready.then(() => schedule());

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const z0 = vp.current.zoom;
      const z1 = clamp(z0 * factor, 0.1, 4);
      // Keep the world point under the cursor fixed
      vp.current.x = cx - ((cx - vp.current.x) / z0) * z1;
      vp.current.y = cy - ((cy - vp.current.y) / z0) * z1;
      vp.current.zoom = z1;
      schedule();
    };

    // screen → world
    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - vp.current.x) / vp.current.zoom,
        y: (clientY - rect.top - vp.current.y) / vp.current.zoom,
      };
    };
    // Topmost node under cursor (back to front = drawn on top)
    const hitTest = (wx: number, wy: number) => {
      const ns = scene.current.nodes;
      for (let i = ns.length - 1; i >= 0; i--) {
        const n = ns[i];
        if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + nodeDisplayH(n)) return n;
      }
      return null;
    };

    // Node port's SCREEN position (in on left / out on right)
    const portScreen = (n: SceneNode, side: "in" | "out") => {
      const pw = portOf(n, side);
      return { x: pw.x * vp.current.zoom + vp.current.x, y: pw.y * vp.current.zoom + vp.current.y };
    };
    // Which port is cursor near? (out / in / null) — for drag initiation + cursor
    const nearPort = (n: SceneNode, sxp: number, syp: number): "in" | "out" | null => {
      const R = PORT_R + (coarseRef.current ? 28 : 20); // wider port hit-target on touch (WCAG 2.5.8)
      const out = portScreen(n, "out");
      if (Math.hypot(sxp - out.x, syp - out.y) <= R) return "out";
      const inP = portScreen(n, "in");
      if (Math.hypot(sxp - inP.x, syp - inP.y) <= R) return "in";
      return null;
    };

    let panning = false;
    let dragNode: SceneNode | null = null;
    let dragOff = { x: 0, y: 0 };
    let dragStart: { x: number; y: number } | null = null; // "before" position for undo
    let moved = false;
    let lastX = 0, lastY = 0;
    let bendDrag: { edgeId: string; horiz: boolean; corr: number; start: { x: number; y: number }; end: { x: number; y: number } } | null = null;

    // Multi-touch: track each active pointer by its id. Two fingers → pinch-zoom +
    // two-finger pan mode. Focus point = midpoint of the two fingers; scaling
    // math is identical to onWheel (the world point under the finger stays fixed).
    const activePointers = new Map<number, { x: number; y: number }>();
    let pinch: { lastDist: number; lastCenter: { x: number; y: number } } | null = null;

    // Touch long-press → context menu (right-click alternative). If the finger is held
    // still ~500ms, AddNodeMenu opens; if it slides (pan/drag intent) it is cancelled.
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressX = 0, pressY = 0;
    const clearLongPress = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };

    // Tap-to-connect: screen point where port-drag began — at release a movement threshold
    // distinguishes "tap vs drag" (tap → ARM, drag → classic drag-to-connect).
    let pendingDown = { x: 0, y: 0 };
    // Scan any node's port under the finger/cursor (not tied to hover).
    const scanPort = (sxp: number, syp: number): { node: SceneNode; side: "in" | "out" } | null => {
      const ns = scene.current.nodes;
      for (let i = ns.length - 1; i >= 0; i--) {
        const side = nearPort(ns[i], sxp, syp);
        if (side) return { node: ns[i], side };
      }
      return null;
    };

    // Elbow handle hit-test: is cursor (in screen coords) near a bend handle?
    // Corridor offset applied the same way as drawing (so the handle stays on the wire).
    const hitBendHandle = (sxp: number, syp: number) => {
      if (edgePathRef.current !== "elbow") return null;
      const sc = scene.current;
      const v = vp.current;
      for (const e of sc.edges) {
        const a = sc.index.get(e.source); const b = sc.index.get(e.target);
        if (!a || !b) continue;
        const g = elbowGeom(a, b, edgeBendsRef.current[e.id] ?? 0.5);
        if (!g) continue;
        const corr = corridorCache.current.map?.get(e.id) ?? 0;
        const hx = (g.handle.x + (g.horiz ? corr : 0)) * v.zoom + v.x;
        const hy = (g.handle.y + (g.horiz ? 0 : corr)) * v.zoom + v.y;
        if (Math.hypot(sxp - hx, syp - hy) <= BEND_HANDLE_R + (coarseRef.current ? 16 : 4)) {
          return { edgeId: e.id, horiz: g.horiz, corr, start: g.start, end: g.end };
        }
      }
      return null;
    };

    // Point → segment perpendicular distance (screen px)
    const pointToSegDist = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(px - x1, py - y1);
      let t = ((px - x1) * dx + (py - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    };

    // Edge hit-test — works in all modes (elbow: middle segment, bezier: sampling, straight: full path)
    const hitEdge = (sxp: number, syp: number): string | null => {
      const sc = scene.current;
      const v = vp.current;
      const mode = edgePathRef.current;
      const THRESHOLD = coarseRef.current ? 18 : 8; // wider edge hit-target on touch
      let best: string | null = null, bestD = Infinity;
      for (const e of sc.edges) {
        const a = sc.index.get(e.source); const b = sc.index.get(e.target);
        if (!a || !b) continue;

        const portOutW = portOf(a, "out");
        const portInW = portOf(b, "in");
        const STUB = STUB_LEN_WORLD * v.zoom;
        const portOutS = { x: portOutW.x * v.zoom + v.x, y: portOutW.y * v.zoom + v.y };
        const portInS  = { x: portInW.x  * v.zoom + v.x, y: portInW.y  * v.zoom + v.y };
        const stubOutS = { x: portOutS.x + STUB, y: portOutS.y };
        const stubInS  = { x: portInS.x  - STUB, y: portInS.y  };

        let d = Infinity;

        if (mode === "elbow") {
          const g = elbowGeom(a, b, edgeBendsRef.current[e.id] ?? 0.5);
          if (!g) continue;
          const corr = corridorCache.current.map?.get(e.id) ?? 0;
          const hxc = g.handle.x + (g.horiz ? corr : 0);
          const hyc = g.handle.y + (g.horiz ? 0 : corr);
          const c1 = g.horiz ? { x: hxc, y: g.start.y } : { x: g.start.x, y: hyc };
          const c2 = g.horiz ? { x: hxc, y: g.end.y }   : { x: g.end.x,   y: hyc };
          const c1s = { x: c1.x * v.zoom + v.x, y: c1.y * v.zoom + v.y };
          const c2s = { x: c2.x * v.zoom + v.x, y: c2.y * v.zoom + v.y };
          d = pointToSegDist(sxp, syp, c1s.x, c1s.y, c2s.x, c2s.y);
        } else if (mode === "straight") {
          // Only stubOut→stubIn (port stubs override port hover, not included)
          d = pointToSegDist(sxp, syp, stubOutS.x, stubOutS.y, stubInS.x, stubInS.y);
        } else { // bezier
          const dx = stubInS.x - stubOutS.x;
          const dy = stubInS.y - stubOutS.y;
          const horiz = Math.abs(dx) >= Math.abs(dy);
          const off = Math.min(Math.max(Math.abs(horiz ? dx : dy) * 0.5, 24), 220);
          const c1x = horiz ? stubOutS.x + off : stubOutS.x;
          const c1y = horiz ? stubOutS.y       : stubOutS.y + off;
          const c2x = horiz ? stubInS.x  - off : stubInS.x;
          const c2y = horiz ? stubInS.y         : stubInS.y  - off;
          // Only bezier curve (not stubs — causes noise near ports)
          for (let i = 0; i <= 16; i++) {
            const t = i / 16, mt = 1 - t;
            const bx = mt*mt*mt*stubOutS.x + 3*mt*mt*t*c1x + 3*mt*t*t*c2x + t*t*t*stubInS.x;
            const by = mt*mt*mt*stubOutS.y + 3*mt*mt*t*c1y + 3*mt*t*t*c2y + t*t*t*stubInS.y;
            d = Math.min(d, Math.hypot(sxp - bx, syp - by));
          }
        }

        if (d < THRESHOLD && d < bestD) { bestD = d; best = e.id; }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sxp = e.clientX - rect.left, syp = e.clientY - rect.top;
      const wp = toWorld(e.clientX, e.clientY);
      canvas.setPointerCapture(e.pointerId);
      moved = false;

      // Multi-touch intent gate: when the second finger lands, switch to pinch mode and
      // cancel the single-finger operation the FIRST finger started (node-drag / pan / edge /
      // bend) — prevents Excalidraw's spurious-stroke bug.
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size >= 2) {
        clearLongPress();
        if (dragNode && dragStart) { dragNode.x = dragStart.x; dragNode.y = dragStart.y; } // undo nudge
        dragNode = null; dragStart = null; pending.current = null; bendDrag = null; panning = false;
        armedPortRef.current = null;
        useCanvasCommands.getState().set({ isDragging: false });
        const p = [...activePointers.values()];
        pinch = {
          lastDist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1,
          lastCenter: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 },
        };
        canvas.style.cursor = "default";
        schedule();
        return;
      }

      // Tap-to-connect COMPLETION: while a port is armed, the next tap picks the target
      // (port or node body). Empty/same tap = cancel. Drag-free single-pointer path.
      if (armedPortRef.current) {
        const armed = armedPortRef.current;
        armedPortRef.current = null;
        const tgt = scanPort(sxp, syp)?.node ?? hitTest(wp.x, wp.y);
        if (tgt && tgt.id !== armed.nodeId) {
          onEdgeDropRef.current?.(armed.nodeId, armed.side, wp, { x: sxp, y: syp }, tgt.id);
          hapticConfirm();
        }
        canvas.style.cursor = "default";
        schedule();
        return;
      }

      // Touch long-press → context menu (finger held ~500ms ⇒ AddNodeMenu).
      // The single-finger logic below (pan/drag) is still set up; if long-press fires it is cancelled.
      if (e.pointerType === "touch") {
        pressX = e.clientX; pressY = e.clientY;
        clearLongPress();
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          if (dragNode && dragStart) { dragNode.x = dragStart.x; dragNode.y = dragStart.y; } // undo nudge
          dragNode = null; dragStart = null; pending.current = null; panning = false;
          useCanvasCommands.getState().set({ isDragging: false });
          try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
          hapticConfirm();
          const r = canvas.getBoundingClientRect();
          onContextMenu?.(toWorld(pressX, pressY), { x: pressX - r.left, y: pressY - r.top });
          canvas.style.cursor = "default";
          schedule();
        }, 500);
      }

      // 0) Elbow bend handle (before node hit-test, before port-drag)
      const bh = hitBendHandle(sxp, syp);
      if (bh) {
        clearLongPress(); // bend handle pressed: drag intent → cancel menu open
        bendDrag = bh;
        canvas.style.cursor = bh.horiz ? "ew-resize" : "ns-resize";
        return;
      }

      // 1) Start port-drag. Mouse: fast path of the hovered port; otherwise (incl. touch)
      //    scan any port under the finger → drag-to-connect works on touch.
      const hov = hovered.current ? scene.current.index.get(hovered.current) : null;
      const hovSide = hov ? nearPort(hov, sxp, syp) : null;
      const port = hovSide && hov ? { node: hov, side: hovSide } : scanPort(sxp, syp);
      if (port) {
        clearLongPress(); // port pressed: connect intent → cancel long-press menu
        pending.current = { sourceId: port.node.id, side: port.side, cur: wp };
        pendingDown = { x: sxp, y: syp }; // read at release to distinguish tap/drag
        hovered.current = port.node.id;
        canvas.style.cursor = "crosshair";
        schedule();
        return;
      }

      const hit = hitTest(wp.x, wp.y);
      if (hit) {
        dragNode = hit;
        dragOff = { x: wp.x - hit.x, y: wp.y - hit.y };
        dragStart = { x: hit.x, y: hit.y }; // undo "before" snapshot
        selected.current = hit.id;
        selectedEdge.current = null; // unselect edge when selecting node
        // Manual canvas selection wins over an active instruct narration spotlight —
        // clears it so selection becomes the sole spotlight source (no stale dim).
        instructFocusId.current = null;
        selectNode(hit.id); // forward to sidebar Inspector
        if (e.pointerType === "touch") hapticTap(); // selection tick (touch)
        canvas.style.cursor = "grabbing";
        // ActionBar/HoverCard guard — true only during node drag (not pending edge / bend drag)
        useCanvasCommands.getState().set({ isDragging: true });
      } else {
        // Empty area: try edge select first
        const edgeHit = hitEdge(sxp, syp);
        if (edgeHit) {
          selectedEdge.current = edgeHit;
          selected.current = null;
          selectNode(null); // node deselect → inspector closes
          canvas.style.cursor = "pointer";
        } else {
          panning = true;
          selected.current = null;
          selectedEdge.current = null;
          selectNode(null);
          lastX = e.clientX; lastY = e.clientY;
          canvas.style.cursor = "grabbing";
        }
      }
      schedule();
    };

    const onMove = (e: PointerEvent) => {
      // Pinch-zoom + two-finger pan (focus = finger midpoint, math same as onWheel)
      if (pinch && activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.size >= 2) {
          const p = [...activePointers.values()];
          const dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
          const center = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
          const rect = canvas.getBoundingClientRect();
          const cx = center.x - rect.left, cy = center.y - rect.top;
          const z0 = vp.current.zoom;
          const z1 = clamp(z0 * (dist / pinch.lastDist), 0.1, 4);
          // scale around the focus point (point under the finger stays fixed)
          vp.current.x = cx - ((cx - vp.current.x) / z0) * z1;
          vp.current.y = cy - ((cy - vp.current.y) / z0) * z1;
          vp.current.zoom = z1;
          // two-finger pan: viewport shifts as the midpoint moves
          vp.current.x += center.x - pinch.lastCenter.x;
          vp.current.y += center.y - pinch.lastCenter.y;
          pinch.lastDist = dist;
          pinch.lastCenter = center;
          schedule();
        }
        return;
      }
      // Long-press: if the finger slides (pan/drag intent) cancel the pending long-press
      if (longPressTimer && Math.hypot(e.clientX - pressX, e.clientY - pressY) > 10) clearLongPress();
      if (bendDrag) {
        const wp = toWorld(e.clientX, e.clientY);
        const dx = bendDrag.end.x - bendDrag.start.x;
        const dy = bendDrag.end.y - bendDrag.start.y;
        // Corridor offset is added in drawing, so it's subtracted in drag — the handle tracks the cursor.
        const ratio = bendDrag.horiz
          ? (wp.x - bendDrag.corr - bendDrag.start.x) / (dx || 1)
          : (wp.y - bendDrag.corr - bendDrag.start.y) / (dy || 1);
        setBend(bendDrag.edgeId, ratio); // store does clamp01
        return; // re-render triggered via useEffect[edgeBends]
      }
      if (pending.current) {
        pending.current.cur = toWorld(e.clientX, e.clientY);
        schedule();
      } else if (dragNode) {
        const wp = toWorld(e.clientX, e.clientY);
        // 8px snap-to-grid — nodes align neatly; free when Alt is held.
        const SNAP = 8;
        const free = e.altKey;
        const nx = wp.x - dragOff.x, ny = wp.y - dragOff.y;
        dragNode.x = free ? Math.round(nx) : Math.round(nx / SNAP) * SNAP;
        dragNode.y = free ? Math.round(ny) : Math.round(ny / SNAP) * SNAP;
        moved = true;
        schedule();
      } else if (panning) {
        vp.current.x += e.clientX - lastX;
        vp.current.y += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        schedule();
      } else {
        // hover: cursor + port + edge handle/path
        const rect = canvas.getBoundingClientRect();
        const sxp = e.clientX - rect.left, syp = e.clientY - rect.top;
        const wp = toWorld(e.clientX, e.clientY);
        let hit = hitTest(wp.x, wp.y);
        if (!hit && hovered.current) {
          const cur = scene.current.index.get(hovered.current);
          if (cur && nearPort(cur, sxp, syp) !== null) hit = cur;
        }
        // Edge hit only when no node (node takes priority)
        const edgeHit = !hit ? hitEdge(sxp, syp) : null;
        const bhHover = !hit && edgeHit ? hitBendHandle(sxp, syp) : null;

        const prevHover = hovered.current;
        const prevEdgeHover = hoveredEdge.current;
        hovered.current = hit ? hit.id : null;
        hoveredEdge.current = edgeHit;

        const onP = hit ? nearPort(hit, sxp, syp) !== null : false;
        canvas.style.cursor =
          bhHover ? (bhHover.horiz ? "ew-resize" : "ns-resize") :
          onP ? "crosshair" :
          hit ? "grab" :
          edgeHit ? "pointer" : "default";

        if (hovered.current !== prevHover) {
          useSelection.getState().setHovered(hovered.current);
        }
        if (hovered.current !== prevHover || hoveredEdge.current !== prevEdgeHover) schedule();
      }
    };

    const onUp = (e: PointerEvent) => {
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      activePointers.delete(e.pointerId);
      clearLongPress();
      // Skip drag-commit logic during pinch; end pinch when fewer than two fingers remain.
      if (pinch) {
        if (activePointers.size < 2) { pinch = null; panning = false; canvas.style.cursor = "default"; }
        return;
      }
      if (bendDrag) {
        bendDrag = null;
        canvas.style.cursor = "default";
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (pending.current) {
        const upX = e.clientX - rect.left, upY = e.clientY - rect.top;
        const wp = toWorld(e.clientX, e.clientY);
        const { sourceId, side } = pending.current;
        pending.current = null;
        hovered.current = null;
        // TAP (motionless release) → ARM the source (tap-to-connect; drag-free, WCAG 2.5.7).
        if (Math.hypot(upX - pendingDown.x, upY - pendingDown.y) < 8) {
          armedPortRef.current = { nodeId: sourceId, side };
          hapticTap();
          canvas.style.cursor = "default";
          schedule();
          return;
        }
        // DRAG → classic drag-to-connect. Release over the source = cancel.
        const dropTarget = hitTest(wp.x, wp.y);
        if (dropTarget && dropTarget.id === sourceId) {
          canvas.style.cursor = "default";
          schedule();
          return;
        }
        onEdgeDropRef.current?.(sourceId, side, wp, { x: upX, y: upY }, dropTarget ? dropTarget.id : undefined);
        canvas.style.cursor = "default";
        schedule();
        return;
      }
      if (dragNode && moved && onNodeMoved) {
        onNodeMoved(dragNode.id, dragNode.x, dragNode.y); // save new position
        // History: single node move — DON'T record if snap results in equal positions
        if (dragStart) {
          const changed = dragStart.x !== dragNode.x || dragStart.y !== dragNode.y;
          if (changed) {
            const beforeSnap = [{ nodeId: dragNode.id, x: dragStart.x, y: dragStart.y }];
            const afterSnap = [{ nodeId: dragNode.id, x: dragNode.x, y: dragNode.y }];
            useHistory.getState().record({
              undo: () => applyLayoutItems(beforeSnap),
              redo: () => applyLayoutItems(afterSnap),
            });
          }
        }
      }
      if (dragNode) {
        // ActionBar/HoverCard visible again after drag ends
        useCanvasCommands.getState().set({ isDragging: false });
      }
      dragNode = null;
      dragStart = null;
      panning = false;
      canvas.style.cursor = "default";
    };

    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      onContextMenu?.(toWorld(e.clientX, e.clientY), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    // Double-click → select node + open EditorModal + auto-focus Inspector's first input.
    // openEditor is atomic: editorNodeId + selectedNodeId + editingNodeId set together.
    const onDblClick = (e: MouseEvent) => {
      const wp = toWorld(e.clientX, e.clientY);
      const hit = hitTest(wp.x, wp.y);
      if (hit) {
        e.preventDefault();
        selected.current = hit.id;
        useSelection.getState().openEditor(hit.id);
        schedule();
      }
    };

    // ⌘Z/⌘⇧Z + Delete global hotkeys (F2 rename in AppShell)
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inForm = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;

      // Escape → cancel the armed tap-to-connect source
      if (e.key === "Escape" && armedPortRef.current) {
        armedPortRef.current = null;
        schedule();
        return;
      }

      // Delete / Backspace → delete selected edge
      if ((e.key === "Delete" || e.key === "Backspace") && !inForm && selectedEdge.current) {
        e.preventDefault();
        const eid = selectedEdge.current;
        selectedEdge.current = null;
        schedule();
        onEdgeDeleteRef.current?.(eid);
        return;
      }

      // ⌘Z / Ctrl+Z → undo, ⌘+Shift+Z → redo
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !inForm) {
        e.preventDefault();
        if (e.shiftKey) {
          useHistory.getState().redo();
        } else {
          useHistory.getState().undo();
        }
      }
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp); // pointer cancel → prevent state leak
    canvas.addEventListener("contextmenu", onCtx);
    canvas.addEventListener("dblclick", onDblClick);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("contextmenu", onCtx);
      canvas.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("keydown", onKeyDown);
      if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Soft pan+zoom to a node + 600ms orange highlight. For AI chat NodeChip.
  //
  // Two contexts:
  //  - selection / chip click (default): keeps the existing zoom-in behaviour and
  //    centers the node in the viewport. Does NOT touch the spotlight source.
  //  - instruct narration (opts.instruct): the node is the active narration subject.
  //    (a) zoom a touch LOWER (zoom-out) so the node + its neighbours fit, (b) shift
  //    the node UP into the clean area above the bottom explanation panel (reserve the
  //    bottom `reserveBottom` fraction of the viewport), and (c) make this node the
  //    spotlight source so it + 1-hop neighbours stay lit while the rest dims.
  const doFocusNode = (id: string, opts?: { zoom?: boolean; instruct?: boolean; reserveBottom?: number }) => {
    const n = scene.current.index.get(id);
    if (!n) return;
    const cx = n.x + n.w / 2;
    const cy = n.y + nodeDisplayH(n) / 2;

    if (opts?.instruct) {
      // Instruct spotlight source — recomputed in ensureFocusSet (sig folds this id).
      instructFocusId.current = id;
      // Zoom-out vs. the selection focus: cap lower + scale down so the focused node
      // plus its 1-hop neighbourhood comfortably fit on screen (no edge-to-edge crop).
      const targetZoom = clamp(Math.min(vp.current.zoom, 1.0) * 0.85, 0.45, 1.1);
      // Reserve the bottom `reserveBottom` fraction for the explanation panel; center
      // the node vertically in the remaining clean band (top → reserve line).
      const reserve = clamp(opts.reserveBottom ?? 0.42, 0, 0.7);
      const cleanH = size.current.h * (1 - reserve);
      vpTarget.current = {
        zoom: targetZoom,
        x: size.current.w / 2 - cx * targetZoom,
        y: cleanH / 2 - cy * targetZoom,
      };
    } else {
      const targetZoom = opts?.zoom
        ? clamp(Math.max(vp.current.zoom, 1.0) * 1.25, 0.5, 1.8)
        : vp.current.zoom;
      vpTarget.current = {
        zoom: targetZoom,
        x: size.current.w / 2 - cx * targetZoom,
        y: size.current.h / 2 - cy * targetZoom,
      };
    }
    focusHighlight.current = { nodeIds: new Set([id]), edgeId: null, start: performance.now(), duration: 600 };
    schedule();
  };

  // Clear instruct-narration spotlight source. The selection spotlight (if any)
  // resumes; otherwise dim fades back to 0. ensureFocusSet picks this up via its sig.
  const doClearInstructFocus = () => {
    if (instructFocusId.current === null) return;
    instructFocusId.current = null;
    schedule();
  };

  const doFocusEdge = (id: string) => {
    const e = scene.current.edges.find((x) => x.id === id);
    if (!e) return;
    const a = scene.current.index.get(e.source);
    const b = scene.current.index.get(e.target);
    if (!a || !b) return;
    // Fit bounds so both edge endpoints are visible (don't zoom — only pan)
    const ax = a.x + a.w / 2, ay = a.y + nodeDisplayH(a) / 2;
    const bx = b.x + b.w / 2, by = b.y + nodeDisplayH(b) / 2;
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;
    vpTarget.current = {
      zoom: vp.current.zoom,
      x: size.current.w / 2 - cx * vp.current.zoom,
      y: size.current.h / 2 - cy * vp.current.zoom,
    };
    focusHighlight.current = {
      nodeIds: new Set([e.source, e.target]),
      edgeId: id,
      start: performance.now(),
      duration: 600,
    };
    schedule();
  };

  // Register callbacks to BottomBar canvas-commands store — mount/unmount cycle
  useEffect(() => {
    useCanvasCommands.getState().set({
      fit: () => { fit(); schedule(); },
      zoomIn: () => { vp.current.zoom = clamp(vp.current.zoom * 1.2, 0.1, 4); schedule(); },
      zoomOut: () => { vp.current.zoom = clamp(vp.current.zoom / 1.2, 0.1, 4); schedule(); },
      arrange: doArrange,
      undo: onUndoClick,
      redo: onRedoClick,
      focusNode: doFocusNode,
      focusEdge: doFocusEdge,
      clearInstructFocus: doClearInstructFocus,
    });
    return () => {
      useCanvasCommands.getState().set({
        fit: null, zoomIn: null, zoomOut: null, arrange: null, undo: null, redo: null,
        focusNode: null, focusEdge: null, clearInstructFocus: null,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep store up-to-date when canUndo/canRedo changes
  useEffect(() => {
    useCanvasCommands.getState().set({ canUndo, canRedo });
  }, [canUndo, canRedo]);

  return (
    <div className="cv-wrap">
      {/* Canvas is decorative (aria-hidden) — semantics come from the invisible DOM mirror below. */}
      <canvas ref={canvasRef} className="cv-canvas" aria-hidden="true" />
      <div className="cv-hud mono" ref={hud} />
      {/* Screen-reader + keyboard access: invisible, focusable list of nodes. */}
      <CanvasA11yMirror
        graph={graph}
        selectedId={selectedFromStore}
        onActivate={(id) => {
          selected.current = id;
          selectedEdge.current = null;
          selectNode(id);
          doFocusNode(id); // center + 600ms highlight + redraw (zoom unchanged)
        }}
        onOpen={(id) => {
          selected.current = id;
          useSelection.getState().openEditor(id);
        }}
      />
    </div>
  );
}
