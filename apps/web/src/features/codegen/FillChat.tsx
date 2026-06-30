/** FillChat — Surgical AI's CHAT-PRIMARY surface (Lovable/v0 pattern).
 *
 *  Instead of the old full-IDE (FileTree | editor | rail): the main view is CHAT. The AI's read/grep/verify
 *  actions are grouped into region-based messages; code is not embedded in the chat (deep-research: VS Code agent
 *  mode also keeps code out of the flow) — clicking a region/file opens a minimal preview on the right.
 *
 *  Three states:
 *   - idle:      large centered "Fill" button + micro-copy + region count (empty/start).
 *   - streaming: live conversation — each region is a message, with a collapsible ToolGroup below
 *                (active region expanded, finished one collapses — assistant-ui pattern).
 *   - done:      conversation + summary message (Filled N · tsc) + file list (clickable) + Handoff.
 *
 *  NO AI-SLOP: no pill/gradient/glow — mono+icon+EDITOR/PROVENANCE color discipline. Theme-aware. */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, X, Loader2, Braces, Code2, Download, FlaskConical, FileText, FolderTree, Search, ScanSearch,
  ChevronRight, ChevronDown, ShieldCheck, ShieldAlert, AlertCircle, RefreshCw,
} from "lucide-react";
import type { FillActivity, FillState, GeneratedProject } from "../../api/codegen";
import { EDITOR, PROVENANCE } from "./theme";
import { baseName, fileFillStatus } from "./lib";
import { FileIcon } from "./FileIcon";
import { SurgicalHandoff } from "./SurgicalHandoff";

/** Reduce the last phase to a calm single-line label (same language as SurgicalRail). */
function phaseLabel(fill: FillState): string | null {
  const p = fill.phases[fill.phases.length - 1];
  if (!p) return null;
  if (p.kind === "verify") return p.ok ? `verified (round ${p.round})` : `type-checking · round ${p.round}`;
  if (p.kind === "repair") return `repairing · ${p.member ?? ""}`;
  if (p.kind === "imports") return `resolving imports`;
  if (p.kind === "modgraph")
    return (p.findings ?? 0) > 0
      ? `module wiring · ${p.findings} unresolved`
      : (p.repairs ?? 0) > 0
        ? `module wiring repaired · ${p.repairs}`
        : `module wiring verified`;
  if (p.kind === "tests") return p.skipped ? `tests skipped` : p.ok ? `tests passed` : `tests failed`;
  return null;
}

type UnitStatus = "filling" | "filled" | "violation" | "error";

interface RegionUnit {
  key: string;
  member: string;
  file: string;
  status: UnitStatus;
  activities: FillActivity[];
  violations?: string[];
}

/** Group the flat activity + region stream into REGION units (de-interleaves the parallel stream).
 *  Order = first-seen. A unit with no region result yet → "filling". */
function groupConversation(activity: FillActivity[], regions: FillState["regions"]): RegionUnit[] {
  const map = new Map<string, RegionUnit>();
  const order: string[] = [];
  const keyOf = (file: string, member: string) => `${file}#${member}`;

  for (const a of activity) {
    const key = keyOf(a.file, a.member);
    let u = map.get(key);
    if (!u) {
      u = { key, member: a.member, file: a.file, status: "filling", activities: [] };
      map.set(key, u);
      order.push(key);
    }
    u.activities.push(a);
  }
  for (const r of regions) {
    const key = keyOf(r.file, r.member);
    let u = map.get(key);
    if (!u) {
      u = { key, member: r.member, file: r.file, status: "filling", activities: [] };
      map.set(key, u);
      order.push(key);
    }
    u.status = r.status; // "filled" | "violation" | "error"
    if (r.violations?.length) u.violations = r.violations;
  }
  return order.map((k) => map.get(k)!);
}

/** Tool → icon (exploration calm/muted; verify result carries color). */
function toolIcon(a: FillActivity) {
  if (a.tool === "verify_fill") {
    return a.ok
      ? <Check size={12} style={{ color: PROVENANCE.ai.color }} />
      : <X size={12} style={{ color: PROVENANCE.failed.color }} />;
  }
  const c = EDITOR.textFaint;
  switch (a.tool) {
    case "read": return <FileText size={12} style={{ color: c }} />;
    case "grep": return <Search size={12} style={{ color: c }} />;
    case "glob": return <FolderTree size={12} style={{ color: c }} />;
    case "lookup_members": return <ScanSearch size={12} style={{ color: c }} />;
    default: return <FileText size={12} style={{ color: c }} />;
  }
}

