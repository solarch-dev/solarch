/** DocsModal — Solarch docs / reference guide.
 *  Left sidebar: Node library (21), Edge library (16), Shortcuts.
 *  Right panel: selected item detail (description + usage + examples). */

import { useMemo, useState, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, BookOpen, GitBranch, Keyboard, Layers, Search } from "lucide-react";
import { Z_LAYERS } from "../lib/z-layers";
import { NODE_DOCS, EDGE_DOCS, SHORTCUT_DOCS } from "../lib/docs-content";
import { colorOf, familyOf } from "../canvas/families";
import { NodeIcon } from "../lib/node-icons";
import { cn } from "@/lib/utils";

export type DocsSection = "nodes" | "edges" | "shortcuts";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Which section to show on first open (default: nodes) */
  initialSection?: DocsSection;
  /** Optional initial item id (node type or edge kind) */
  initialItem?: string;
}

export function DocsModal({ open, onOpenChange, initialSection = "nodes", initialItem }: Props) {
  const [section, setSection] = useState<DocsSection>(initialSection);
  const [activeNode, setActiveNode] = useState<string>(NODE_DOCS[0]?.type ?? "");
  const [activeEdge, setActiveEdge] = useState<string>(EDGE_DOCS[0]?.kind ?? "");
  const [query, setQuery] = useState("");

  // Apply open arguments
  useEffect(() => {
    if (!open) return;
    setSection(initialSection);
    setQuery("");
    if (initialItem) {
      if (initialSection === "nodes") setActiveNode(initialItem);
      else if (initialSection === "edges") setActiveEdge(initialItem);
    }
  }, [open, initialSection, initialItem]);

  // Reset search on section change
  useEffect(() => { setQuery(""); }, [section]);

  // Filtering — lowercase, not accent-insensitive but sufficient for small sets
  const q = query.trim().toLowerCase();
  const matchNode = (n: (typeof NODE_DOCS)[number]) =>
    !q || n.type.toLowerCase().includes(q) || n.familyLabel.toLowerCase().includes(q);
  const matchEdge = (e: (typeof EDGE_DOCS)[number]) =>
    !q || e.kind.toLowerCase().includes(q) || e.category.toLowerCase().includes(q);
  const matchShortcut = (s: (typeof SHORTCUT_DOCS)[number]) =>
    !q || s.keys.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.group.toLowerCase().includes(q);

  // Group node list by familyLabel — after filter
  const nodeGroups = useMemo(() => {
    const map = new Map<string, typeof NODE_DOCS>();
    for (const n of NODE_DOCS) {
      if (!matchNode(n)) continue;
      const arr = map.get(n.familyLabel) ?? [];
      arr.push(n);
      map.set(n.familyLabel, arr);
    }
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Group edge list by category — after filter
  const edgeGroups = useMemo(() => {
    const map = new Map<string, typeof EDGE_DOCS>();
    for (const e of EDGE_DOCS) {
      if (!matchEdge(e)) continue;
      const arr = map.get(e.category) ?? [];
      arr.push(e);
      map.set(e.category, arr);
    }
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const shortcutGroups = useMemo(() => {
    const map = new Map<string, typeof SHORTCUT_DOCS>();
    for (const s of SHORTCUT_DOCS) {
      if (!matchShortcut(s)) continue;
      const arr = map.get(s.group) ?? [];
      arr.push(s);
      map.set(s.group, arr);
    }
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 bg-[rgba(11,16,32,0.55)] backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150"
          )}
          style={{ zIndex: Z_LAYERS.MODAL }}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "w-[min(1100px,94vw)] h-[88vh] max-h-[88vh]",
            "flex overflow-hidden rounded-xl border border-border",
            "bg-[color:var(--paper-raised)] shadow-[0_24px_80px_-20px_rgba(11,16,32,0.40)]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[state=open]:duration-200 data-[state=closed]:duration-150",
            "focus:outline-none"
          )}
          style={{ zIndex: Z_LAYERS.MODAL + 1 }}
        >
          <DialogPrimitive.Title className="sr-only">Solarch Docs</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Node, edge, and shortcut reference
          </DialogPrimitive.Description>

          {/* ── Sol sidebar ── */}
          <aside className="w-[300px] shrink-0 border-r border-[color:var(--hairline)] bg-[color:var(--paper)] flex flex-col overflow-hidden">
            {/* Header — Docs */}
            <div className="px-5 pt-5 pb-3 flex items-center gap-2.5 shrink-0">
              <BookOpen size={15} className="text-brand-500 shrink-0" />
              <span className="font-sans text-[14px] font-semibold tracking-tight text-[color:var(--ink)]">
                Docs
              </span>
            </div>

            {/* Section switcher — segmented, visual weight */}
            <div className="px-3 pb-3 shrink-0">
              <div className="flex flex-col gap-0.5">
                <SectionTab
                  active={section === "nodes"}
                  onClick={() => setSection("nodes")}
                  icon={<Layers size={14} />}
                  label="Node Library"
                  count={NODE_DOCS.length}
                />
                <SectionTab
                  active={section === "edges"}
                  onClick={() => setSection("edges")}
                  icon={<GitBranch size={14} />}
                  label="Edge Library"
                  count={EDGE_DOCS.length}
                />
                <SectionTab
                  active={section === "shortcuts"}
                  onClick={() => setSection("shortcuts")}
                  icon={<Keyboard size={14} />}
                  label="Shortcuts"
                  count={SHORTCUT_DOCS.length}
                />
              </div>
            </div>

            {/* Search input */}
            <div className="px-3 pb-3 shrink-0">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--ink-faint)] pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    section === "nodes" ? "Search node type…" :
                    section === "edges" ? "Search edge type…" : "Search shortcut…"
                  }
                  className="w-full h-9 pl-9 pr-3 text-[14px] rounded-md border border-[color:var(--hairline)] bg-[color:var(--paper-raised)] text-[color:var(--ink)] placeholder:text-[color:var(--ink-faint)] outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-colors"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded text-[color:var(--ink-faint)] hover:bg-[rgba(22,29,40,0.06)] hover:text-[color:var(--ink)]"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Item list */}
            <nav className="overflow-y-auto flex-1 px-2 pb-4 border-t border-[color:var(--hairline)] pt-2">
              {section === "nodes" && (
                nodeGroups.length === 0 ? (
                  <EmptyState query={query} />
                ) : nodeGroups.map(([fam, items]) => (
                  <div key={fam} className="mb-3">
                    <div className="px-3 pt-2 pb-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--ink-faint)] font-semibold">
                      {fam}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {items.map((n) => {
                        const accent = colorOf(n.type);
                        const isActive = activeNode === n.type;
                        return (
                          <NodeItemBtn
                            key={n.type}
                            active={isActive}
                            onClick={() => setActiveNode(n.type)}
                            accent={accent}
                            type={n.type}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))
              )}

              {section === "edges" && (
                edgeGroups.length === 0 ? (
                  <EmptyState query={query} />
                ) : edgeGroups.map(([cat, items]) => (
                  <div key={cat} className="mb-3">
                    <div className="px-3 pt-2 pb-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--ink-faint)] font-semibold">
                      {cat}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {items.map((e) => (
                        <EdgeItemBtn
                          key={e.kind}
                          active={activeEdge === e.kind}
                          onClick={() => setActiveEdge(e.kind)}
                          kind={e.kind}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}

              {section === "shortcuts" && (
                shortcutGroups.length === 0 ? (
                  <EmptyState query={query} />
                ) : shortcutGroups.map(([grp]) => (
                  <a
                    key={grp}
                    href={`#sg-${grp}`}
                    className="block px-3 py-2 text-[14.5px] text-[color:var(--ink-soft)] hover:text-[color:var(--ink)] hover:bg-[rgba(22,29,40,0.04)] rounded-md transition-colors"
                  >
                    {grp}
                  </a>
                ))
              )}
            </nav>
          </aside>

          {/* ── Right content ── */}
          <main className="flex-1 flex flex-col overflow-hidden bg-[color:var(--paper-raised)]">
            <header className="flex items-center justify-between px-10 py-5 border-b border-[color:var(--hairline)] shrink-0">
              <div className="font-sans text-[18px] font-semibold text-[color:var(--ink)] tracking-tight">
                {section === "nodes" ? "Node Library" :
                 section === "edges" ? "Edge Library" : "Keyboard Shortcuts"}
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
                title="Close (Esc)"
                className="w-9 h-9 inline-flex items-center justify-center rounded-md text-[color:var(--ink-soft)] hover:bg-[rgba(22,29,40,0.06)] hover:text-[color:var(--ink)] transition-colors"
              >
                <X size={17} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-10 py-8">
              {section === "nodes" && <NodeDetail type={activeNode} />}
              {section === "edges" && <EdgeDetail kind={activeEdge} />}
              {section === "shortcuts" && <ShortcutsList />}
            </div>
          </main>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SectionTab({ active, onClick, icon, label, count }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[14.5px] font-medium transition-all duration-150",
        active
          ? "bg-brand-500 text-black shadow-sm"
          : "text-[color:var(--ink-soft)] hover:text-[color:var(--ink)] hover:bg-[rgba(22,29,40,0.04)]"
      )}
    >
      <span className={cn("shrink-0", active ? "text-white" : "text-[color:var(--ink-faint)] group-hover:text-[color:var(--ink-soft)]")}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <span
        className={cn(
          "font-mono text-[12px] tabular-nums px-1.5 py-0.5 rounded",
          active
            ? "bg-white/20 text-white"
            : "bg-[rgba(22,29,40,0.05)] text-[color:var(--ink-faint)]"
        )}
      >
        {count}
      </span>
    </button>
  );
}

/** Node type item — family-tinted icon box + name + active accent strip. */
function NodeItemBtn({ active, onClick, accent, type }: {
  active: boolean; onClick: () => void; accent: string; type: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-md text-left transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/40",
        active
          ? "bg-[color:var(--paper-raised)] shadow-sm border border-[color:var(--hairline)]"
          : "border border-transparent hover:bg-[rgba(22,29,40,0.03)]"
      )}
    >
      {/* Left accent strip — active only */}
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm"
          style={{ background: accent }}
        />
      )}
      <span
        className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 border transition-colors"
        style={{
          background: `${accent}14`,
          borderColor: `${accent}33`,
        }}
      >
        <NodeIcon type={type} size={12} color={accent} />
      </span>
      <span
        className={cn(
          "text-[14px] truncate",
          active
            ? "text-[color:var(--ink)] font-semibold"
            : "text-[color:var(--ink-soft)] group-hover:text-[color:var(--ink)]"
        )}
      >
        {type}
      </span>
    </button>
  );
}

/** Edge kind item — mono badge + active strip. */
function EdgeItemBtn({ active, onClick, kind }: {
  active: boolean; onClick: () => void; kind: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-2.5 px-3 py-1.5 rounded-md text-left transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/40",
        active
          ? "bg-[color:var(--paper-raised)] shadow-sm border border-[color:var(--hairline)]"
          : "border border-transparent hover:bg-[rgba(22,29,40,0.03)]"
      )}
    >
      {active && (
        <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-brand-500" />
      )}
      <span
        className={cn(
          "font-mono text-[13.5px] truncate",
          active
            ? "text-[color:var(--ink)] font-bold"
            : "text-[color:var(--ink-soft)] group-hover:text-[color:var(--ink)]"
        )}
      >
        {kind}
      </span>
    </button>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="px-3 py-8 text-center">
      <div className="font-mono text-[13px] text-[color:var(--ink-faint)]">
        // No results for <span className="text-[color:var(--ink-soft)]">"{query}"</span>
      </div>
    </div>
  );
}

function NodeDetail({ type }: { type: string }) {
  const doc = NODE_DOCS.find((n) => n.type === type);
  if (!doc) return <div className="text-[15px] text-[color:var(--ink-faint)]">No node selected.</div>;
  const accent = colorOf(doc.type);

  return (
    <article className="max-w-[680px] flex flex-col gap-10">
      {/* Hero */}
      <header className="flex flex-col gap-5 pb-2">
        <div className="flex items-center gap-3.5">
          <div
            className="w-14 h-14 rounded-xl border flex items-center justify-center shrink-0"
            style={{
              background: `${accent}14`,
              borderColor: `${accent}33`,
            }}
          >
            <NodeIcon type={doc.type} size={26} color={accent} />
          </div>
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[12.5px] uppercase tracking-[0.14em] text-[color:var(--ink-faint)] font-medium">
              {doc.familyLabel} · {familyOf(doc.type)}
            </div>
            <h1 className="font-sans text-[33px] font-semibold text-[color:var(--ink)] leading-[1.1] tracking-tight">
              {doc.type}
            </h1>
          </div>
        </div>
      </header>

      <Section title="What it does">
        <p className="text-[16.5px] leading-[1.75] text-[color:var(--ink)]/85">{doc.summary}</p>
      </Section>

      <Section title="Where it's used in software">
        <ul className="flex flex-col gap-3 text-[16px] leading-[1.65] text-[color:var(--ink)]/85">
          {doc.whereUsed.map((w, i) => (
            <li key={i} className="flex gap-3.5">
              <span
                className="mt-[9px] w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: accent }}
              />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Examples">
        <div className="flex flex-col gap-2.5">
          {doc.examples.map((ex, i) => (
            <code
              key={i}
              className="font-mono text-[14.5px] leading-[1.6] px-4 py-3 rounded-lg bg-[rgba(22,29,40,0.04)] border border-[color:var(--hairline)] text-[color:var(--ink)]"
            >
              {ex}
            </code>
          ))}
        </div>
      </Section>

      <Section title="Typical connections">
        <ul className="flex flex-col gap-2 font-mono text-[14.5px] leading-[1.6] text-[color:var(--ink)]/80">
          {doc.commonEdges.map((e, i) => (
            <li
              key={i}
              className="px-4 py-2.5 rounded-lg bg-[rgba(22,29,40,0.025)] border border-[color:var(--hairline)]"
            >
              {e}
            </li>
          ))}
        </ul>
      </Section>
    </article>
  );
}

function EdgeDetail({ kind }: { kind: string }) {
  const doc = EDGE_DOCS.find((e) => e.kind === kind);
  if (!doc) return <div className="text-[15px] text-[color:var(--ink-faint)]">No edge selected.</div>;

  return (
    <article className="max-w-[680px] flex flex-col gap-10">
      <header className="flex flex-col gap-2 pb-2">
        <div className="font-mono text-[12.5px] uppercase tracking-[0.14em] text-[color:var(--ink-faint)] font-medium">
          {doc.category}
        </div>
        <h1 className="font-mono text-[33px] font-bold text-[color:var(--ink)] leading-[1.1] tracking-tight">
          {doc.kind}
        </h1>
      </header>

      <Section title="What it represents">
        <p className="text-[16.5px] leading-[1.75] text-[color:var(--ink)]/85">{doc.summary}</p>
      </Section>

      <Section title="When to use">
        <ul className="flex flex-col gap-3 text-[16px] leading-[1.65] text-[color:var(--ink)]/85">
          {doc.whenToUse.map((w, i) => (
            <li key={i} className="flex gap-3.5">
              <span className="mt-[9px] w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Examples">
        <div className="flex flex-col gap-2.5">
          {doc.examples.map((ex, i) => (
            <code
              key={i}
              className="font-mono text-[14.5px] leading-[1.6] px-4 py-3 rounded-lg bg-[rgba(22,29,40,0.04)] border border-[color:var(--hairline)] text-[color:var(--ink)]"
            >
              {ex}
            </code>
          ))}
        </div>
      </Section>
    </article>
  );
}

function ShortcutsList() {
  const groups = useMemo(() => {
    const map = new Map<string, typeof SHORTCUT_DOCS>();
    for (const s of SHORTCUT_DOCS) {
      const arr = map.get(s.group) ?? [];
      arr.push(s);
      map.set(s.group, arr);
    }
    return [...map.entries()];
  }, []);

  return (
    <div className="max-w-[680px] flex flex-col gap-10">
      {groups.map(([grp, items]) => (
        <section key={grp} id={`sg-${grp}`} className="flex flex-col gap-4">
          <h2 className="font-sans text-[21px] font-semibold text-[color:var(--ink)] tracking-tight leading-[1.2]">
            {grp}
          </h2>
          <div className="flex flex-col rounded-xl border border-[color:var(--hairline)] overflow-hidden divide-y divide-[color:var(--hairline)]">
            {items.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-5 px-5 py-3.5 hover:bg-[rgba(22,29,40,0.02)] transition-colors"
              >
                <kbd className="font-mono text-[13.5px] font-medium px-2.5 py-1.5 rounded-md bg-[rgba(22,29,40,0.05)] border border-[color:var(--hairline)] text-[color:var(--ink)] shrink-0 min-w-[130px] text-center">
                  {s.keys}
                </kbd>
                <span className="text-[16px] text-[color:var(--ink)]/85 leading-[1.55]">
                  {s.description}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-sans text-[21px] font-semibold text-[color:var(--ink)] tracking-tight leading-[1.2]">
        {title}
      </h2>
      {children}
    </section>
  );
}
