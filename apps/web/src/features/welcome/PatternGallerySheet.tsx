/** PatternGallerySheet — right-side slide-in modal listing the seed patterns,
 *  each with a tidy mini-diagram preview. Picking one creates a project seeded
 *  with the pattern's rules-legal sub-graph. */

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, ArrowRight, Loader2, LayoutTemplate } from "lucide-react";
import { usePatternDetails, type PatternSummary } from "../../api/patterns";
import { PatternPreview } from "./PatternPreview";

export function PatternGallerySheet({
  open,
  onOpenChange,
  patterns,
  onUse,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patterns: PatternSummary[];
  onUse: (p: PatternSummary) => void;
  pending: boolean;
}) {
  const [usingId, setUsingId] = useState<string | null>(null);
  // Fetch the full graphs (for previews) only while the sheet is open.
  const details = usePatternDetails(open ? patterns.map((p) => p.id) : []);

  const use = (p: PatternSummary) => {
    setUsingId(p.id);
    onUse(p);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-[71] flex w-full max-w-[460px] flex-col border-l border-border bg-card shadow-float data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right data-[state=open]:duration-300 data-[state=closed]:duration-200">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <LayoutTemplate size={15} className="text-brand-500" />
            <DialogPrimitive.Title className="font-sans text-[15px] font-semibold text-[color:var(--ink)]">
              Start from a template
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <X size={15} />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Pick a rules-verified architecture pattern to start your project from.
          </DialogPrimitive.Description>

          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {patterns.map((p, i) => {
              const graph = details[i]?.data?.graph;
              const busy = pending && usingId === p.id;
              return (
                <div key={p.id} className="overflow-hidden rounded-xl border border-border bg-card/95">
                  {/* preview */}
                  <div className="h-[96px] border-b border-border bg-muted/25 p-2">
                    {graph ? (
                      <PatternPreview graph={graph} />
                    ) : (
                      <div className="h-full w-full animate-pulse rounded-md bg-muted/50" />
                    )}
                  </div>
                  {/* meta + action */}
                  <div className="p-3">
                    <h3 className="truncate font-sans text-[14px] font-semibold text-[color:var(--ink)]">{p.name}</h3>
                    <p className="mt-0.5 line-clamp-2 font-mono text-[11.5px] leading-snug text-muted-foreground">
                      {p.description}
                    </p>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="font-mono text-[11px] text-muted-foreground/70">
                        {p.nodeCount} nodes · {p.edgeCount} edges
                      </span>
                      <button
                        type="button"
                        onClick={() => use(p)}
                        disabled={pending}
                        className="inline-flex items-center gap-1 rounded-md bg-brand-500 px-2.5 py-1.5 font-mono text-[12px] font-medium text-black transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busy ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />}
                        Use template
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
