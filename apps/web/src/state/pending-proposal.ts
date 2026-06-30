/** Inline AI expansion proposal — pending set.
 *
 *  AI generation flows to the backend normally (written to the DB); the
 *  "proposal" aspect is purely client-side: this store holds the generated
 *  node/edge ids, the renderer highlights them green, and ProposalBar offers
 *  Approve/Reject.
 *  - Approve → set is cleared (data is already persisted).
 *  - Reject  → set members are bulk-deleted via raw delete.
 *  Only ONE proposal lives at a time; the current one must be resolved before
 *  a new one starts.
 *  Ephemeral — if the page reloads, the proposal is treated as accepted (v1 default). */

import { create } from "zustand";

interface PendingProposalState {
  /** Is a proposal alive (streaming or awaiting a decision). */
  active: boolean;
  /** Is generation still flowing (bar shows "generating…", decision buttons disabled). */
  streaming: boolean;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  /** Start the proposal (on InlineAiPrompt submit). */
  begin: () => void;
  /** Stream finished/stopped — move to the decision phase. */
  settle: () => void;
  addNode: (id: string) => void;
  addEdge: (id: string) => void;
  /** Backend terminal rollback ('removed' event) — drop from the set. */
  remove: (id: string, kind: "node" | "edge") => void;
  /** After Approve / Reject, or if nothing was generated: return to a clean state. */
  clear: () => void;
}

export const usePendingProposal = create<PendingProposalState>((set) => ({
  active: false,
  streaming: false,
  nodeIds: new Set(),
  edgeIds: new Set(),
  begin: () => set({ active: true, streaming: true, nodeIds: new Set(), edgeIds: new Set() }),
  settle: () => set({ streaming: false }),
  // Sets are copied immutably — zustand triggers renders via reference equality.
  addNode: (id) => set((s) => ({ nodeIds: new Set(s.nodeIds).add(id) })),
  addEdge: (id) => set((s) => ({ edgeIds: new Set(s.edgeIds).add(id) })),
  remove: (id, kind) =>
    set((s) => {
      if (kind === "node") {
        const nodeIds = new Set(s.nodeIds);
        nodeIds.delete(id);
        return { nodeIds };
      }
      const edgeIds = new Set(s.edgeIds);
      edgeIds.delete(id);
      return { edgeIds };
    }),
  clear: () => set({ active: false, streaming: false, nodeIds: new Set(), edgeIds: new Set() }),
}));
