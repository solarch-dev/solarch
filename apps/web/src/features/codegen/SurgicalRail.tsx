/** Surgical AI rail — persistent inspect/navigate/progress surface to the right of the editor.
 *  The "inspect the agent in the sidebar, without leaving the file" pattern from modern tools
 *  (Cursor 2.0 / Zed agent panel) — but ours: not chat, PROVENANCE-focused. Three sections:
 *   1. Live progress (during fill): X/Y + phase + calm bar.
 *   2. Provenance summary: regions by source (Constructor / Surgical AI / …).
 *   3. Region list (grouped by file): each region → click-to-jump (focus in editor). */

import { useMemo, useState } from "react";
import { Loader2, PanelRightClose, Check, ChevronRight, ChevronDown, RotateCcw, X } from "lucide-react";
import type { GeneratedFile, FillState } from "../../api/codegen";
import { baseName, regionSpans, type RegionKind, type RegionSpan } from "./lib";
import { EDITOR, PROVENANCE } from "./theme";
import { ActivityFeed } from "./ActivityFeed";

const KIND_ORDER: RegionKind[] = ["constructor", "ai", "human", "pending", "failed"];

/** Reduce the last phase to a calm single-line label (instead of a noisy log). */
function phaseLabel(fill: FillState): string | null {
  const p = fill.phases[fill.phases.length - 1];
  if (!p) return null;
  if (p.kind === "verify") return p.ok ? `Verified (round ${p.round})` : `Type-checking · round ${p.round}`;
  if (p.kind === "repair") return `Repairing · ${p.member ?? ""}`;
  if (p.kind === "imports") return `Resolving imports`;
  if (p.kind === "modgraph")
    return (p.findings ?? 0) > 0
      ? `Module wiring · ${p.findings} unresolved`
      : (p.repairs ?? 0) > 0
        ? `Module wiring repaired · ${p.repairs}`
        : `Module wiring verified`;
  if (p.kind === "tests") return p.skipped ? `Tests skipped` : p.ok ? `Tests passed` : `Tests failed`;
  return null;
}

