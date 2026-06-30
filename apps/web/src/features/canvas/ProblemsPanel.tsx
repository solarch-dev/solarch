/** ProblemsPanel — "Verify my architecture" trigger + floating Glass results.
 *  Self-contained: a Verify button in the BottomBar that runs the whole-graph
 *  rule review (POST /review) and shows a ranked Problems list above it. Each
 *  finding is clickable → focusEdge highlights the offending connection on canvas.
 *  Deterministic, read-only — nothing is auto-applied. */

import { useState } from "react";
import { ShieldCheck, AlertCircle, AlertTriangle, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useReviewArchitecture, type ReviewFinding } from "../../api/review";
import { useCanvasCommands } from "../../canvas/canvas-commands";

export function ProblemsPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const review = useReviewArchitecture(projectId);
  const focusEdge = useCanvasCommands((s) => s.focusEdge);
  const result = review.data;

  const run = () => {
    setOpen(true);
    review.mutate();
  };

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={run}
            className="h-7 px-2 gap-1.5 text-[13px]"
            aria-label="Verify architecture"
          >
            {review.isPending ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
            Verify
          </Button>
        </TooltipTrigger>
        <TooltipContent>Verify the architecture against the Rules Engine</TooltipContent>
      </Tooltip>

      {open && (
        <div
          className={cn(
            "absolute bottom-full right-0 mb-2 flex w-[360px] max-h-[52vh] flex-col overflow-hidden",
            "rounded-lg border border-border bg-card/95 shadow-float backdrop-blur-xl",
          )}
          role="dialog"
          aria-label="Architecture problems"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <ShieldCheck size={13} className="text-brand-500" />
            <span className="text-[13px] font-semibold">Verify</span>
            {result && (
              <span className="text-[12px] text-muted-foreground">
                {result.summary.clean
                  ? "no problems"
                  : `${result.summary.errors} error(s), ${result.summary.warnings} warning(s)`}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X size={13} />
            </button>
          </div>

          <div className="overflow-y-auto">
            {review.isPending && (
              <div className="flex items-center justify-center gap-2 px-3 py-7 text-[13px] text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Checking every connection…
              </div>
            )}

            {!review.isPending && review.isError && (
              <div className="px-3 py-7 text-center text-[13px] text-muted-foreground">
                Could not run the review.{" "}
                <button type="button" onClick={run} className="text-brand-500 hover:underline">
                  Try again
                </button>
              </div>
            )}

            {!review.isPending && result && result.summary.clean && (
              <div className="flex flex-col items-center gap-2 px-3 py-7 text-center">
                <ShieldCheck size={22} className="text-emerald-500" />
                <span className="text-[13px] font-medium">Architecture verified</span>
                <span className="text-[12px] text-muted-foreground">
                  Every connection conforms to the Rules Engine.
                </span>
              </div>
            )}

            {!review.isPending && result && !result.summary.clean && (
              <ul className="divide-y divide-border">
                {result.findings.map((f, i) => (
                  <FindingRow key={`${f.edgeId}-${i}`} f={f} onClick={() => focusEdge?.(f.edgeId)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FindingRow({ f, onClick }: { f: ReviewFinding; onClick: () => void }) {
  const isError = f.severity === "error";
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
        title="Show on canvas"
      >
        {isError ? (
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
        ) : (
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
        )}
        <div className="min-w-0">
          <p className="text-[13px] leading-snug text-foreground">{f.message}</p>
          {f.suggestion && (
            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{f.suggestion}</p>
          )}
          <span className="mt-1 inline-block font-mono text-[11px] text-muted-foreground/70">
            {f.code} · {f.edgeKind}
          </span>
        </div>
      </button>
    </li>
  );
}
