import { useEffect } from "react";
import { ArrowRight, X } from "lucide-react";
import { useRules, legalEdgeKinds } from "../../api/rules";

/** Bottom-center Omni-Bar: shows legal edge types for source→target (reactive). */
export function EdgePicker({ sourceType, targetType, onPick, onClose }: {
  sourceType: string;
  targetType: string;
  onPick: (edge: string) => void;
  onClose: () => void;
}) {
  const { data: whitelist } = useRules();
  const kinds = whitelist ? legalEdgeKinds(whitelist, sourceType, targetType) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="absolute left-1/2 bottom-[26px] -translate-x-1/2 z-[22]
                    flex items-center gap-3 px-4 py-2.5
                    bg-card/95 backdrop-blur-xl border border-border rounded-full
                    shadow-float min-w-[420px] max-w-[80vw]
                    animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-2 font-mono text-[12px] text-muted-foreground">
        <span className="text-foreground font-semibold">{sourceType}</span>
        <ArrowRight size={11} className="text-muted-foreground" />
        <span className="text-foreground font-semibold">{targetType}</span>
      </div>

      <div className="flex-1 min-w-0">
        {!whitelist ? (
          <span className="font-mono text-[12px] text-muted-foreground">loading rules…</span>
        ) : kinds.length === 0 ? (
          <span className="font-sans text-[12.5px] text-destructive">
            <b>{sourceType}</b> cannot connect directly to <b>{targetType}</b> — a suitable intermediate layer is needed.
          </span>
        ) : (
          <div className="flex items-center flex-wrap gap-1.5">
            {kinds.map((k) => (
              <button
                key={k.edge}
                onClick={() => onPick(k.edge)}
                title={k.note}
                className="font-mono text-[11.5px] uppercase tracking-[0.04em]
                           h-7 px-2.5 rounded-md border border-border bg-transparent
                           text-foreground cursor-pointer transition-all duration-100
                           hover:border-brand-500/40 hover:bg-brand-500/5 hover:text-brand-500
                           active:scale-95"
              >
                {k.edge}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onClose}
        title="Cancel (Esc)"
        aria-label="Close"
        className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded
                   text-muted-foreground hover:bg-muted hover:text-foreground
                   transition-colors duration-100"
      >
        <X size={12} />
      </button>
    </div>
  );
}