/** ToolGroup summary line: "read 3 · grep 1 · verify ✓" (compresses noise). */
function toolSummary(acts: FillActivity[]): { text: string; verifyOk?: boolean } {
  const c: Record<string, number> = {};
  let verifyOk: boolean | undefined;
  for (const a of acts) {
    if (a.tool === "verify_fill") { c.verify = (c.verify ?? 0) + 1; verifyOk = a.ok; }
    else c[a.tool] = (c[a.tool] ?? 0) + 1;
  }
  const parts: string[] = [];
  if (c.read) parts.push(`read ${c.read}`);
  if (c.grep) parts.push(`grep ${c.grep}`);
  if (c.glob) parts.push(`glob ${c.glob}`);
  if (c.lookup_members) parts.push(`lookup ${c.lookup_members}`);
  if (c.verify) parts.push(`verify ${verifyOk === false ? "✗" : "✓"}`);
  return { text: parts.join(" · ") || "working…", verifyOk };
}

function statusDot(status: UnitStatus) {
  if (status === "filling") return <Loader2 size={13} className="animate-spin" style={{ color: EDITOR.accent }} />;
  if (status === "filled") return <Check size={13} style={{ color: PROVENANCE.ai.color }} />;
  return <X size={13} style={{ color: PROVENANCE.failed.color }} />;
}

