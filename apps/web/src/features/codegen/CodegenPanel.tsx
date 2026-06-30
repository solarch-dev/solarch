/** CodegenPanel — Surgical AI code generation surface (CHAT-PRIMARY, Lovable/v0 pattern).
 *
 *  Instead of the old full IDE (FileTree | editor | rail): the center body is CHAT (`FillChat`) —
 *  the AI's read/grep/verify actions become region-based messages. Code is NOT EMBEDDED in the
 *  stream (deep-research: VS Code agent mode also keeps code out of the stream); clicking a
 *  region/file slides a minimal `CodePreview` in FROM THE RIGHT (on demand). To start, the large
 *  central Fill button lives in FillChat's empty state.
 *
 *  Business logic PRESERVED: generate once on first open (triggeredRef), regenSeq explicit
 *  re-generation, download zip, copy prompt. Morph:
 *  body layer, scale+fade based on active (opens/closes over the canvas). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useWorkspaceView } from "@/state/workspace-view";
import { X, Loader2, AlertCircle, Boxes } from "lucide-react";
import { Z_LAYERS } from "../../lib/z-layers";
import { cn } from "@/lib/utils";
import { useGenerateCode, useFillStream, type GeneratedProject } from "../../api/codegen";
import { FillChat } from "./FillChat";
import { SimpleEditor } from "./SimpleEditor";
import { useCodegenCommands } from "./codegen-commands";
import { EDITOR } from "./theme";
import { copyToClipboard, downloadZip, regionSpans } from "./lib";

export interface CodegenPanelProps {
  projectId: string;
  /** Whether Code mode is active (view==="code"). Morph + generation trigger lock onto this.
   *  focus/regen are read from the store (useWorkspaceView). Close = store.setView("canvas"). */
  active: boolean;
}

