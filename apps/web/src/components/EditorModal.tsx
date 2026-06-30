/** EditorModal — Linear/Notion style premium center modal + inline subpage navigation.
 *  Replaces Vaul bottom drawers: subpage fills the modal (← Back + Save).
 *  InspectorPanel is the default page; Service/Controller/Table/DTO drawers push subpages. */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Z_LAYERS } from "../lib/z-layers";
import { useSelection } from "../state/selection";
import { InspectorPanel } from "./Inspector/InspectorPanel";
import { cn } from "@/lib/utils";

/** Backwards-compatible no-op — avoids breaking imports from old callers.
 *  New pattern: each inspector holds its own sub-page state (stale snapshot bug fix). */
export function useEditorSubPage() {
  return { current: null, open: () => {}, close: () => {} };
}

export function EditorModal() {
  const editorNodeId = useSelection((s) => s.editorNodeId);
  const closeEditor = useSelection((s) => s.closeEditor);

  // The modal's single source is editorNodeId. A single click triggers selectNode but doesn't
  // touch editorNodeId → modal won't open with stale state. closeEditor closes atomically.
  const isOpen = !!editorNodeId;
  const setOpen = (next: boolean) => { if (!next) closeEditor(); };

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0",
            "bg-[rgba(11,16,32,0.55)] backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "data-[state=open]:duration-200 data-[state=closed]:duration-150"
          )}
          style={{ zIndex: Z_LAYERS.MODAL }}
        />

        <DialogPrimitive.Content
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            closeEditor();
          }}
          onOpenAutoFocus={(e) => { e.preventDefault(); }}
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "w-[min(1100px,94vw)] h-[88vh] max-h-[88vh]",
            "flex flex-col overflow-hidden",
            "rounded-xl border border-border",
            "bg-[color:var(--paper-raised)]",
            "shadow-[0_24px_80px_-20px_rgba(11,16,32,0.40)]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[state=open]:duration-200 data-[state=closed]:duration-150",
            "focus:outline-none"
          )}
          style={{ zIndex: Z_LAYERS.MODAL + 1 }}
        >
          <DialogPrimitive.Title className="sr-only">Node editor</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Edit the fields of the selected node
          </DialogPrimitive.Description>

          {/* InspectorPanel handles sub-page navigation internally (state-based) */}
          <InspectorPanel />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
