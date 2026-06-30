/** Canvas selection + editor modal state. Three separate concerns, three separate states:
 *  - selectedNodeId: canvas selection (single click) → triggers NodeActionBar
 *  - editorNodeId:   which node the modal is showing (null = modal closed) → single source of truth
 *  - editingNodeId:  focus signal to first input after Inspector mount (consumed once, doesn't affect modal)
 *
 *  Ephemeral, not persisted. */

import { create } from "zustand";

interface SelectionState {
  /** Canvas selection — changes on single click, independent of modal. */
  selectedNodeId: string | null;
  selectNode: (id: string | null) => void;
  /** Which node the modal is showing (null = closed). Single source of truth. */
  editorNodeId: string | null;
  /** Atomic open: selected + editor + focus signal are set together. */
  openEditor: (id: string) => void;
  /** Atomic close: editor and focus signal are reset, selection is preserved. */
  closeEditor: () => void;
  /** Focus signal to first input after Inspector mount (double-click / F2). Consumed once. */
  editingNodeId: string | null;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  /** Hover state — NodeHoverCard render trigger. Set on CanvasView mouseMove. */
  hoveredNodeId: string | null;
  setHovered: (id: string | null) => void;
  /** Whether inline NameEditor (rename) is open — triggered by ActionBar Rename / F2. */
  nameEditorOpen: boolean;
  openNameEditor: () => void;
  closeNameEditor: () => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selectedNodeId: null,
  // selectNode does NOT touch editorNodeId → single click / drag doesn't affect modal.
  selectNode: (id) => set({ selectedNodeId: id, nameEditorOpen: false, editingNodeId: null }),
  editorNodeId: null,
  openEditor: (id) =>
    set({ editorNodeId: id, selectedNodeId: id, editingNodeId: id, nameEditorOpen: false }),
  closeEditor: () => set({ editorNodeId: null, editingNodeId: null }),
  editingNodeId: null,
  startEditing: (id) => set({ editingNodeId: id }),
  stopEditing: () => set({ editingNodeId: null }),
  hoveredNodeId: null,
  setHovered: (id) => set({ hoveredNodeId: id }),
  nameEditorOpen: false,
  openNameEditor: () => set({ nameEditorOpen: true }),
  closeNameEditor: () => set({ nameEditorOpen: false }),
}));