export function SurgicalRail({
  files,
  failedByPath,
  fill,
  processed,
  denom,
  activePath,
  focusNodeId,
  onJump,
  onRevert,
  reverting,
  onCollapse,
}: {
  files: GeneratedFile[];
  failedByPath: Map<string, Set<string>>;
  fill: FillState;
  processed: number;
  denom: number;
  activePath: string | null;
  /** Region currently focused in the editor — to highlight it in the list. */
  focusNodeId?: string;
  onJump: (path: string, nodeId: string) => void;
  /** Revert a region back to a stub (AI/human-filled regions). */
  onRevert: (nodeId: string, member: string) => void;
  /** Revert/regen in progress — disable the confirm buttons. */
  reverting: boolean;
  onCollapse: () => void;
}) {
  // All regions, grouped by file (only files carrying surgical markers). Derived from content
  // → provenance/status updates itself as the fill progresses.
  const groups = useMemo(() => {
    const out: { file: GeneratedFile; regions: RegionSpan[] }[] = [];
    for (const f of files) {
      if (!f.surgicalMarkers) continue;
      const regions = regionSpans(f.content, failedByPath.get(f.path));
      if (regions.length) out.push({ file: f, regions });
    }
    return out;
  }, [files, failedByPath]);

  // Provenance distribution (summary counters).
  const tally = useMemo(() => {
    const t: Record<RegionKind, number> = { constructor: 0, ai: 0, human: 0, pending: 0, failed: 0 };
    for (const g of groups) for (const r of g.regions) t[r.kind]++;
    return t;
  }, [groups]);

  // The WHY of failed regions: from fill.regions, file#member → violations.
  const whyByKey = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of fill.regions) {
      if (r.status === "filled") continue;
      const v = r.violations?.length ? r.violations : r.error ? [r.error] : [];
      if (v.length) m.set(`${r.file}#${r.member}`, v);
    }
    return m;
  }, [fill.regions]);

  // Which failed region's "why" is open (one at a time — calm).
  const [expanded, setExpanded] = useState<string | null>(null);
  // Inline two-step confirm for revert (prevent accidental deletion): which region awaits confirm.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const streaming = fill.status === "streaming";
  const phase = streaming ? phaseLabel(fill) : null;
  const pct = denom > 0 ? Math.round((processed / denom) * 100) : 0;

  return (
    <aside
      className="flex h-full w-[280px] shrink-0 flex-col"
      style={{ background: EDITOR.sidebar, borderLeft: `1px solid ${EDITOR.border}` }}
    >
      {/* Header */}
      <div
        className="flex h-9 shrink-0 items-center justify-between px-3"
        style={{ borderBottom: `1px solid ${EDITOR.border}` }}
      >
        <span className="font-sans text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: EDITOR.textMuted }}>
          Surgical AI
        </span>
        <button
          type="button"
          onClick={onCollapse}
          title="Hide panel"
          className="grid h-6 w-6 place-items-center rounded transition-colors hover:bg-white/[0.06]"
          style={{ color: EDITOR.textFaint }}
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {/* Live progress — only during fill. Calm: one bar + one phase line. */}
      {streaming && (
        <div className="shrink-0 px-3 py-3" style={{ borderBottom: `1px solid ${EDITOR.border}` }}>
          <div className="flex items-center justify-between font-mono text-[12.5px]" style={{ color: EDITOR.text }}>
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" style={{ color: PROVENANCE.ai.color }} />
              Filling
            </span>
            <span className="tabular-nums" style={{ color: EDITOR.textMuted }}>
              {processed} / {denom || "—"}
            </span>
          </div>
          <div className="mt-2 h-[3px] overflow-hidden rounded-full" style={{ background: EDITOR.subtle }}>
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%`, background: PROVENANCE.ai.color }}
            />
          </div>
          {phase && (
            <div className="mt-2 truncate font-sans text-[12px]" style={{ color: EDITOR.textMuted }}>
              {phase}
            </div>
          )}
        </div>
      )}

      {/* LIVE: during fill, the agent activity feed (opencode-style) is the primary view —
          "what it's doing" is transparent. When done, it returns to the provenance summary + region list below. */}
      {streaming && <ActivityFeed activity={fill.activity} streaming />}

      {/* Empty state: fully deterministic project (no regions to fill). */}
      {!streaming && groups.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Check size={20} style={{ color: PROVENANCE.constructor.color }} />
          <div className="font-sans text-[13px]" style={{ color: EDITOR.text }}>
            Fully deterministic
          </div>
          <div className="font-sans text-[12px] leading-relaxed" style={{ color: EDITOR.textFaint }}>
            Every method was generated by the Constructor. Nothing to fill.
          </div>
        </div>
      )}

      {/* Provenance summary — regions by source. The "verified, not guessed" table. */}
      {!streaming && groups.length > 0 && (
        <div className="shrink-0 px-3 py-3" style={{ borderBottom: `1px solid ${EDITOR.border}` }}>
        <div className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: EDITOR.textFaint }}>
          Provenance
        </div>
        <div className="flex flex-col gap-1.5">
          {KIND_ORDER.filter((k) => tally[k] > 0).map((k) => (
            <div key={k} className="flex items-center gap-2 font-sans text-[13px]" title={PROVENANCE[k].hint}>
              <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: PROVENANCE[k].color }} />
              <span className="tabular-nums font-mono text-[12.5px]" style={{ color: EDITOR.text }}>
                {tally[k]}
              </span>
              <span style={{ color: EDITOR.textMuted }}>{PROVENANCE[k].label}</span>
            </div>
          ))}
        </div>
        </div>
      )}

      {/* Region list — grouped by file; click → jump to that region in the editor. */}
      {!streaming && groups.length > 0 && (
        <div className="min-h-0 flex-1 overflow-auto py-2">
        {groups.map((g) => (
          <div key={g.file.path} className="mb-1">
            <div
              className="flex items-center gap-1.5 px-3 py-1 font-mono text-[12px]"
              style={{ color: EDITOR.textFaint }}
            >
              <span className="truncate">{baseName(g.file.path)}</span>
            </div>
            {g.regions.map((r) => {
              const prov = PROVENANCE[r.kind];
              const focused = focusNodeId === r.nodeId && activePath === g.file.path;
              const key = `${g.file.path}#${r.member}`;
              const why = whyByKey.get(key);
              const isOpen = expanded === key;
              // Only AI/human-filled regions are revertible (Constructor is deterministic → not).
              const revertible = r.status === "done" && (r.by === "ai" || r.by === "human");
              const confirming = confirmKey === key;
              return (
                <div key={r.nodeId + r.member}>
                  <div
                    className="group flex items-center gap-2 pl-5 pr-2 transition-colors"
                    style={{ background: focused ? EDITOR.selected : "transparent" }}
                    onMouseEnter={(e) => {
                      if (!focused) e.currentTarget.style.background = EDITOR.hover;
                    }}
                    onMouseLeave={(e) => {
                      if (!focused) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onJump(g.file.path, r.nodeId)}
                      title={`${prov.label} — ${prov.hint}`}
                      className="flex min-w-0 flex-1 items-center gap-2 py-[3px] text-left"
                    >
                      <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: prov.color }} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px]" style={{ color: focused ? EDITOR.accent : EDITOR.text }}>
                        {r.member}
                      </span>
                    </button>

                    {confirming ? (
                      // Inline revert confirm — prevents accidental deletion.
                      <span className="flex shrink-0 items-center gap-1 font-sans text-[11px]" style={{ color: EDITOR.textMuted }}>
                        Revert?
                        <button
                          type="button"
                          disabled={reverting}
                          onClick={() => {
                            setConfirmKey(null);
                            onRevert(r.nodeId, r.member);
                          }}
                          title="Revert this region to a stub"
                          className="grid h-5 w-5 place-items-center rounded transition-colors hover:bg-white/[0.08] disabled:opacity-50"
                          style={{ color: PROVENANCE.failed.color }}
                        >
                          <Check size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmKey(null)}
                          title="Keep it"
                          className="grid h-5 w-5 place-items-center rounded transition-colors hover:bg-white/[0.08]"
                          style={{ color: EDITOR.textFaint }}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ) : (
                      <>
                        {r.status === "done" && r.by === "ai" && (
                          <Check size={12} className="shrink-0" style={{ color: prov.color }} />
                        )}
                        {/* Failed + has a reason → toggle "why"; otherwise non-done → provenance label. */}
                        {why ? (
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : key)}
                            title="Why it couldn't be verified"
                            className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 font-sans text-[11px] transition-colors hover:bg-white/[0.06]"
                            style={{ color: prov.color }}
                          >
                            {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} why
                          </button>
                        ) : (
                          r.status !== "done" && (
                            <span className="shrink-0 pr-1 font-sans text-[11px]" style={{ color: prov.color }}>
                              {prov.label}
                            </span>
                          )
                        )}
                        {/* Revert — only on AI/human-filled regions, visible on hover. */}
                        {revertible && (
                          <button
                            type="button"
                            onClick={() => setConfirmKey(key)}
                            title="Revert to stub"
                            className="grid h-5 w-5 shrink-0 place-items-center rounded opacity-0 transition-opacity hover:bg-white/[0.08] group-hover:opacity-100"
                            style={{ color: EDITOR.textFaint }}
                          >
                            <RotateCcw size={11} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {/* "Why" — tsc/contract violations (calm, mono, line by line). Trust: not a black box. */}
                  {isOpen && why && (
                    <ul className="space-y-1 py-1 pl-9 pr-3">
                      {why.map((v, idx) => (
                        <li key={idx} className="font-mono text-[11.5px] leading-relaxed" style={{ color: EDITOR.textMuted }}>
                          {v}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        </div>
      )}
    </aside>
  );
}
