/** InlineAiPrompt — inline AI extend prompt that opens at the clicked point on the canvas.
 *  Opened via right-click on empty space (AddNodeMenu "Extend with AI") or by dropping
 *  from a node port onto empty space (QuickConnectMenu "Extend from this node").
 *
 *  Generation streams through the existing SSE agent stream; generated node/edge ids
 *  drop into the pendingProposal set → renderer highlights green, decision in ProposalBar.
 *  When the stream ends (done/paused/error/abort) the prompt closes; the "proposal" stays on the canvas. */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X, CornerDownLeft } from "lucide-react";
import { useAiChatStream } from "../../api/ai";
import { usePendingProposal } from "../../state/pending-proposal";
import { cn } from "@/lib/utils";

const W = 360;

export function InlineAiPrompt({
  projectId,
  tabId,
  screen,
  initialPrompt = "",
  contextPrefix = "",
  autoSend = false,
  source = null,
  onClose,
}: {
  projectId: string;
  tabId: string | null;
  screen: { x: number; y: number };
  /** Pre-filled prompt (carried over from the AddNodeMenu search). */
  initialPrompt?: string;
  /** Invisible context prepended to the message (QuickConnect source node). */
  contextPrefix?: string;
  /** true → send initialPrompt directly on mount. */
  autoSend?: boolean;
  /** QuickConnect source — "from <name>" chip above the input (family-colored). */
  source?: { name: string; color: string } | null;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialPrompt);
  const ref = useRef<HTMLDivElement>(null);
  const stream = useAiChatStream(projectId, tabId, {
    onNode: (id) => usePendingProposal.getState().addNode(id),
    onEdge: (id) => usePendingProposal.getState().addEdge(id),
    onRemoved: (id, kind) => usePendingProposal.getState().remove(id, kind),
  });
  const streaming = stream.status === "streaming";
  const streamingRef = useRef(streaming);
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  const send = (msg?: string) => {
    const m = (msg ?? text).trim();
    if (!m || streamingRef.current) return;
    usePendingProposal.getState().begin();
    stream.start(contextPrefix + m, "agent");
  };
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  // AddNodeMenu "Ask AI: <query>" path — send once on mount.
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (autoSend && initialPrompt.trim() && !autoSentRef.current) {
      autoSentRef.current = true;
      sendRef.current(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stream exit (done/paused/error/abort): if there's a proposal, move to the decision
  // stage (settle → ProposalBar), otherwise clear; the prompt closes either way.
  const prevStatusRef = useRef(stream.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = stream.status;
    if (prev !== "streaming" || stream.status === "streaming") return;
    const p = usePendingProposal.getState();
    if (p.nodeIds.size === 0 && p.edgeIds.size === 0) p.clear();
    else p.settle();
    onClose();
  }, [stream.status, onClose]);

  // Outside click: closes only while idle (streaming has its own cancel button).
  // Esc: close when idle, abort when streaming.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (streamingRef.current) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (streamingRef.current) stream.abort();
      else onClose();
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // Viewport clamp — no right/bottom overflow.
  const left = Math.min(Math.max(8, screen.x), window.innerWidth - W - 8);
  const top = Math.min(Math.max(8, screen.y), window.innerHeight - 96);

  return createPortal(
    <div
      ref={ref}
      style={{ left, top, width: W }}
      className={cn(
        "fixed z-[200] overflow-hidden rounded-[10px] border bg-card/95 backdrop-blur-xl shadow-float",
        "animate-in fade-in zoom-in-95 duration-150",
        // Green border + soft ring on focus — the AI field stands apart from the brand orange.
        streaming
          ? "border-[#10B981]/35"
          : "border-border transition-[border-color,box-shadow] duration-150 focus-within:border-[#10B981]/40 focus-within:shadow-[0_0_0_2px_rgba(16,185,129,0.15)]",
      )}
    >
      {streaming ? (
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          {/* 3-dot "thinking" — a calm pulse instead of a spinner */}
          <span className="flex shrink-0 items-center gap-[3px]" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-[5px] w-[5px] animate-pulse rounded-full bg-[#10B981]"
                style={{ animationDelay: `${i * 160}ms` }}
              />
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate font-sans text-[13px] text-muted-foreground">
            extending architecture…
          </span>
          {/* Live counter badge — brief pulse when the count changes (via re-mount) */}
          <span
            key={`${stream.progress.nodes}-${stream.progress.edges}`}
            className="shrink-0 rounded-full border border-[#10B981]/25 bg-[#10B981]/10 px-2 py-px
                       font-mono text-[11px] tabular-nums text-[#0c8f63]
                       animate-in fade-in zoom-in-95 duration-200"
          >
            {stream.progress.nodes} nodes · {stream.progress.edges} edges
          </span>
          <button
            type="button"
            onClick={stream.abort}
            aria-label="Stop generating"
            className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded
                       text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <>
          {/* Context chip — shows which node it was extended from */}
          {source && (
            <div className="flex items-center gap-1.5 border-b border-border/70 px-3 pb-1.5 pt-2">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: source.color }}
              />
              <span className="truncate font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                from {source.name}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-2">
            <Sparkles size={14} className="shrink-0 text-[#10B981]" />
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder='try "add a payment flow with Stripe"'
              spellCheck={false}
              className="w-full bg-transparent font-sans text-[13.5px] text-foreground outline-none
                         placeholder:text-muted-foreground/70"
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={!text.trim()}
              aria-label="Generate"
              className={cn(
                "shrink-0 inline-flex h-6 w-6 items-center justify-center rounded transition-colors",
                "text-muted-foreground hover:bg-muted hover:text-foreground",
                "disabled:cursor-not-allowed disabled:opacity-40",
              )}
            >
              <CornerDownLeft size={12} />
            </button>
          </div>
          <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 font-mono text-[10.5px] text-muted-foreground">
            <span>AI adds to your existing diagram</span>
            <span className="ml-auto">↵ generate · esc close</span>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
