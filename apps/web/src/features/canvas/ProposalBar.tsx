/** ProposalBar — decision bar for the inline AI proposal.
 *  Floats above the canvas while the pending set is non-empty (stream done,
 *  awaiting decision): "AI added N nodes · M edges" + Approve (⏎) / Reject (⌫).
 *  - Approve: clear the set — elements are already in the DB, green highlight drops.
 *  - Reject : edges first then nodes deleted via raw delete (no history —
 *    this flow is outside the undo chain), cache refreshed. */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { usePendingProposal } from "../../state/pending-proposal";
import { rawDeleteEdge, rawDeleteNode } from "../../api/raw";
import { cn } from "@/lib/utils";

/** Don't let the bar intercept the shortcut when it belongs to another text field. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

export function ProposalBar({ projectId }: { projectId: string }) {
  const active = usePendingProposal((s) => s.active);
  const streaming = usePendingProposal((s) => s.streaming);
  const nodeIds = usePendingProposal((s) => s.nodeIds);
  const edgeIds = usePendingProposal((s) => s.edgeIds);
  const clear = usePendingProposal((s) => s.clear);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const visible = active && !streaming && (nodeIds.size > 0 || edgeIds.size > 0);

  const approve = () => {
    clear();
    toast.success("Added to your architecture");
  };

  const reject = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Edges first (they detach when a node is deleted, but avoid 404 noise),
      // then nodes. Individual errors are swallowed — the rest keep deleting.
      for (const id of edgeIds) {
        try {
          await rawDeleteEdge(projectId, id, qc);
        } catch {
          /* may already be gone via node cascade */
        }
      }
      for (const id of nodeIds) {
        try {
          await rawDeleteNode(projectId, id, qc);
        } catch {
          /* ignore — cleanup is best-effort */
        }
      }
    } finally {
      qc.invalidateQueries({ queryKey: ["tab-graph"] });
      clear();
      setBusy(false);
      toast("AI suggestion discarded");
    }
  };

  // ⏎ Approve / ⌫ Reject — disabled while a text field is focused; capture phase
  // runs before the canvas's own Delete shortcut.
  const approveRef = useRef(approve);
  const rejectRef = useRef(reject);
  useEffect(() => {
    approveRef.current = approve;
    rejectRef.current = reject;
  });
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        approveRef.current();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        e.stopPropagation();
        void rejectRef.current();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [visible]);

  if (!visible) return null;

  const parts: string[] = [];
  if (nodeIds.size > 0) parts.push(`${nodeIds.size} node${nodeIds.size > 1 ? "s" : ""}`);
  if (edgeIds.size > 0) parts.push(`${edgeIds.size} edge${edgeIds.size > 1 ? "s" : ""}`);

  return (
    <div
      className="absolute left-1/2 top-3 z-[60] -translate-x-1/2
                 flex items-center gap-3 overflow-hidden rounded-lg border border-border
                 bg-card/95 py-1.5 pl-3 pr-1.5 shadow-float backdrop-blur-xl
                 animate-in fade-in slide-in-from-top-1 duration-200"
      role="region"
      aria-label="AI proposal pending approval"
    >
      {/* Top accent line — sets the "proposal mode" bar apart from other canvas chrome */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-[#10B981]/40" />
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10B981] opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#10B981]" />
      </span>
      <span className="font-mono text-[13px] text-foreground whitespace-nowrap">
        AI added {parts.join(" · ")}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void reject()}
          disabled={busy}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5",
            "font-mono text-[13px] text-muted-foreground transition-colors",
            "hover:border-destructive/40 hover:text-destructive disabled:cursor-wait disabled:opacity-60",
          )}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
          {busy ? "Removing…" : "Reject"}
          {!busy && (
            <kbd className="rounded border border-border bg-muted/40 px-1 font-mono text-[10px] leading-[14px] text-muted-foreground">
              ⌫
            </kbd>
          )}
        </button>
        <button
          type="button"
          onClick={approve}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#10B981] px-2.5
                     font-mono text-[13px] font-medium text-white transition-colors
                     hover:bg-[#0c8f63] disabled:opacity-60"
        >
          <Check size={12} />
          Approve
          <kbd className="rounded border border-white/30 bg-white/15 px-1 font-mono text-[10px] leading-[14px] text-white">
            ⏎
          </kbd>
        </button>
      </div>
    </div>
  );
}
