/** AddNodeMenu — right-click node-insert menu.
 *  Search (autofocus, by name/family/description), same node icons as the canvas
 *  (NODE_FA_ICON), family-colored icon chips, ↑/↓ + Enter keyboard navigation.
 *  Esc or outside click closes it.
 *  Bottom row: "Extend with AI…" — opens the inline AI-extend prompt
 *  (if search is non-empty the query is sent directly as the AI prompt). */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { useNodeTypes, type NodeTypeSummary } from "../../api/nodes";
import { colorOf, tintOf, familyOf } from "../../canvas/families";
import { NodeIcon } from "../../lib/node-icons";

const MENU_W = 280;

/** Highlights the search match within the name (first occurrence). */
function highlightMatch(id: string, q: string): React.ReactNode {
  const needle = q.trim().toLowerCase();
  if (!needle) return id;
  const i = id.toLowerCase().indexOf(needle);
  if (i === -1) return id;
  return (
    <>
      {id.slice(0, i)}
      <span className="font-semibold text-brand-600">{id.slice(i, i + needle.length)}</span>
      {id.slice(i + needle.length)}
    </>
  );
}

export function AddNodeMenu({ screen, onPick, onClose, onAskAi }: {
  screen: { x: number; y: number };
  onPick: (type: string) => void;
  onClose: () => void;
  /** "Extend with AI" row — null: open empty prompt, string: send this prompt directly. */
  onAskAi?: (initialPrompt: string | null) => void;
}) {
  const { data: types } = useNodeTypes();
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [onClose]);

  // Search: over name + family + description, simple substring.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = types ?? [];
    if (!q) return all;
    return all.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.familyLabel.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [types, query]);

  // Group by family (API order preserved); a flat list is kept in parallel for keyboard nav.
  const groups = useMemo(() => {
    const out: { label: string; items: NodeTypeSummary[] }[] = [];
    for (const t of filtered) {
      let g = out.find((x) => x.label === t.familyLabel);
      if (!g) { g = { label: t.familyLabel, items: [] }; out.push(g); }
      g.items.push(t);
    }
    return out;
  }, [filtered]);

  // Keep the active row in view.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const t = filtered[activeIdx];
      if (t) onPick(t.id);
      // No type matched but there is a query → Enter turns the query into an AI prompt.
      else if (onAskAi && query.trim()) onAskAi(query.trim());
    }
  };

  // Viewport bounds — prevent right/bottom overflow.
  const maxH = Math.min(window.innerHeight * 0.62, 600);
  const adjLeft = Math.min(screen.x, window.innerWidth - MENU_W - 8);
  const adjTop = Math.min(screen.y, window.innerHeight - maxH - 8);

  return (
    <div
      ref={ref}
      style={{ left: adjLeft, top: adjTop, width: MENU_W, maxHeight: maxH }}
      onKeyDown={onKeyDown}
      className="absolute z-[60] flex flex-col
                 bg-card/95 backdrop-blur-xl border border-border rounded-[10px]
                 shadow-float overflow-hidden
                 animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Search — autofocus: right-click and start typing immediately; brand underline on focus */}
      <div
        className="flex items-center gap-2 border-b border-border px-3 py-2.5
                   transition-colors duration-150 focus-within:border-brand-400/60"
      >
        <Search size={13} className="shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0); // filter changed → reset selection to top
          }}
          placeholder="Add node…"
          spellCheck={false}
          className="w-full bg-transparent font-sans text-[14.5px] text-foreground outline-none
                     placeholder:text-muted-foreground/70"
        />
        <kbd className="shrink-0 rounded border border-border bg-muted/40 px-1 font-mono text-[10.5px] text-muted-foreground">
          esc
        </kbd>
      </div>

      <div ref={listRef} className="overflow-y-auto py-1">
        {filtered.length === 0 && (
          <div className="px-3.5 py-4 text-center font-mono text-[12px] text-muted-foreground">
            // no node type matches "{query}"
          </div>
        )}
        {(() => {
          // Flat index running across groups — keyboard selection ignores group boundaries.
          let flat = -1;
          return groups.map((g) => (
            <div key={g.label}>
              <div className="sticky top-0 z-[1] flex items-center gap-1.5 bg-card/95 px-3.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground backdrop-blur-xl">
                <span
                  className="h-2.5 w-[2px] shrink-0 rounded-full"
                  style={{ background: colorOf(g.items[0].id) }}
                />
                {g.label}
                <span className="ml-auto tabular-nums opacity-60">{g.items.length}</span>
              </div>
              {g.items.map((t) => {
                flat += 1;
                const idx = flat;
                const active = idx === activeIdx;
                const color = colorOf(t.id);
                return (
                  <button
                    key={t.id}
                    data-idx={idx}
                    onClick={() => onPick(t.id)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className="group flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent
                               px-2 py-[3px] text-left"
                  >
                    <span
                      className="flex w-full flex-col rounded-md px-1.5 py-[5px] transition-colors duration-100"
                      style={active ? { background: tintOf(familyOf(t.id)) } : undefined}
                    >
                      <span className="flex w-full items-center gap-2.5">
                        {/* Family-colored icon chip — same icon as on the canvas */}
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border"
                          style={{
                            background: tintOf(familyOf(t.id)),
                            borderColor: active ? color + "55" : color + "2E",
                          }}
                        >
                          <NodeIcon type={t.id} size={11} color={color} />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-sans text-[14px] font-medium text-foreground">
                          {highlightMatch(t.id, query)}
                        </span>
                        {/* Enter hint on the active row */}
                        <kbd
                          className={
                            "shrink-0 rounded border border-border bg-card px-1 font-mono text-[10px] text-muted-foreground transition-opacity duration-100 " +
                            (active ? "opacity-100" : "opacity-0")
                          }
                        >
                          ↵
                        </kbd>
                      </span>
                      {/* Single-line description on the active row — "what it does" without waiting for a tooltip */}
                      {active && t.description && (
                        <span className="mt-0.5 truncate pl-[34px] font-sans text-[11.5px] leading-snug text-muted-foreground">
                          {t.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ));
        })()}
      </div>

      {/* Inline AI-extend entry — persistent row */}
      {onAskAi && (
        <button
          type="button"
          onClick={() => onAskAi(query.trim() ? query.trim() : null)}
          className="group flex w-full cursor-pointer items-start gap-2.5 border-t border-border
                     bg-transparent px-3.5 py-2 text-left transition-colors duration-100
                     hover:bg-[#10B981]/10"
        >
          <Sparkles size={12} className="mt-[3px] shrink-0 text-[#10B981]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-sans text-[13.5px] font-medium text-foreground">
              {query.trim() ? (
                <>
                  Ask AI: <span className="font-normal text-muted-foreground">“{query.trim()}”</span>
                </>
              ) : (
                "Extend with AI…"
              )}
            </span>
            <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
              describe it, AI builds it
            </span>
          </span>
          <kbd className="mt-[3px] shrink-0 rounded border border-border bg-card px-1 font-mono text-[10px] text-muted-foreground opacity-0 transition-opacity duration-100 group-hover:opacity-100">
            ✦
          </kbd>
        </button>
      )}

      {/* Bottom hint strip */}
      <div className="flex items-center gap-2 border-t border-border px-3.5 py-1.5 font-mono text-[10.5px] text-muted-foreground">
        <span>↑↓ navigate</span>
        <span className="opacity-40">·</span>
        <span>↵ add</span>
        <span className="ml-auto tabular-nums">{filtered.length} types</span>
      </div>
    </div>
  );
}
