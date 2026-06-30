import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { BottomBar } from "../components/BottomBar";
import { EditorModal } from "../components/EditorModal";
import { CommandPalette } from "../components/CommandPalette";
import { DocsModal, type DocsSection } from "../components/DocsModal";
import { useSelection } from "../state/selection";
import { useCanvasCommands } from "../canvas/canvas-commands";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "../components/ui/confirm-dialog";
import { Toaster } from "sonner";
import { Z_LAYERS } from "../lib/z-layers";
import { useClaimGuestProject } from "../features/auth/useClaimGuestProject";
import "./AppShell.css";

/** Main app shell — TopBar + canvas main + BottomBar + global modals.
 *  Global keyboard shortcuts live here (⌘K, ⌘E, ⌘⇧C, F2, Delete, Esc). */
export function AppShell() {
  const selectedNodeId = useSelection((s) => s.selectedNodeId);
  const selectNode = useSelection((s) => s.selectNode);
  // After sign-up/login, migrate the guest sketch to the account (if a ticket exists, one-shot).
  useClaimGuestProject();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsSection, setDocsSection] = useState<DocsSection>("nodes");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inForm = t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;

      // ⌘K → toggle command palette (everywhere, even inside forms)
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      // Esc hierarchical close: NameEditor → EditorModal → Selection (bypassed when inside form)
      if (e.key === "Escape" && !inForm) {
        const s = useSelection.getState();
        if (s.nameEditorOpen) { s.closeNameEditor(); return; }
        if (s.editorNodeId) { s.closeEditor(); return; }
        if (selectedNodeId) { selectNode(null); return; }
      }

      if (inForm) return;

      // ⌘E → toggle EditorModal (when a node is selected). openEditor/closeEditor are atomic.
      if (mod && !e.shiftKey && !e.altKey && e.key === "e" && selectedNodeId) {
        e.preventDefault();
        const s = useSelection.getState();
        if (s.editorNodeId) s.closeEditor();
        else s.openEditor(selectedNodeId);
        return;
      }

      // ⌘⇧C → copy selected node (NodeActionBar registers canvas-commands.copy)
      if (mod && e.shiftKey && (e.key === "C" || e.key === "c") && selectedNodeId) {
        e.preventDefault();
        useCanvasCommands.getState().copy?.();
        return;
      }

      // F2 → rename (inline NameEditor)
      if (e.key === "F2" && selectedNodeId) {
        e.preventDefault();
        useSelection.getState().openNameEditor();
        return;
      }

      // Delete / Backspace → directly delete selected node
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId) {
        e.preventDefault();
        useCanvasCommands.getState().deleteSelected?.();
        return;
      }
    };

    // Global event for ⌘K toggle from BottomBar or other UI elements
    const onCmdkEvent = () => setPaletteOpen((v) => !v);
    const onDocsEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ section?: DocsSection }>).detail;
      setDocsSection(detail?.section ?? "nodes");
      setDocsOpen(true);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("solarch:cmdk-open", onCmdkEvent);
    window.addEventListener("solarch:docs-open", onDocsEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("solarch:cmdk-open", onCmdkEvent);
      window.removeEventListener("solarch:docs-open", onDocsEvent);
    };
  }, [selectedNodeId, selectNode]);

  return (
    <TooltipProvider delayDuration={200}>
      <ConfirmProvider>
      <div className="app-shell">
        <div className="animate-in fade-in slide-in-from-top-1 duration-300" style={{ animationDelay: "0ms", animationFillMode: "backwards" }}>
          <TopBar />
        </div>
        <main className="app-main animate-in fade-in duration-300" style={{ animationDelay: "80ms", animationFillMode: "backwards" }}>
          <Outlet />
        </main>
        <div className="animate-in fade-in slide-in-from-bottom-1 duration-300" style={{ animationDelay: "160ms", animationFillMode: "backwards" }}>
          <BottomBar />
        </div>
        <EditorModal />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onOpenDocs={(section) => {
            setDocsSection(section);
            setDocsOpen(true);
          }}
        />
        <DocsModal
          open={docsOpen}
          onOpenChange={setDocsOpen}
          initialSection={docsSection}
        />
      </div>
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{
          style: { zIndex: Z_LAYERS.TOAST },
          className: "font-sans text-[14px]",
        }}
      />
      </ConfirmProvider>
    </TooltipProvider>
  );
}

/** Toggle ⌘K palette from UI — used by BottomBar button. */
export function openCommandPalette(): void {
  window.dispatchEvent(new CustomEvent("solarch:cmdk-open"));
}

/** Toggle docs modal from UI. */
export function openDocs(section: DocsSection = "nodes"): void {
  window.dispatchEvent(new CustomEvent("solarch:docs-open", { detail: { section } }));
}
