/**
 * ApiSidebar — the navigation rail for the Solarch-native API reference.
 *
 * Reimplements, in React + Solarch tokens, the structure/behavior of Scalar's sidebar (studied from
 * the real Vue source):
 *   - packages/components/.../ScalarSidebar/ScalarSidebar.vue          — the rail shell: a flex column
 *                                                                        with a right border and a
 *                                                                        dedicated sidebar surface
 *                                                                        (`bg-sidebar-b-1`, `w-72`).
 *                                                                        We use `var(--paper-sunken)`
 *                                                                        + `hsl(var(--border))` at the
 *                                                                        same 288px width.
 *   - .../ScalarSidebar/ScalarSidebarGroup.vue + ScalarSidebarGroupToggle.vue — a collapsible group:
 *                                                                        a toggle button whose caret
 *                                                                        rotates 90deg when open, and a
 *                                                                        `<ul>` of child items rendered
 *                                                                        only while open. We mirror the
 *                                                                        caret + aria-expanded + the
 *                                                                        open/closed list rendering.
 *   - .../ScalarSidebar/ScalarSidebarButton.vue                        — the row variants: idle text is
 *                                                                        muted (`sidebar-c-2`), the
 *                                                                        selected row gets an active
 *                                                                        background + active text
 *                                                                        (`bg-sidebar-b-active`), and
 *                                                                        hover tints the background. We
 *                                                                        map that to `var(--ink-soft)`
 *                                                                        idle, an accent-washed active
 *                                                                        row with a left accent bar,
 *                                                                        and a paper-raised hover.
 *   - .../ScalarSidebar/ScalarSidebarSection.vue                       — a titled section (a bold,
 *                                                                        non-interactive heading above a
 *                                                                        list of items). We use it for
 *                                                                        the "Schemas" models section.
 *   - .../ScalarSidebar/ScalarSidebarSearchInput.vue                   — an inline search field: a
 *                                                                        magnifying-glass icon, a text
 *                                                                        input, and a clear (X) button
 *                                                                        that appears once there is a
 *                                                                        query and returns focus to the
 *                                                                        input. We replicate that
 *                                                                        behavior with inline SVGs.
 *   - packages/api-reference/.../OperationsList/OperationsListItem.vue — the operation row: a method
 *                                                                        badge in a fixed-width gutter
 *                                                                        next to the (mono) path, with a
 *                                                                        line-through for deprecated
 *                                                                        operations. We render
 *                                                                        `MethodBadge` + the path and
 *                                                                        strike deprecated rows.
 *
 * We do NOT copy Scalar's CSS or visual identity. Surfaces/text/borders use Solarch design tokens
 * (var(--paper-sunken) / var(--paper-raised) / var(--ink*) / hsl(var(--border)) / var(--accent) +
 * var(--accent-wash)), JetBrains Mono for the method/path/model names and Satoshi (sans) for the
 * group/section labels. No gradients, no glassmorphism, no fully-rounded pills.
 *
 * Portable (props-only): the only imports are React + the pure `openapi.ts` helpers + the sibling
 * `MethodBadge`. No app store / router / react-query / `@/`-singletons, so Plan B can bundle this file
 * standalone for the generated app's `/docs`.
 */

import { useMemo, useRef, useState } from "react";
import type { NavGroup, NavOp, OpenApiDoc, Schema } from "./openapi";
import { buildNav, listSchemas } from "./openapi";
import { MethodBadge } from "./MethodBadge";

/* ── Nav-id helpers (the model-id contract the orchestrator in Task 7 parses) ──────────────────── */

/** Prefix marking a "schemas/models" selection. Operation ids are `method:path` (from `buildNav`). */
export const MODEL_ID_PREFIX = "model:";

/** Build the sidebar/selection id for a component schema, e.g. `model:User`. */
export function modelNavId(name: string): string {
  return `${MODEL_ID_PREFIX}${name}`;
}

/** Whether a selection id points at a component schema rather than an operation. */
export function isModelId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(MODEL_ID_PREFIX);
}

/** Extract the model name from a `model:<name>` id (or undefined if it is not a model id). */
export function modelNameFromId(id: string | null | undefined): string | undefined {
  return isModelId(id) ? (id as string).slice(MODEL_ID_PREFIX.length) : undefined;
}

/** Reserved selection id for the API overview (info.description) landing — shown only in docs mode. */
export const OVERVIEW_ID = "overview";

