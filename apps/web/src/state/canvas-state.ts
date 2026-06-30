/** Canvas interaction state — survives refresh (localStorage). Per-edge bend
 *  ratio (middle segment offset, 0..1, default 0.5). Backend persistence will
 *  eventually move under edge.properties.layout. */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CanvasState {
  edgeBends: Record<string, number>;
  setBend: (edgeId: string, value: number) => void;
  resetBend: (edgeId: string) => void;
}

const clamp01 = (v: number) => Math.max(0.05, Math.min(0.95, v));

export const useCanvasState = create<CanvasState>()(
  persist(
    (set) => ({
      edgeBends: {},
      setBend: (edgeId, value) =>
        set((s) => ({ edgeBends: { ...s.edgeBends, [edgeId]: clamp01(value) } })),
      resetBend: (edgeId) =>
        set((s) => {
          const next = { ...s.edgeBends };
          delete next[edgeId];
          return { edgeBends: next };
        }),
    }),
    { name: "solarch:canvas-state" },
  ),
);
