/** UI preferences — edge drawing style.
 *  The bezier/straight options were removed; edges are always elbow. Kept as a
 *  store so the canvas reads the mode through a single source (and so the style
 *  can be re-exposed later without touching the renderer). No persistence: there
 *  is only one value now. */

import { create } from "zustand";

export type EdgePathMode = "bezier" | "straight" | "elbow";

interface UiPrefs {
  edgePath: EdgePathMode;
  setEdgePath: (mode: EdgePathMode) => void;
}

export const useUiPrefs = create<UiPrefs>((set) => ({
  edgePath: "elbow",
  setEdgePath: (mode) => set({ edgePath: mode }),
}));