export interface ApiSidebarProps {
  doc: OpenApiDoc;
  /** The active selection: an operation id (`method:path`), a model id (`model:<name>`), or the overview. */
  selectedId: string | null;
  /** Called with the new selection id when a row is activated. */
  onSelect: (id: string) => void;
  /** Show an "Overview" row at the top (docs mode, when the API has an overview description). */
  overview?: boolean;
}

/* ── Inline icons (no icon-lib import — keeps the file portable, matching SchemaTree/OperationView) ─ */

function CaretIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden
      className="shrink-0 text-[var(--ink-faint)]"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }}
    >
      <path
        d="M3 1.5 L7 5 L3 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-[var(--ink-faint)]">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5 L14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M4 4 L12 12 M12 4 L4 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A small brace glyph that fronts model rows (the "schema" affordance, no icon-lib). */
function BraceGlyph() {
  return (
    <span className="select-none font-mono text-[12px] leading-none text-[var(--ink-faint)]" aria-hidden>
      {"{ }"}
    </span>
  );
}

/* ── Search ───────────────────────────────────────────────────────────────────────────────────── */

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <label
      className={[
        "flex h-8 items-center gap-2 rounded-[6px] border px-2",
        "border-[hsl(var(--border))] bg-[var(--paper-raised)]",
        "focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)]",
      ].join(" ")}
    >
      <SearchIcon />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search operations and schemas"
        aria-label="Search the API reference"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="min-w-0 flex-1 appearance-none border-none bg-transparent font-sans text-[12.5px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[var(--ink-faint)] outline-none transition-colors hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <ClearIcon />
        </button>
      )}
    </label>
  );
}

/* ── Rows ─────────────────────────────────────────────────────────────────────────────────────── */

/** A single operation row: method badge in a fixed gutter + the (mono) path, with active styling. */
function OperationRow({ op, active, onSelect }: { op: NavOp; active: boolean; onSelect: (id: string) => void }) {
  const deprecated = op.operation.deprecated === true;
  return (
    <li className="flex">
      <button
        type="button"
        onClick={() => onSelect(op.id)}
        aria-current={active ? "page" : undefined}
        title={`${op.method.toUpperCase()} ${op.path}`}
        className={[
          "group flex w-full items-center gap-2 rounded-[5px] border-l-2 py-1 pl-2 pr-2 text-left outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
          active
            ? "border-[var(--accent)] bg-[var(--accent-wash)]"
            : "border-transparent hover:bg-[var(--paper-raised)]",
        ].join(" ")}
      >
        <span className="flex w-[42px] shrink-0 justify-end">
          <MethodBadge method={op.method} size="sm" />
        </span>
        <span
          className={[
            "min-w-0 flex-1 truncate font-mono text-[12px] leading-[1.5]",
            deprecated ? "text-[var(--ink-faint)] line-through" : active ? "text-[var(--ink)]" : "text-[var(--ink-soft)]",
          ].join(" ")}
        >
          {op.path}
        </span>
      </button>
    </li>
  );
}

/** A single model/schema row: a brace glyph + the (mono) model name, with active styling. */
function ModelRow({ name, active, onSelect }: { name: string; active: boolean; onSelect: (id: string) => void }) {
  return (
    <li className="flex">
      <button
        type="button"
        onClick={() => onSelect(modelNavId(name))}
        aria-current={active ? "page" : undefined}
        title={name}
        className={[
          "group flex w-full items-center gap-2 rounded-[5px] border-l-2 py-1 pl-2 pr-2 text-left outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
          active
            ? "border-[var(--accent)] bg-[var(--accent-wash)]"
            : "border-transparent hover:bg-[var(--paper-raised)]",
        ].join(" ")}
      >
        <span className="flex w-[18px] shrink-0 justify-center">
          <BraceGlyph />
        </span>
        <span
          className={[
            "min-w-0 flex-1 truncate font-mono text-[12.5px] leading-[1.5]",
            active ? "text-[var(--ink)]" : "text-[var(--ink-soft)]",
          ].join(" ")}
        >
          {name}
        </span>
      </button>
    </li>
  );
}

/* ── Tag group (collapsible) ──────────────────────────────────────────────────────────────────── */