export function CodegenPanel({ projectId, active }: CodegenPanelProps) {
  const setView = useWorkspaceView((s) => s.setView);
  const codeView = useWorkspaceView((s) => s.codeView);
  const setCodeView = useWorkspaceView((s) => s.setCodeView);
  const focusNodeId = useWorkspaceView((s) => s.codeFocusNodeId);
  const regenSeq = useWorkspaceView((s) => s.regenSeq);
  const onClose = useCallback(() => setView("canvas"), [setView]);
  const gen = useGenerateCode(projectId);
  const fill = useFillStream(projectId);

  // Base = deterministic skeleton. Once Fill finishes, overlay the filled files (same path).
  const baseResult = gen.isSuccess ? gen.data : undefined;
  const result: GeneratedProject | undefined = useMemo(
    () => (baseResult && fill.files ? { ...baseResult, files: fill.files } : baseResult),
    [baseResult, fill.files],
  );
  const surgicalCount = baseResult?.summary.surgicalMarkerCount ?? 0;
  const fillDenom = fill.markerCount || surgicalCount;
  const fillProcessed = Math.min(fill.regions.length, fillDenom || fill.regions.length);

  // Failed (violation/error) regions — file → member set (CodeViewer danger coloring).
  const failedByPath = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of fill.regions) {
      if (r.status === "filled") continue;
      let set = m.get(r.file);
      if (!set) { set = new Set(); m.set(r.file, set); }
      set.add(r.member);
    }
    return m;
  }, [fill.regions]);

  // Deep verify (jest) — pre-fill toggle (FillChat shows it in the empty state).
  const [deepVerify, setDeepVerify] = useState(false);
  const [zipping, setZipping] = useState(false);
  // Editor sub-view focus — file + region coming from a chat region click / Show-code.
  const [editorTarget, setEditorTarget] = useState<{ path: string; nodeId?: string } | null>(null);
  // User edits (Editor) — path → content override. Displayed + downloaded content flows through here.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const displayResult: GeneratedProject | undefined = useMemo(() => {
    if (!result) return undefined;
    if (Object.keys(edits).length === 0) return result;
    return { ...result, files: result.files.map((f) => (edits[f.path] != null ? { ...f, content: edits[f.path]! } : f)) };
  }, [result, edits]);
  const onEditFile = useCallback((path: string, content: string) => setEdits((e) => ({ ...e, [path]: content })), []);

  // Generate ONCE on the FIRST Code entry; state is preserved across mode switches (toggle → NO reset).
  const triggeredRef = useRef(false);
  useEffect(() => {
    if (active && !triggeredRef.current) {
      triggeredRef.current = true;
      gen.mutate(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // EXPLICIT re-generation (Update/Drift): when regenSeq increments, reset clean + regenerate.
  const regenRef = useRef(regenSeq);
  useEffect(() => {
    if (regenSeq === regenRef.current) return;
    regenRef.current = regenSeq;
    setEditorTarget(null);
    setEdits({});
    fill.reset();
    gen.reset();
    triggeredRef.current = true;
    gen.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regenSeq]);

  // "Show code on node" — when focusNodeId is set, switch to Editor + focus that node's file (once/focus).
  const openedFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNodeId || !result) return;
    if (openedFocusRef.current === focusNodeId) return;
    const path = result.nodeFiles?.[focusNodeId]?.[0];
    if (path && result.files.some((f) => f.path === path)) {
      openedFocusRef.current = focusNodeId;
      setEditorTarget({ path, nodeId: focusNodeId });
      setCodeView("editor");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId, result]);

  // Escape → in Editor, return to Agent; in Agent, return to Canvas. Not while in an input/textarea.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (codeView === "editor") setCodeView("agent");
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose, codeView, setCodeView]);

  const promptFile = useMemo(
    () => displayResult?.files.find((f) => f.path === "SURGICAL_PLAN.md"),
    [displayResult],
  );

  /** A region/file was clicked in chat → switch to Editor + focus that file/region (resolve nodeId). */
  const openInEditor = useCallback(
    (path: string, member?: string) => {
      let nodeId: string | undefined;
      if (member && result) {
        const f = result.files.find((x) => x.path === path);
        if (f) nodeId = regionSpans(f.content).find((r) => r.member === member)?.nodeId;
      }
      setEditorTarget({ path, nodeId });
      setCodeView("editor");
    },
    [result, setCodeView],
  );

  /** "Show code" — open the editor view on the first surgical file (fill it yourself, in-app). */
  const onShowCode = useCallback(() => {
    if (!result) return;
    const f = result.files.find((x) => x.surgicalMarkers > 0) ?? result.files[0];
    if (f) openInEditor(f.path);
  }, [result, openInEditor]);

  const onCopyPrompt = async () => {
    if (!promptFile) return;
    await copyToClipboard(promptFile.content);
    toast.success("Prompt copied to clipboard.");
  };

  const onDownload = async () => {
    if (!displayResult || displayResult.files.length === 0) return;
    setZipping(true);
    try {
      await downloadZip(displayResult.files, "solarch-codegen.zip");
    } finally {
      setZipping(false);
    }
  };

  /** Surgical AI — fill @solarch:surgical bodies on the server. */
  const onFill = () => {
    if (fill.status === "streaming") return;
    fill.start({ jest: deepVerify });
  };

  const skippedKinds = result ? Object.entries(result.summary.skippedKinds) : [];
  const skippedTotal = skippedKinds.reduce((a, [, n]) => a + n, 0);

  const hasFiles = !gen.isPending && !gen.isError && !!result && result.files.length > 0;

  // BottomBar (Code mode) reads Surgical AI controls from this store — register status + handlers.
  const setCodegenCmd = useCodegenCommands((s) => s.set);
  useEffect(() => {
    setCodegenCmd({
      active: hasFiles,
      status: fill.status,
      surgicalCount,
      processed: fillProcessed,
      filled: fill.filled,
      denom: fillDenom,
      hasPrompt: !!promptFile,
      zipping,
      deepVerify,
      fill: onFill,
      download: onDownload,
      copyPrompt: onCopyPrompt,
      toggleDeepVerify: () => setDeepVerify((v) => !v),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFiles, fill.status, surgicalCount, fillProcessed, fill.filled, fillDenom, promptFile, zipping, deepVerify]);
  // Unmount: don't leave a stale handler (fresh remount when the project changes).
  useEffect(() => () => setCodegenCmd({ active: false, status: "idle", fill: null, download: null, copyPrompt: null, toggleDeepVerify: null }), [setCodegenCmd]);

  return (
    // BODY LAYER (not a modal) — morphs open/closed OVER the canvas.
    <div
      role="region"
      aria-label="Generated code"
      aria-hidden={!active}
      className={cn(
        "absolute inset-0 flex flex-col overflow-hidden",
        "transition-[opacity,transform] duration-[360ms] [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        active ? "pointer-events-auto opacity-100 scale-100" : "pointer-events-none opacity-0 scale-[0.985]",
      )}
      style={{ zIndex: Z_LAYERS.MODAL, background: EDITOR.bg }}
    >
      {/* Slim top strip — title + Copy prompt + Download + Close (the large Fill button now lives in chat). */}
      <header
        className="flex h-11 shrink-0 items-center gap-3 px-3"
        style={{ background: EDITOR.titleBar, borderBottom: `1px solid ${EDITOR.border}` }}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: EDITOR.accentWash, color: EDITOR.accent }}>
            <Boxes size={14} />
          </span>
          <h2 className="font-sans text-[13px] font-semibold" style={{ color: EDITOR.text }}>Generated Code</h2>
          <span className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ background: EDITOR.subtle, color: EDITOR.textMuted }}>
            nestjs
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Surgical AI actions (Fill / Download / Copy) now live in the bottom bar (Code mode). */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-accent)]"
            style={{ color: EDITOR.textMuted }}
            onMouseEnter={(e) => { e.currentTarget.style.background = EDITOR.dangerWash; e.currentTarget.style.color = EDITOR.danger; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = EDITOR.textMuted; }}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Body — chat-primary + minimal preview from the right */}
      <div className="flex min-h-0 flex-1" style={{ background: EDITOR.bg }}>
        {gen.isPending && <LoadingState />}
        {!gen.isPending && gen.isError && <ErrorState onRetry={() => gen.mutate(undefined)} />}
        {!gen.isPending && !gen.isError && result && result.files.length === 0 && <EmptyState />}

        {hasFiles && (
          codeView === "editor" ? (
            <SimpleEditor files={displayResult!.files} failedByPath={failedByPath} target={editorTarget} onEdit={onEditFile} />
          ) : (
            <FillChat
              result={displayResult!}
              fill={fill}
              surgicalCount={surgicalCount}
              fillProcessed={fillProcessed}
              fillDenom={fillDenom}
              deepVerify={deepVerify}
              onToggleDeepVerify={() => setDeepVerify((v) => !v)}
              onFill={onFill}
              onOpen={openInEditor}
              onShowCode={onShowCode}
              zipping={zipping}
              onDownload={onDownload}
              skippedTotal={skippedTotal}
            />
          )
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <Loader2 size={22} className="animate-spin" style={{ color: EDITOR.accent }} />
      <p className="font-sans text-[14.5px] font-medium" style={{ color: EDITOR.text }}>
        Generating code
      </p>
      <p className="max-w-[320px] font-mono text-[12.5px] leading-relaxed" style={{ color: EDITOR.textMuted }}>
        Diagram nodes are being converted to a NestJS project skeleton.
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <AlertCircle size={22} style={{ color: EDITOR.danger }} />
      <p className="font-sans text-[14.5px] font-medium" style={{ color: EDITOR.text }}>
        Code generation failed
      </p>
      <p className="max-w-[340px] font-mono text-[12.5px] leading-relaxed" style={{ color: EDITOR.textMuted }}>
        An error occurred. Details shown as a notification.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 inline-flex h-8 items-center rounded-md px-3 text-[13.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--ed-bg)]"
        style={{ color: EDITOR.text, background: EDITOR.subtle, border: `1px solid ${EDITOR.borderStrong}` }}
        onMouseEnter={(e) => (e.currentTarget.style.background = EDITOR.subtleStrong)}
        onMouseLeave={(e) => (e.currentTarget.style.background = EDITOR.subtle)}
      >
        Retry
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <p className="font-sans text-[14.5px] font-medium" style={{ color: EDITOR.text }}>
        Nothing to generate
      </p>
      <p className="max-w-[340px] font-mono text-[12.5px] leading-relaxed" style={{ color: EDITOR.textMuted }}>
        No nodes suitable for code generation found in the diagram.
      </p>
    </div>
  );
}
