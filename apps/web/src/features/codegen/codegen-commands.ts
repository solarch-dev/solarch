/** Codegen commands store — bridges CodegenPanel's fill/download/copy actions + state
 *  to the AppShell-level BottomBar (same pattern as useCanvasCommands).
 *
 *  CodegenPanel registers its handlers + state on mount; in Code mode the BottomBar reads
 *  these and renders Surgical AI controls (instead of the diagram controls). In Canvas mode
 *  the BottomBar ignores this store. Reset on unmount (so no stale handler survives a project switch). */

import { create } from "zustand";
import type { FillState } from "../../api/codegen";

interface CodegenCommands {
  /** Whether the controls are meaningful (CodegenPanel mounted + files generated). */
  active: boolean;
  status: FillState["status"];
  surgicalCount: number;
  /** Number of regions processed during streaming (live counter). */
  processed: number;
  filled: number;
  denom: number;
  hasPrompt: boolean;
  zipping: boolean;
  deepVerify: boolean;
  /** Actions — CodegenPanel registers on mount, nulls on unmount. */
  fill: (() => void) | null;
  download: (() => void) | null;
  copyPrompt: (() => void) | null;
  toggleDeepVerify: (() => void) | null;
  set: (patch: Partial<Omit<CodegenCommands, "set">>) => void;
}

export const useCodegenCommands = create<CodegenCommands>((set) => ({
  active: false,
  status: "idle",
  surgicalCount: 0,
  processed: 0,
  filled: 0,
  denom: 0,
  hasPrompt: false,
  zipping: false,
  deepVerify: false,
  fill: null,
  download: null,
  copyPrompt: null,
  toggleDeepVerify: null,
  set: (patch) => set(patch),
}));