function TagGroup({
  group,
  open,
  selectedId,
  onToggle,
  onSelect,
}: {
  group: NavGroup;
  open: boolean;
  selectedId: string | null;
  onToggle: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-[5px] py-1.5 pl-1 pr-2 text-left outline-none transition-colors hover:bg-[var(--paper-raised)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <CaretIcon open={open} />
        <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] font-semibold text-[var(--ink)]">
          {group.tag}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--ink-faint)]">
          {group.operations.length}
        </span>
      </button>
      {open && (
        <ul className="mt-px flex flex-col gap-px pl-1">
          {group.operations.map((op) => (
            <OperationRow key={op.id} op={op} active={selectedId === op.id} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

/* ── Filtering (mirrors Scalar's search: match operations + schemas; keep matching subtree) ──────── */

function matchOperation(op: NavOp, q: string): boolean {
  if (op.path.toLowerCase().includes(q)) {
    return true;
  }
  if (op.method.toLowerCase().includes(q)) {
    return true;
  }
  if (typeof op.summary === "string" && op.summary.toLowerCase().includes(q)) {
    return true;
  }
  const operationId = op.operation.operationId;
  return typeof operationId === "string" && operationId.toLowerCase().includes(q);
}

function filterGroups(groups: NavGroup[], q: string): NavGroup[] {
  if (!q) {
    return groups;
  }
  const out: NavGroup[] = [];
  for (const group of groups) {
    // A tag-name match keeps the whole group; otherwise keep only matching operations.
    if (group.tag.toLowerCase().includes(q)) {
      out.push(group);
      continue;
    }
    const operations = group.operations.filter((op) => matchOperation(op, q));
    if (operations.length > 0) {
      out.push({ ...group, operations });
    }
  }
  return out;
}

/* ── Sidebar ──────────────────────────────────────────────────────────────────────────────────── */

export function ApiSidebar({ doc, selectedId, onSelect, overview = false }: ApiSidebarProps) {
  const [query, setQuery] = useState("");
  // Tags collapsed by an explicit user click. Default state is open (operations visible); a search
  // overrides this so every match is reachable without re-expanding by hand.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const groups = useMemo(() => buildNav(doc), [doc]);
  const schemas = useMemo(() => listSchemas(doc) as { name: string; schema: Schema }[], [doc]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const visibleGroups = useMemo(() => filterGroups(groups, q), [groups, q]);
  const visibleSchemas = useMemo(
    () => (q ? schemas.filter((s) => s.name.toLowerCase().includes(q)) : schemas),
    [schemas, q],
  );

  const toggleTag = (tag: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const hasResults = visibleGroups.length > 0 || visibleSchemas.length > 0;

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[hsl(var(--border))] bg-[var(--paper-sunken)]">
      <div className="shrink-0 border-b border-[hsl(var(--border))] p-3">
        <SearchInput value={query} onChange={setQuery} />
      </div>

      <nav aria-label="API reference navigation" className="min-h-0 flex-1 overflow-y-auto p-2">
        {overview && !searching && (
          <button
            type="button"
            onClick={() => onSelect(OVERVIEW_ID)}
            aria-current={selectedId === OVERVIEW_ID ? "page" : undefined}
            className={[
              "mb-1 flex w-full items-center gap-2 rounded-[5px] border-l-2 py-1.5 pl-2 pr-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              selectedId === OVERVIEW_ID
                ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--ink)]"
                : "border-transparent text-[var(--ink-soft)] hover:bg-[var(--paper-raised)]",
            ].join(" ")}
          >
            <span className="font-sans text-[12.5px] font-semibold">Overview</span>
          </button>
        )}

        {!hasResults && (
          <p className="px-2 py-6 text-center font-sans text-[12.5px] text-[var(--ink-faint)]">
            {searching ? "No matching operations or schemas." : "No endpoints yet."}
          </p>
        )}

        {visibleGroups.length > 0 && (
          <ul className="flex flex-col gap-px">
            {visibleGroups.map((group) => (
              <TagGroup
                key={group.tag}
                group={group}
                open={searching ? true : !collapsed.has(group.tag)}
                selectedId={selectedId}
                onToggle={() => toggleTag(group.tag)}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}

        {visibleSchemas.length > 0 && (
          <section className="mt-4">
            <h2 className="px-2 pb-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-faint)]">
              Schemas
            </h2>
            <ul className="flex flex-col gap-px pl-1">
              {visibleSchemas.map((s) => (
                <ModelRow
                  key={s.name}
                  name={s.name}
                  active={selectedId === modelNavId(s.name)}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </section>
        )}
      </nav>
    </aside>
  );
}
