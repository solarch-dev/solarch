/** Inline node/edge chip — clickable reference parsed from LLM's [[node:ID|Name]]
 *  markup in AI chat (instruct mode). Tinted with family color + border,
 *  hover lift, click → canvas pan/zoom + highlight halo. */

import { useEffect, useRef } from "react";
import { useCanvasCommands } from "../../canvas/canvas-commands";
import { familyOf, colorOfFamily } from "../../canvas/families";
import { cn } from "@/lib/utils";

interface NodeChipProps {
  id: string;
  name: string;
  type?: string; // for family color, optional (defaults to access orange)
  /** Focus tracking during stream — if same node appears multiple times, zoom on first, then only highlight. */
  focusedSet: Set<string>;
  /** false: do NOT auto-focus on mount (ResultPanel sequential orchestrator took over).
   *  default true (backward-compatible). */
  focusOnMount?: boolean;
}

export function NodeChip({ id, name, type, focusedSet, focusOnMount = true }: NodeChipProps) {
  const focusNode = useCanvasCommands((s) => s.focusNode);
  const mountedRef = useRef(false);

  // Smart focus on mount — opt-in. ResultPanel sentence player passes false
  // because it does sequential 2s focus orchestration during sentence reveal.
  useEffect(() => {
    if (!focusOnMount) return;
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (!focusNode) return;
    const isFirstFocus = !focusedSet.has(id);
    focusedSet.add(id);
    focusNode(id, { zoom: isFirstFocus });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const family = type ? familyOf(type) : "access";
  const accent = colorOfFamily(family);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    focusNode?.(id, { zoom: true });
  };

  return (
    <span
      onClick={handleClick}
      title={type ? `${type} — Focus on Canvas` : "Focus on Canvas"}
      className={cn(
        "inline-flex items-baseline gap-0.5 mx-[1px] px-1.5 py-[1px] rounded",
        "text-[13px] font-medium cursor-pointer select-none",
        "border transition-all duration-150",
        "hover:-translate-y-[1px] hover:shadow-sm"
      )}
      style={{
        backgroundColor: `${accent}1A`,    // ~10% opacity tint
        borderColor: `${accent}40`,        // ~25% opacity border
        color: accent,
      }}
    >
      {name}
    </span>
  );
}

interface EdgeChipProps {
  id: string;
  name: string;
  focusedSet: Set<string>;
  focusOnMount?: boolean;
}

export function EdgeChip({ id, name, focusedSet, focusOnMount = true }: EdgeChipProps) {
  const focusEdge = useCanvasCommands((s) => s.focusEdge);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!focusOnMount) return;
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (!focusEdge) return;
    if (!focusedSet.has(id)) {
      focusedSet.add(id);
      focusEdge(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    focusEdge?.(id);
  };

  return (
    <span
      onClick={handleClick}
      title="Edge — highlight on canvas"
      className={cn(
        "inline-flex items-baseline mx-[1px] px-1.5 py-[1px] rounded",
        "text-[12.5px] font-medium cursor-pointer select-none",
        "bg-muted/60 border border-border text-muted-foreground",
        "hover:bg-muted hover:text-foreground transition-all duration-150",
        "hover:-translate-y-[1px] hover:shadow-sm"
      )}
    >
      {name}
    </span>
  );
}