/** A region message: header (clickable → code) + collapsible step list. */
function RegionMessage({
  unit, expanded, onToggle, onOpen,
}: {
  unit: RegionUnit;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { text } = toolSummary(unit.activities);
  return (
    <div className="rounded-md" style={{ border: `1px solid ${EDITOR.border}`, background: EDITOR.subtle }}>
      {/* Header — clicking opens the code preview */}
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--ed-hover)]"
      >
        <span className="shrink-0">{statusDot(unit.status)}</span>
        <span className="min-w-0 flex-1 truncate font-sans text-[13.5px] font-medium" style={{ color: EDITOR.text }}>
          {unit.member}
        </span>
        <span className="shrink-0 truncate font-mono text-[11.5px]" style={{ color: EDITOR.textFaint }}>
          {baseName(unit.file)}
        </span>
      </button>
      {/* ToolGroup — step summary / expand */}
      {unit.activities.length > 0 && (
        <div style={{ borderTop: `1px solid ${EDITOR.border}` }}>
          <button
            type="button"
            onClick={onToggle}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-mono text-[11.5px] transition-colors hover:bg-[var(--ed-hover)]"
            style={{ color: EDITOR.textMuted }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>{unit.activities.length} steps</span>
            <span style={{ color: EDITOR.textFaint }}>· {text}</span>
          </button>
          {expanded && (
            <div className="flex flex-col gap-[3px] px-3 pb-2 pl-7">
              {unit.activities.map((a, i) => (
                <div key={i} className="flex items-start gap-1.5 font-mono text-[12px] leading-[1.5]">
                  <span className="mt-[2px] shrink-0">{toolIcon(a)}</span>
                  <span className="min-w-0 flex-1" style={{ color: a.tool === "verify_fill" && a.ok === false ? PROVENANCE.failed.color : EDITOR.text }}>
                    {a.summary}
                    {a.tool === "verify_fill" && a.attempt ? (
                      <span style={{ color: EDITOR.textFaint }}> · attempt {a.attempt}</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* Reason a region failed (tsc/contract violations) */}
          {unit.violations?.length ? (
            <div className="flex flex-col gap-0.5 px-3 pb-2 pl-7 font-mono text-[11.5px]" style={{ color: PROVENANCE.failed.color }}>
              {unit.violations.slice(0, 4).map((v, i) => <div key={i} className="truncate">{v}</div>)}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function FillChat({
  result,
  fill,
  surgicalCount,
  fillProcessed,
  fillDenom,
  deepVerify,
  onToggleDeepVerify,
  onFill,
  onOpen,
  onShowCode,
  zipping,
  onDownload,
  skippedTotal,
}: {
  result: GeneratedProject;
  fill: FillState;
  surgicalCount: number;
  fillProcessed: number;
  fillDenom: number;
  deepVerify: boolean;
  onToggleDeepVerify: () => void;
  onFill: () => void;
  /** A region/file was clicked → open the minimal code preview on the right. member → focus that region. */
  onOpen: (path: string, member?: string) => void;
  /** Open the editor view (on the first surgical file) — "Show code" / fill it yourself. */
  onShowCode: () => void;
  zipping: boolean;
  onDownload: () => void;
  skippedTotal: number;
}) {
  const streaming = fill.status === "streaming";
  const units = useMemo(() => groupConversation(fill.activity, fill.regions), [fill.activity, fill.regions]);
  const activeKey = streaming ? units.filter((u) => u.status === "filling").slice(-1)[0]?.key : undefined;

  // ToolGroup open/closed — default: active region open, rest closed; user can override.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isExpanded = (key: string) => overrides[key] ?? key === activeKey;

  // Auto-scroll to the bottom while streaming.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!streaming) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [units.length, fill.activity.length, streaming]);

  // ── EMPTY / START — large centered Fill button ──────────────────────────
  if (fill.status === "idle") {
    const fileCount = result.files.filter((f) => f.surgicalMarkers > 0).length;
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6" style={{ background: EDITOR.bg }}>
        <div className="flex w-full max-w-[560px] flex-col items-center text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: EDITOR.accentWash, color: EDITOR.accent }}>
            <Braces size={22} strokeWidth={2.25} />
          </span>
          <h2 className="font-sans text-[19px] font-semibold tracking-[-0.01em]" style={{ color: EDITOR.text }}>
            Solarch turned your diagram into code
          </h2>
          <p className="mt-2.5 max-w-[52ch] font-sans text-[13.5px] leading-relaxed" style={{ color: EDITOR.textMuted }}>
            A complete NestJS skeleton — controllers, services, repositories, DTOs, wired and type-safe.
            The algorithmic regions marked <span className="font-mono text-[12.5px]">@solarch:surgical</span> are
            yours to fill: open the editor and do it yourself, or auto-fill them with Surgical AI
            under contract and verified with <b>tsc</b>.
          </p>
          {surgicalCount > 0 && (
            <p className="mt-3 font-mono text-[12px]" style={{ color: EDITOR.textFaint }}>
              {surgicalCount} region{surgicalCount === 1 ? "" : "s"} across {fileCount} file{fileCount === 1 ? "" : "s"} · skeleton ready
            </p>
          )}

          {/* two paths — equal width, fill (Surgical AI) vs outline (fill it yourself) hierarchy */}
          <div className="mt-6 flex w-full max-w-[340px] flex-col gap-2.5">
            {surgicalCount > 0 && (
            <button
              type="button"
              onClick={onFill}
              className="group/cta relative inline-flex w-full flex-col items-start gap-0.5 overflow-hidden rounded-lg px-5 py-3 text-left text-black shadow-sm transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.55)] active:translate-y-0 active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ed-bg)]"
              style={{ background: EDITOR.accent }}
            >
              <span aria-hidden className="cta-sheen pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-white/25 blur-[2px]" />
              <span className="relative z-10 inline-flex items-center gap-2 text-[14px] font-semibold">
                <Braces size={16} strokeWidth={2.5} className="transition-transform duration-150 group-hover/cta:scale-110" />
                Fill with Surgical AI
              </span>
              <span className="relative z-10 text-[11.5px] font-medium" style={{ color: "rgba(0,0,0,0.7)" }}>
                Auto-fill every body, verify the project with tsc
              </span>
            </button>
            )}

            {/* fill it yourself — Show code (prominent: open the editor, fill bodies inline) + Download .zip (quiet) */}
            <div className="flex items-stretch gap-2.5">
              <button
                type="button"
                onClick={onShowCode}
                className="inline-flex flex-1 flex-col items-start gap-0.5 rounded-lg px-5 py-3 text-left shadow-sm transition-[background-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)] active:translate-y-0 active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ed-bg)]"
                style={{ background: EDITOR.subtleStrong, border: `1px solid ${EDITOR.borderStrong}` }}
              >
                <span className="inline-flex items-center gap-2 text-[14px] font-semibold" style={{ color: EDITOR.text }}>
                  <Code2 size={16} strokeWidth={2.25} style={{ color: EDITOR.accent }} />
                  Show code
                </span>
                <span className="text-[11.5px] font-medium" style={{ color: EDITOR.textMuted }}>
                  Open the editor &amp; fill the bodies inline
                </span>
              </button>
              <button
                type="button"
                onClick={onDownload}
                disabled={zipping}
                title="Download the project as a .zip"
                aria-label="Download the project as a .zip"
                className="inline-flex shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-4 transition-colors hover:bg-[var(--ed-hover)] disabled:opacity-60 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ed-bg)]"
                style={{ border: `1px solid ${EDITOR.border}`, background: "transparent", color: EDITOR.textMuted }}
              >
                {zipping ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} strokeWidth={2.25} />}
                <span className="font-mono text-[11px]">.zip</span>
              </button>
            </div>
          </div>

          {/* Deep verify (jest) — below the actions, scoped to the Surgical AI path */}
          {surgicalCount > 0 && (
            <button
              type="button"
              onClick={onToggleDeepVerify}
              title="Also generate and run jest behavioural specs (slower, higher confidence)"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors"
              style={{ color: deepVerify ? EDITOR.accent : EDITOR.textMuted }}
            >
              <FlaskConical size={13} /> Deep verify (jest){deepVerify ? " · on" : ""}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── STREAMING / DONE / ERROR — conversation stream ─────────────────────────
  const done = fill.status === "done";
  const error = fill.status === "error";
  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ background: EDITOR.bg, scrollbarWidth: "thin" }}>
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-2.5 px-4 py-5">
        {/* Progress header */}
        <div className="flex items-center gap-2 font-mono text-[12.5px]" style={{ color: EDITOR.textMuted }}>
          {streaming ? <Loader2 size={13} className="animate-spin" style={{ color: EDITOR.accent }} />
            : error ? <AlertCircle size={13} style={{ color: EDITOR.danger }} />
            : <Check size={13} style={{ color: PROVENANCE.ai.color }} />}
          <span style={{ color: EDITOR.text }}>
            {streaming ? `Filling ${fillProcessed}/${fillDenom}` : error ? "Fill stopped" : `Filled ${fill.filled}/${fillDenom}`}
          </span>
          {streaming && phaseLabel(fill) ? <span style={{ color: EDITOR.textFaint }}>· {phaseLabel(fill)}</span> : null}
        </div>

        {/* Region messages */}
        {units.map((u) => (
          <RegionMessage
            key={u.key}
            unit={u}
            expanded={isExpanded(u.key)}
            onToggle={() => setOverrides((o) => ({ ...o, [u.key]: !isExpanded(u.key) }))}
            onOpen={() => onOpen(u.file, u.member)}
          />
        ))}

        {streaming && units.length === 0 && (
          <p className="px-1 font-sans text-[13px]" style={{ color: EDITOR.textMuted }}>Reading the codebase…</p>
        )}

        {/* Error — partial conversation + retry */}
        {error && (
          <div className="flex items-center gap-2 rounded-md px-3 py-2.5" style={{ border: `1px solid ${EDITOR.border}`, background: EDITOR.dangerWash }}>
            <AlertCircle size={15} style={{ color: EDITOR.danger }} />
            <span className="min-w-0 flex-1 font-mono text-[12px]" style={{ color: EDITOR.danger }}>{fill.error ?? "Surgical AI stopped."}</span>
            {fill.retryable && (
              <button
                type="button"
                onClick={onFill}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold text-black transition-colors"
                style={{ background: EDITOR.accent }}
              >
                <RefreshCw size={13} /> Try again
              </button>
            )}
          </div>
        )}

        {/* Done summary */}
        {done && (
          <div className="mt-2 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 rounded-md px-3 py-2.5" style={{ border: `1px solid ${EDITOR.border}`, background: EDITOR.subtle }}>
              {fill.typecheck?.ok !== false
                ? <ShieldCheck size={15} style={{ color: PROVENANCE.ai.color }} />
                : <ShieldAlert size={15} style={{ color: EDITOR.pending }} />}
              <span className="font-sans text-[13.5px] font-medium" style={{ color: EDITOR.text }}>
                Filled {fill.filled}/{fillDenom}
              </span>
              <span className="font-mono text-[11.5px]" style={{ color: EDITOR.textMuted }}>
                {fill.mode?.verified ? (fill.typecheck?.ok === false ? "· tsc: residual" : "· tsc clean") : "· draft"}
                {fill.violations > 0 ? ` · ${fill.violations} need a manual pass` : ""}
                {skippedTotal > 0 ? ` · ${skippedTotal} nodes skipped` : ""}
              </span>
            </div>

            {/* File list — stands in for the FileTree (VS Code "changed files"). Clickable → preview. */}
            <div className="flex flex-col">
              <div className="px-1 pb-1 font-mono text-[11px] uppercase tracking-[0.08em]" style={{ color: EDITOR.textFaint }}>
                {result.files.length} files
              </div>
              {result.files.map((f) => {
                const st = f.surgicalMarkers > 0 ? fileFillStatus(f.content, undefined) : null;
                return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => onOpen(f.path)}
                    className="flex items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-[var(--ed-hover)]"
                  >
                    <FileIcon name={f.path} language={f.language} size={15} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" style={{ color: EDITOR.text }}>{f.path}</span>
                    {st && st.total > 0 ? (
                      <span className="shrink-0 font-mono text-[11px]" style={{ color: st.failed > 0 ? PROVENANCE.failed.color : st.pending > 0 ? EDITOR.pending : PROVENANCE.ai.color }}>
                        {st.done}/{st.total}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Next steps — local tools + code sync (reused verbatim) */}
            <SurgicalHandoff
              filled={fill.filled}
              total={fillDenom}
              violations={fill.violations}
              verified={fill.mode?.verified ?? false}
              withTests={fill.mode?.withTests ?? false}
              tscClean={fill.typecheck?.ok}
              onDownload={onDownload}
              zipping={zipping}
            />
          </div>
        )}
      </div>
    </div>
  );
}
