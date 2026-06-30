/** Simple View — ONE holistic canvas of the whole system (for NON-developers).
 *
 *  No drill, no list: the first view IS a single cohesive diagram compiled from the
 *  technical graph (Mermaid-compiler style: graph → IR → ELK compound layout → SVG).
 *  PURE PROJECTION — no separate state, no drift. */

import { SketchMap } from "./SketchMap";
import type { SystemMap as SystemMapData } from "./types";
import type { SimpleSketchModel } from "../../api/codegen";

export function SimpleView({ data, mermaid, model, organizing, source, aiConfigured, onRegenerate, regenerating, loading }: { data?: SystemMapData; mermaid?: string; model?: SimpleSketchModel; organizing?: boolean; source?: "ai" | "deterministic"; aiConfigured?: boolean; onRegenerate?: () => void; regenerating?: boolean; loading?: boolean }) {
  // Loading / empty (no features yet) — real graph, not fixture.
  if (!data || data.features.length === 0) {
    return (
      <div className="absolute inset-0 z-[5] grid place-items-center bg-[color:var(--paper)]">
        <p className="font-mono text-[13px] text-[color:var(--ink-faint)] animate-in fade-in duration-200">
          {loading ? "preparing simple view…" : "No parts yet — add a node to the diagram and it shows up here."}
        </p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-[5] bg-[color:var(--paper)]">
      <SketchMap data={data} mermaid={mermaid} model={model} organizing={organizing} source={source} aiConfigured={aiConfigured} onRegenerate={onRegenerate} regenerating={regenerating} />
    </div>
  );
}
