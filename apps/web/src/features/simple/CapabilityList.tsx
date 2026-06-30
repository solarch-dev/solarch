/** Tier B — Capability card list: what a feature can do, in plain sentences.
 *
 *  Technical chain (Controller→Service→Repository→Table) COLLAPSEs into a single sentence;
 *  DTO/Cache/Middleware are hidden → "+N details". Writes (writes, filled square) and reads
 *  (reads, empty square) NEVER merge — wrong-simplification guard. Origin is shown via
 *  typography: no badge/gradient/emoji (no-slop). */

import { ArrowRight, ChevronLeft, Cloud } from "lucide-react";
import { CapabilityFlow } from "./CapabilityFlow";
import type { Capability, FeatureBox } from "./types";

export function CapabilityList({ feature, onBack }: { feature: FeatureBox; onBack: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col px-6 py-10">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-1 self-start text-[13px] text-[color:var(--ink-soft)] outline-none transition-colors hover:text-[color:var(--ink)] focus-visible:text-[color:var(--ink)]"
      >
        <ChevronLeft size={15} />
        System Map
      </button>

      <div className="mb-1 flex items-baseline gap-2.5">
        <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-[color:var(--ink)]">{feature.title}</h2>
        <span className="text-[13px] text-[color:var(--ink-faint)]">how this part works</span>
      </div>

      {/* ONE consolidated flowchart: a single shared "Signed in?" gate + each operation. */}
      {feature.flowGraph && feature.flowGraph.nodes.length > 0 && (
        <div className="mt-4 flex justify-center overflow-x-auto rounded-xl border border-[hsl(var(--border))] bg-[color:var(--paper-raised)] px-4 py-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          <CapabilityFlow flow={feature.flowGraph} />
        </div>
      )}

      {/* Supporting detail — what each operation touches (data / external / hidden). */}
      <div className="mt-3 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[color:var(--paper-raised)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        {feature.capabilities.map((c, i) => (
          <CapabilityRow key={i} cap={c} last={i === feature.capabilities.length - 1} />
        ))}
      </div>

      <Legend />
    </div>
  );
}

function CapabilityRow({ cap, last }: { cap: Capability; last: boolean }) {
  return (
    <div className={last ? "" : "border-b border-[hsl(var(--border))]"}>
      <div className="flex items-start gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          {/* actor · action */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[12.5px] text-[color:var(--ink-faint)]">{cap.actor}</span>
            <span className="text-[15px] font-medium tracking-[-0.01em] text-[color:var(--ink)]">{cap.action}</span>
          </div>

          {/* data + triggers + external */}
          <div className="mt-2 flex flex-col gap-1.5">
            {cap.data.map((d, j) => (
              <span key={j} className="flex items-center gap-2 text-[13px] text-[color:var(--ink-soft)]">
                <AccessMark access={d.access} />
                {d.access === "writes" ? "writes" : "reads"}: <span className="text-[color:var(--ink)]">{d.label}</span>
              </span>
            ))}
            {cap.triggers?.map((t, j) => (
              <span key={j} className="flex items-center gap-2 text-[13px] text-[color:var(--ink-soft)]">
                <ArrowRight size={13} className="text-[color:var(--ink-faint)]" />
                triggers: <span className="text-[color:var(--ink)]">{t}</span>
              </span>
            ))}
            {cap.external?.map((e, j) => (
              <span key={j} className="flex items-center gap-2 text-[13px] text-[color:var(--ink-soft)]">
                <Cloud size={13} className="text-[color:var(--ink-faint)]" />
                external service: <span className="text-[color:var(--ink)]">{e}</span>
              </span>
            ))}
          </div>
        </div>

        {cap.hidden > 0 && (
          <span className="mt-0.5 shrink-0 font-mono text-[11.5px] text-[color:var(--ink-faint)]">+{cap.hidden} details</span>
        )}
      </div>
    </div>
  );
}

/** Writes = filled square (accent), reads = empty square. */
function AccessMark({ access }: { access: "writes" | "reads" }) {
  return access === "writes" ? (
    <span aria-hidden className="inline-block h-[9px] w-[9px] shrink-0 rounded-[2px] bg-[color:var(--accent)]" />
  ) : (
    <span aria-hidden className="inline-block h-[9px] w-[9px] shrink-0 rounded-[2px] border border-[color:var(--ink-faint)]" />
  );
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11.5px] text-[color:var(--ink-faint)]">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-[9px] w-[9px] rounded-[2px] bg-[color:var(--accent)]" /> writes
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-[9px] w-[9px] rounded-[2px] border border-[color:var(--ink-faint)]" /> reads
      </span>
      <span className="flex items-center gap-1.5">
        <ArrowRight size={12} /> triggers
      </span>
      <span className="flex items-center gap-1.5">
        <Cloud size={12} /> external service
      </span>
      <span className="font-mono">+N hidden technical details</span>
    </div>
  );
}
