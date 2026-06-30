/** BottomBar (h-12 sticky bottom, glass z-50)
 *  Canvas mode: Left zoom | Center OmniBar (AI) | Right history + arrange + verify + docs.
 *  Code mode:   Surgical AI controls (Fill / Download / Copy) — diagram controls HIDDEN
 *               (nothing diagram-related remains after the switch). ⌘K stays in both modes. */

import { useParams } from "react-router-dom";
import {
  Maximize2, Plus, Minus, Undo2, Redo2, AlignLeft, Command, BookOpen,
  Wand2, RefreshCw, Download, ClipboardCopy, FlaskConical, Loader2,
} from "lucide-react";
import { Z_LAYERS } from "../lib/z-layers";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCanvasCommands } from "../canvas/canvas-commands";
import { useCodegenCommands } from "../features/codegen/codegen-commands";
import { useWorkspaceView } from "../state/workspace-view";
import { useTabs } from "../api/tabs";
import { OmniBar } from "../features/canvas/OmniBar";
import { ProblemsPanel } from "../features/canvas/ProblemsPanel";
import { openCommandPalette, openDocs } from "../app/AppShell";

export function BottomBar() {
  const cmd = useCanvasCommands();
  const view = useWorkspaceView((s) => s.view);
  const { projectId, tabId } = useParams<{ projectId?: string; tabId?: string }>();
  const { data: tabs } = useTabs(projectId ?? "");
  const activeTabId = tabId ?? tabs?.find((t) => t.isDefault)?.id ?? null;
  const isCode = view === "code";

  return (
    <footer
      className="h-12 sticky bottom-0 flex items-center px-2 gap-2 sm:px-3 sm:gap-3
                 bg-card/95 backdrop-blur-xl border-t border-border"
      style={{ zIndex: Z_LAYERS.CHROME }}
    >
      {isCode ? (
        <CodeControls />
      ) : (
        <>
          {/* LEFT — Zoom + Edge mode. On phones, pinch zoom replaces zoom%/in/out (hidden); Fit stays. */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="hidden font-mono text-[12px] text-muted-foreground w-12 text-right tabular-nums transition-all duration-150 cursor-help lg:inline">
                  {Math.round(cmd.zoomPercent)}%
                </span>
              </TooltipTrigger>
              <TooltipContent>Zoom level (mouse wheel or +/-)</TooltipContent>
            </Tooltip>
            <CmdButton onClick={cmd.fit} title="Fit" icon={<Maximize2 size={13} />} />
            <div className="hidden items-center gap-1 lg:flex">
              <CmdButton onClick={cmd.zoomIn} title="Zoom in" icon={<Plus size={13} />} />
              <CmdButton onClick={cmd.zoomOut} title="Zoom out" icon={<Minus size={13} />} />
            </div>
          </div>

          {/* CENTER — OmniBar (AI) */}
          <div className="flex-1 flex items-center justify-center" data-tour="omnibar">
            {projectId && <OmniBar projectId={projectId} tabId={activeTabId} />}
          </div>

          {/* RIGHT — History (stays on mobile too) */}
          <div className="flex items-center gap-1">
            <CmdButton onClick={cmd.undo} disabled={!cmd.canUndo} title="Undo (⌘Z)" icon={<Undo2 size={13} />} />
            <CmdButton onClick={cmd.redo} disabled={!cmd.canRedo} title="Redo (⌘⇧Z)" icon={<Redo2 size={13} />} />
          </div>

          {/* Secondary cluster — Arrange + Problems + Docs. Hidden on narrow screens (phone + tablet portrait);
              full chrome doesn't fit below ~1024px. Desktop/tablet-landscape (lg) brings them all back. */}
          <div className="hidden items-center gap-3 lg:flex">
            <Separator orientation="vertical" className="h-5" />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => cmd.arrange?.()}
              disabled={!cmd.arrange}
              className="h-7 px-2 gap-1.5 text-[13px]"
              title="Auto arrange (Alt+L)"
            >
              <AlignLeft size={13} />
              Arrange
            </Button>

            {projectId && (
              <>
                <Separator orientation="vertical" className="h-5" />
                <ProblemsPanel projectId={projectId} />
              </>
            )}

            <Separator orientation="vertical" className="h-5" />

            {/* Docs — Node/Edge/Shortcut library (diagram) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => openDocs("nodes")}
                  aria-label="Docs"
                  data-tour="docs"
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  <BookOpen size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Docs — Node, Edge, Shortcuts</TooltipContent>
            </Tooltip>
          </div>
        </>
      )}

      {/* Command palette — ⌘K (in both modes) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Command palette"
            data-tour="cmdk"
            className="hidden items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-md border border-border bg-card/60 text-muted-foreground hover:bg-card hover:text-foreground hover:border-brand-500/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 lg:inline-flex"
          >
            <Command size={11} />
            <kbd className="font-mono text-[11.5px] tabular-nums">K</kbd>
          </button>
        </TooltipTrigger>
        <TooltipContent>Command palette (⌘K)</TooltipContent>
      </Tooltip>
    </footer>
  );
}

/** Code mode — Surgical AI controls (in the BottomBar; replacing the diagram controls). */
function CodeControls() {
  const c = useCodegenCommands();

  if (!c.active) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        <span className="font-sans text-[13px]">Generating code…</span>
      </div>
    );
  }

  const streaming = c.status === "streaming";
  const fillLabel =
    streaming ? `Filling ${c.processed}/${c.denom}`
    : c.status === "done" ? "Fill again"
    : c.status === "error" ? "Try again"
    : "Fill with Surgical AI";

  return (
    <>
      {/* LEFT — fill status (the Agent ↔ Editor switch now lives in the top ViewSwitch) */}
      <div className="flex items-center gap-2">
        {c.status === "done" && (
          <span className="font-mono text-[12px] text-muted-foreground">filled {c.filled}/{c.denom}</span>
        )}
      </div>

      {/* CENTER — Fill + Deep verify */}
      <div className="flex-1 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => c.fill?.()}
          disabled={streaming || !c.fill}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-500 px-4 text-[13px] font-semibold text-black transition-colors hover:bg-brand-600 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
        >
          {streaming ? <Loader2 size={14} className="animate-spin" /> : c.status === "error" ? <RefreshCw size={14} /> : <Wand2 size={14} />}
          {fillLabel}
        </button>
        {c.status === "idle" && (
          <button
            type="button"
            onClick={() => c.toggleDeepVerify?.()}
            title="Also generate and run jest behavioural specs (slower, higher confidence)"
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors ${c.deepVerify ? "text-brand-500" : "text-muted-foreground hover:text-foreground"}`}
          >
            <FlaskConical size={13} /> Deep verify{c.deepVerify ? " · on" : ""}
          </button>
        )}
      </div>

      {/* RIGHT — Download + Copy prompt */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => c.download?.()}
          disabled={c.zipping || !c.download}
          className="h-7 px-2 gap-1.5 text-[13px]"
          title="Download all files as .zip"
        >
          {c.zipping ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          .zip
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => c.copyPrompt?.()}
          disabled={!c.hasPrompt || !c.copyPrompt}
          className="h-7 px-2 gap-1.5 text-[13px]"
          title={c.hasPrompt ? "Copy the surgical implementation prompt" : "No prompt available — regenerate to get the latest codebase"}
        >
          <ClipboardCopy size={13} />
          Prompt
        </Button>
      </div>
    </>
  );
}

function CmdButton({
  onClick, disabled, title, icon,
}: {
  onClick: (() => void) | null;
  disabled?: boolean;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => onClick?.()}
      disabled={disabled || !onClick}
      title={title}
      aria-label={title}
      className="h-7 w-7 p-0"
    >
      {icon}
    </Button>
  );
}
