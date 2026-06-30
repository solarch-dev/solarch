/** Canvas commands store — bridges CanvasView local state/refs (viewport, fit, arrange)
 *  to AppShell-level components (BottomBar, NodeActionBar, NodeHoverCard).
 *
 *  Pattern: CanvasView registers callbacks on mount, viewport and nodes are patched
 *  on each schedule(). Floating components read from this store. */

import { create } from "zustand";
import type { SceneNode, Viewport } from "./types";

interface CanvasCommands {
  /** Current zoom as percentage (e.g. 100) */
  zoomPercent: number;
  /** Live viewport state — synced after each schedule(). */
  viewport: Viewport;
  /** Active scene's nodes — for bounds calculation. */
  nodes: SceneNode[];
  /** Commands — registered on CanvasView mount, null on unmount */
  fit: (() => void) | null;
  zoomIn: (() => void) | null;
  zoomOut: (() => void) | null;
  arrange: (() => void) | null;
  undo: (() => void) | null;
  redo: (() => void) | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Is drag active — HoverCard / ActionBar hide guard */
  isDragging: boolean;
  /** Selected node copy callback — registered by NodeActionBar, triggered by ⌘⇧C */
  copy: (() => void) | null;
  /** Selected node delete callback — registered by NodeActionBar, triggered by Del/Backspace */
  deleteSelected: (() => void) | null;
  /** Soft pan+zoom to a node + orange highlight halo. Selection unchanged.
   *  Called when AI chat inline NodeChip is clicked/rendered.
   *  opts.zoom=true zooms in (smart focus: first chip), false only pans+highlights.
   *  opts.instruct=true: instruct-marker focus → spotlight this node (selection-free),
   *    zoom-out a touch and shift the node into the clean area ABOVE the bottom panel.
   *  opts.reserveBottom (0..1): fraction of viewport height occupied by the instruct
   *    panel at the bottom; the focused node is centered in the remaining top area. */
  focusNode: ((id: string, opts?: { zoom?: boolean; instruct?: boolean; reserveBottom?: number }) => void) | null;
  /** Edge highlight + highlight on both endpoint nodes. */
  focusEdge: ((id: string) => void) | null;
  /** Clear instruct-marker focus → spotlight off (unless a canvas selection exists).
   *  Called when the instruct panel closes / a new stream starts / focusNode(null). */
  clearInstructFocus: (() => void) | null;
  /** Partial setter — patch update */
  set: (patch: Partial<Omit<CanvasCommands, "set">>) => void;
}

export const useCanvasCommands = create<CanvasCommands>((set) => ({
  zoomPercent: 100,
  viewport: { zoom: 1, x: 0, y: 0 },
  nodes: [],
  fit: null,
  zoomIn: null,
  zoomOut: null,
  arrange: null,
  undo: null,
  redo: null,
  canUndo: false,
  canRedo: false,
  isDragging: false,
  copy: null,
  deleteSelected: null,
  focusNode: null,
  focusEdge: null,
  clearInstructFocus: null,
  set: (patch) => set(patch),
}));
