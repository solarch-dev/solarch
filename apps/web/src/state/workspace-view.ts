/** Workspace view — Canvas ↔ Code mode switch (not a modal, the two faces of the product).
 *
 *  Solarch's core thesis: diagram → verified code. Canvas (paper/design surface)
 *  and Code (VSCode-dark/proof surface) are two states of the same project; the top ViewSwitch
 *  toggles between them (morph). The TopBar switch reads/writes this store; the ProjectPage
 *  body shows the canvas or the code layer based on `view`.
 *
 *  - openCode(nodeId?): switch to Code (+ "Show code on node" focus target).
 *  - requestRegen():    switch to Code AND trigger regeneration (Update/Drift flow) —
 *    regenSeq increments; CodegenPanel watches it and runs gen.mutate (EXPLICITLY, not on toggle). */

import { create } from "zustand";

interface WorkspaceViewState {
  view: "canvas" | "code" | "api" | "docs";
  /** Code mode sub-view: Agent (Surgical AI chat) ↔ Editor (plain code editor).
   *  The bottom BottomBar switch writes this; CodegenPanel reads it. */
  codeView: "agent" | "editor";
  /** "Show code on node" — when switching to Code, focus this node's file (else the first file). */
  codeFocusNodeId: string | undefined;
  /** Explicit regeneration counter — only Update/Drift/regen increments it (toggle does NOT). */
  regenSeq: number;
  setView: (view: "canvas" | "code" | "api" | "docs") => void;
  setCodeView: (codeView: "agent" | "editor") => void;
  openCode: (focusNodeId?: string) => void;
  /** Switch to Code + regenerate (diagram changed / Constructor updated). */
  requestRegen: () => void;
  /** Project/change reset — return to the canvas. */
  reset: () => void;
}

export const useWorkspaceView = create<WorkspaceViewState>((set) => ({
  view: "canvas",
  codeView: "agent",
  codeFocusNodeId: undefined,
  regenSeq: 0,
  setView: (view) => set({ view }),
  setCodeView: (codeView) => set({ codeView }),
  openCode: (focusNodeId) => set({ view: "code", codeFocusNodeId: focusNodeId }),
  requestRegen: () => set((s) => ({ view: "code", regenSeq: s.regenSeq + 1 })),
  reset: () => set({ view: "canvas", codeView: "agent", codeFocusNodeId: undefined }),
}));
