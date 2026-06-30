/** Canvas view-MODE — Technical ↔ Simple (within the Canvas world only).
 *
 *  workspace-view.ts (Canvas ↔ Code) switches between the product's TWO WORLDS; this
 *  store instead switches between two PRESENTATIONS INSIDE the Canvas world: the
 *  technical graph (node/edge) and, for NON-developers, the "simple view" (feature
 *  map + capability list). Simple is a presentation, not a separate world — so rather
 *  than adding a third segment to ViewSwitch, it is kept as a separate mode.
 *
 *  Simple is a PURE PROJECTION of the technical graph (sibling of Mermaid) — no
 *  separate state, no drift. This store only tracks "which presentation is shown". */

import { create } from "zustand";

interface CanvasViewModeState {
  mode: "technical" | "simple";
  setMode: (mode: "technical" | "simple") => void;
  toggle: () => void;
  /** Project/change reset — return to technical view. */
  reset: () => void;
}

export const useCanvasViewMode = create<CanvasViewModeState>((set) => ({
  mode: "technical",
  setMode: (mode) => set({ mode }),
  toggle: () => set((s) => ({ mode: s.mode === "technical" ? "simple" : "technical" })),
  reset: () => set({ mode: "technical" }),
}));
