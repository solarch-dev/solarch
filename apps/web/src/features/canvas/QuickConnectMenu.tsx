import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { useRules, legalTargets, legalSources } from "../../api/rules";
import { colorOf } from "../../canvas/families";

interface Props {
  nodeType: string;
  side: "in" | "out";
  screen: { x: number; y: number };
  onPick: (nodeType: string, edgeKind: string) => void;
  onClose: () => void;
  /** "Extend with AI from this node" — opens the inline AI prompt with the source context. */
  onExtendAi?: () => void;
}

const MENU_WIDTH = 260;
const MENU_MAX_HEIGHT_RATIO = 0.56;

export function QuickConnectMenu({ nodeType, side, screen, onPick, onClose, onExtendAi }: Props) {
  const { data: whitelist } = useRules();
  const ref = useRef<HTMLDivElement>(null);

  const options = whitelist
    ? side === "out"
      ? legalTargets(whitelist, nodeType)
      : legalSources(whitelist, nodeType)
    : null;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Viewport bounds — prevent right/bottom overflow
  const maxH = window.innerHeight * MENU_MAX_HEIGHT_RATIO;
  const left = Math.min(screen.x + 10, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(screen.y, window.innerHeight - maxH - 8);
  const label = side === "out" ? "connect & create →" : "← connect & create";

  return createPortal(
    <div
      ref={ref}
      style={{ left, top }}
      className="fixed z-[200] w-[260px] max-h-[56vh] flex flex-col
                 bg-card/90 backdrop-blur-xl border border-border rounded-lg
                 shadow-float overflow-hidden
                 animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground px-[14px] pt-[10px] pb-1.5 border-b border-border">
        {label}
      </div>
      {!options ? (
        <div className="font-mono text-[13px] text-muted-foreground px-[14px] py-3">
          loading rules…
        </div>
      ) : options.length === 0 ? (
        <div className="font-sans text-[13px] text-muted-foreground px-[14px] py-3">
          Cannot create a connection in this direction.
        </div>
      ) : (
        <div className="overflow-y-auto pt-1 pb-1.5">
          {options.map((o) => (
            <button
              key={`${o.nodeType}::${o.edge}`}
              title={o.note}
              onClick={() => onPick(o.nodeType, o.edge)}
              className="flex items-center gap-2.5 w-full border-0 bg-transparent
                         px-[14px] py-[7px] font-sans text-[14px] text-foreground
                         text-left cursor-pointer transition-colors duration-100
                         hover:bg-muted/50"
            >
              <span
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ background: colorOf(o.nodeType) }}
              />
              <span className="flex-1 min-w-0 font-medium">{o.nodeType}</span>
              <span className="font-mono text-[10.5px] bg-muted px-1.5 py-px rounded text-muted-foreground whitespace-nowrap">
                {o.edge}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Inline AI extension — with source node context */}
      {onExtendAi && (
        <button
          type="button"
          onClick={onExtendAi}
          className="group flex w-full cursor-pointer items-center gap-2.5 border-t border-border
                     bg-transparent px-[14px] py-2 text-left transition-colors duration-100
                     hover:bg-[#10B981]/10"
        >
          <Sparkles size={12} className="shrink-0 text-[#10B981]" />
          <span className="min-w-0 flex-1 truncate font-sans text-[13.5px] font-medium text-foreground">
            Extend with AI from this node
          </span>
        </button>
      )}
    </div>,
    document.body,
  );
}
