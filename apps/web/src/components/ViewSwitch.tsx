/** ViewSwitch — Canvas ↔ Code ↔ API ↔ Docs mode switch (TopBar's central signature).
 *
 *  Solarch's thesis: diagram → verified code → tested + documented API. The switch toggles the
 *  product's FOUR FACES. The signature move: when a face that HAS sub-modes is selected, that segment
 *  EXPANDS in place and shows its sub-modes as a miniature sliding-chip switch — a switch inside the
 *  switch. So sub-modes never live in separate chrome:
 *    - Canvas selected → Technical / Simple   (`useCanvasViewMode`)
 *    - Code   selected → Agent / Editor        (`useWorkspaceView.codeView`)
 *    - API / Docs       → no sub-modes (just a highlighted label)
 *  Inactive segments are labels; clicking one switches to that face (keeping its current sub-mode).
 *
 *  Calm, no-slop: real surface tones + soft shadow + a sliding chip, no gradient/glassmorphism. The
 *  inner sub-switch is keyboard-reachable (real buttons); the inactive segments are buttons too.
 *
 *  The Code segment calls onCodeRequested when selected (opens the codegen panel). */

import type { KeyboardEvent, ReactNode } from "react";
import { BookOpen, Braces, Code2, Eye, MessageSquare, Network } from "lucide-react";
import { useWorkspaceView } from "../state/workspace-view";
import { useCanvasViewMode } from "../state/canvas-view-mode";

type Surface = "canvas" | "code" | "api" | "docs";
const ORDER: Surface[] = ["canvas", "code", "api", "docs"];

/** Per-face glyph accent. */
const ACCENT: Record<Surface, string> = {
  canvas: "#ff6b1a", // design
  code: "#4ec9b0", // verified code
  api: "#569cd6", // API client
  docs: "#a78bfa", // documentation
};
const LABEL: Record<Surface, string> = { canvas: "Canvas", code: "Code", api: "API", docs: "Docs" };
function glyph(s: Surface, color: string): ReactNode {
  const p = { size: 13, style: { color } };
  if (s === "canvas") return <Network {...p} />;
  if (s === "code") return <Code2 {...p} />;
  if (s === "api") return <Braces {...p} />;
  return <BookOpen {...p} />;
}

interface SubItem {
  value: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onPick: () => void;
}

/** The inner sub-mode switch shown INSIDE an expanded active segment — a miniature of the outer
 *  switch: a recessed track + a sliding chip over two options. */
function InnerSwitch({ items, label, accent }: { items: SubItem[]; label: string; accent: string }) {
  const activeIndex = Math.max(0, items.findIndex((i) => i.active));
  return (
    <div
      role="group"
      aria-label={label}
      className="relative flex h-[22px] w-full items-center rounded-[6px] p-[2px]"
      style={{ background: "var(--paper-sunken, rgba(0,0,0,0.06))", boxShadow: "inset 0 1px 1.5px rgba(0,0,0,0.08)" }}
    >
      <span
        aria-hidden
        className="absolute left-[2px] top-[2px] bottom-[2px] w-[calc(50%-2px)] rounded-[4px] transition-transform duration-[240ms] [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
        style={{
          transform: activeIndex === 1 ? "translateX(100%)" : "translateX(0)",
          background: "var(--paper-raised, #ffffff)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.12), 0 0 0 1px hsl(var(--border))",
        }}
      />
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="radio"
          aria-checked={it.active}
          onClick={it.onPick}
          className="relative z-[1] flex h-full flex-1 items-center justify-center gap-1 rounded-[4px] font-sans text-[11.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          style={{ color: it.active ? "var(--ink)" : "var(--ink-faint)" }}
        >
          <span className="flex items-center" style={{ color: it.active ? accent : "var(--ink-faint)" }}>
            {it.icon}
          </span>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function ViewSwitch({ onCodeRequested, disabled }: { onCodeRequested: () => void; disabled?: boolean }) {
  const view = useWorkspaceView((s) => s.view);
  const setView = useWorkspaceView((s) => s.setView);
  const codeView = useWorkspaceView((s) => s.codeView);
  const setCodeView = useWorkspaceView((s) => s.setCodeView);
  const canvasMode = useCanvasViewMode((s) => s.mode);
  const setCanvasMode = useCanvasViewMode((s) => s.setMode);

  const select = (target: Surface) => {
    if (disabled) return;
    if (target === view) return;
    if (target === "code") onCodeRequested(); // gate lives in TopBar
    else setView(target);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const idx = ORDER.indexOf(view);
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      select(ORDER[Math.max(0, idx - 1)]);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      select(ORDER[Math.min(ORDER.length - 1, idx + 1)]);
    } else if (e.key === "Home") {
      e.preventDefault();
      select("canvas");
    } else if (e.key === "End") {
      e.preventDefault();
      select("docs");
    }
  };

  // The sub-modes a face exposes (null = no sub-modes). Selecting a sub-mode only sets the sub-mode —
  // the face is already active, so there is nothing to switch.
  const subOf = (s: Surface): SubItem[] | null => {
    if (s === "canvas")
      return [
        { value: "technical", label: "Technical", icon: <Network size={12} />, active: canvasMode === "technical", onPick: () => setCanvasMode("technical") },
        { value: "simple", label: "Simple", icon: <Eye size={12} />, active: canvasMode === "simple", onPick: () => setCanvasMode("simple") },
      ];
    if (s === "code")
      return [
        { value: "agent", label: "Agent", icon: <MessageSquare size={12} />, active: codeView === "agent", onPick: () => setCodeView("agent") },
        { value: "editor", label: "Editor", icon: <Code2 size={12} />, active: codeView === "editor", onPick: () => setCodeView("editor") },
      ];
    return null;
  };

  return (
    <div
      role="group"
      aria-label="Workspace view"
      onKeyDown={onKeyDown}
      className="relative inline-flex h-8 select-none items-center gap-[2px] rounded-lg p-[3px]"
      style={{
        background: "var(--paper-sunken, rgba(0,0,0,0.05))",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)",
        border: "1px solid hsl(var(--border))",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {ORDER.map((s) => {
        const active = view === s;
        const sub = subOf(s);
        const accent = ACCENT[s];
        return (
          <div
            key={s}
            className="relative h-full overflow-hidden transition-[width] duration-[300ms] [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]"
            style={{ width: active && sub ? 168 : 86 }}
          >
            {active ? (
              <div
                className="flex h-full w-full items-center rounded-md px-[3px]"
                style={{ background: "var(--paper-raised, #ffffff)", boxShadow: "0 1px 2px rgba(0,0,0,0.10), 0 0 0 1px hsl(var(--border))" }}
              >
                {sub ? (
                  <InnerSwitch items={sub} label={`${LABEL[s]} sub-mode`} accent={accent} />
                ) : (
                  <span className="flex w-full items-center justify-center gap-1.5 font-sans text-[13.5px] font-medium text-[var(--ink)]">
                    {glyph(s, accent)}
                    {LABEL[s]}
                  </span>
                )}
              </div>
            ) : (
              <button
                type="button"
                aria-pressed={false}
                aria-label={`${LABEL[s]} view`}
                tabIndex={0}
                onClick={() => select(s)}
                className="flex h-full w-full items-center justify-center gap-1.5 rounded-md font-sans text-[13.5px] font-medium text-[var(--ink-soft)] outline-none transition-colors hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {glyph(s, "var(--ink-faint)")}
                {LABEL[s]}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
