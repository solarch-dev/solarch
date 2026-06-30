/**
 * SolarchApiReference — the top-level orchestrator that assembles the Solarch-native API reference
 * (sidebar + content) into one self-contained surface.
 *
 * Reimplements, in React + Solarch tokens, the structure/behavior of Scalar's top-level shell
 * (studied from the real Vue source):
 *   - components/ApiReference.vue        — the two-area layout. Scalar uses one CSS grid with
 *                                          `grid-template-columns: auto 1fr` and
 *                                          `grid-template-areas: 'navigation rendered'` (sidebar +
 *                                          main content), a fixed `--refs-sidebar-width` of 288px,
 *                                          and a `@media (width < 1000px)` collapse to a single
 *                                          stacked column ('navigation' then 'rendered'). We mirror
 *                                          that exactly: a 288px sidebar column + a content column,
 *                                          collapsing to one column under a container breakpoint.
 *                                          (We use a container query rather than a viewport media
 *                                          query because this reference is an embedded panel, not a
 *                                          full page — the breakpoint must track the panel width.)
 *   - components/Content/Content.vue     — the rendered content region. Scalar declares it a named
 *                                          CSS container (`container-type: inline-size`) so the
 *                                          operation layout inside can collapse on its own width,
 *                                          independent of the viewport. We do the same so the
 *                                          nested `OperationView` grid responds to the content-pane
 *                                          width, not the whole panel.
 *
 * Difference from Scalar (deliberate adaptation): Scalar renders the entire document as one long
 * scrolling page with scroll-spy + lazy mounting + URL hash routing driven by its workspace store.
 * Our reference is PROPS-ONLY (portability rule — no store/router/query), so it is a master-detail:
 * the sidebar selects one operation (or one schema) and the content pane shows just that. This keeps
 * the file standalone-bundleable for Plan B and removes the need for Scalar's whole navigation/event
 * machinery while preserving the same two-area UX.
 *
 * We do NOT copy Scalar's CSS or visual identity. Surfaces/text/borders use Solarch design tokens
 * (var(--paper) / var(--paper-sunken) / var(--ink*) / hsl(var(--border)) / var(--accent)), JetBrains
 * Mono for the structural code text and Satoshi (sans) for prose, dark/light via the existing `.dark`
 * token flip. No gradients, no glassmorphism, no fully-rounded pills.
 *
 * Portable (props-only): the only imports are React + the pure `openapi.ts` helpers + the sibling
 * presentational components. No app store / router / react-query / `@/`-singletons, so Plan B can
 * bundle this file standalone for the generated app's `/docs`.
 */

import { useMemo, useState } from "react";
import type { NavOp, OpenApiDoc, Schema } from "./openapi";
import { buildNav, listSchemas } from "./openapi";
import { ApiSidebar, isModelId, modelNameFromId, modelNavId, OVERVIEW_ID } from "./ApiSidebar";
import { OperationView } from "./OperationView";
import { TryItConsole } from "./TryItConsole";
import { MethodBadge } from "./MethodBadge";
import type { SendFn } from "./transport";
import { SchemaTree } from "./SchemaTree";
import { Markdown } from "./Markdown";

export interface SolarchApiReferenceProps {
  /** The OpenAPI 3.1 document to render (structurally what the backend `projectOpenApi` emits). */
  doc: OpenApiDoc;
  /** "docs" = read-only reference (Docs surface); "client" = interactive Try-it console (API surface). */
  mode?: "docs" | "client";
  /** The base URL test requests / code samples target (e.g. http://localhost:3000). */
  serverUrl?: string;
  /** Optional transport seam, forwarded to the Try-it console in "client" mode (Plan 2 bridge). */
  onSend?: SendFn;
}

/* ── Scoped layout (mirrors ApiReference.vue's two-area grid + Content.vue's inline-size container) ─ */

const LAYOUT_STYLES = `
.solarch-api-ref-root {
  container-type: inline-size;
  height: 100%;
  min-height: 0;
}
.solarch-api-ref-grid {
  display: grid;
  grid-template-columns: 288px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}
.solarch-api-ref-content {
  container-type: inline-size;
}
@container (max-width: 760px) {
  .solarch-api-ref-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 38dvh) minmax(0, 1fr);
  }
}
`;

/* ── Schema (models) view — shown when the sidebar selects a `model:<name>` entry ───────────────── */

/** The detail view for one component schema: a header (name + description) over the recursive tree. */
function SchemaView({ doc, name, schema }: { doc: OpenApiDoc; name: string; schema: Schema }) {
  const description = typeof schema.description === "string" ? schema.description : undefined;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">Schema</span>
          <span className="break-all font-mono text-[16px] font-semibold text-[var(--ink)]">{name}</span>
        </div>
        {description && (
          <div className="mt-2">
            <Markdown>{description}</Markdown>
          </div>
        )}
      </div>
      <SchemaTree doc={doc} schema={schema} />
    </div>
  );
}

/** The Docs landing: the API title + the Markdown overview (info.description, from AI Documentize). */
function OverviewView({ doc }: { doc: OpenApiDoc }) {
  const info = doc.info ?? { title: "API", version: "" };
  const description = typeof info.description === "string" ? info.description : undefined;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-sans text-[22px] font-semibold leading-[1.3] text-[var(--ink)]">{info.title || "API"}</h1>
        {info.version && (
          <span className="mt-1 inline-block font-mono text-[11px] text-[var(--ink-faint)]">v{info.version}</span>
        )}
      </div>
      {description ? (
        <Markdown>{description}</Markdown>
      ) : (
        <p className="font-sans text-[13px] text-[var(--ink-faint)]">No overview yet — run AI Documentize to generate one.</p>
      )}
    </div>
  );
}

/* ── Empty state — no operations and no schemas at all ─────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="grid h-full place-items-center px-6">
      <p className="max-w-[420px] text-center font-mono text-[13px] leading-relaxed text-[var(--ink-faint)]">
        No endpoints yet — add a Controller with endpoints to the diagram and the API documentation
        shows up here.
      </p>
    </div>
  );
}

/* ── Client (API surface) views — interactive Try-it for one operation ─────────────────────────── */

/** The "API" (client) content for one operation: a compact header + the interactive Try-it console. */
function ClientOperation({ doc, op, serverUrl, onSend }: { doc: OpenApiDoc; op: NavOp; serverUrl: string; onSend?: SendFn }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <MethodBadge method={op.method} />
          <span className="break-all font-mono text-[14px] text-[var(--ink)]">{op.path}</span>
        </div>
        {op.summary && (
          <h2 className="mt-3 font-sans text-[19px] font-semibold leading-[1.4] text-[var(--ink)]">{op.summary}</h2>
        )}
      </div>
      <TryItConsole doc={doc} op={op} serverUrl={serverUrl} onSend={onSend} />
    </div>
  );
}

/** Client mode shows the test console; a schema is not a request target → nudge to pick an endpoint. */
function ClientSchemaHint() {
  return (
    <div className="grid h-full place-items-center px-6">
      <p className="max-w-[360px] text-center font-mono text-[13px] leading-relaxed text-[var(--ink-faint)]">
        Select an endpoint on the left to send a request.
      </p>
    </div>
  );
}

/* ── Orchestrator ───────────────────────────────────────────────────────────────────────────────── */

export function SolarchApiReference({ doc, mode = "docs", serverUrl = "", onSend }: SolarchApiReferenceProps) {
  // Nav model + a flat id -> operation map (the sidebar uses `method:path` ids from `buildNav`).
  const groups = useMemo(() => buildNav(doc), [doc]);
  const schemas = useMemo(() => listSchemas(doc), [doc]);
  const opById = useMemo(() => {
    const map = new Map<string, NavOp>();
    for (const group of groups) {
      for (const op of group.operations) {
        map.set(op.id, op);
      }
    }
    return map;
  }, [groups]);

  // Default selection: the first operation, else the first schema (matches Scalar's
  // `defaultOpenFirstTag` intent — land on something concrete rather than a blank pane).
  // Docs mode lands on the Overview when the API has one (mirrors Scalar's "Introduction" landing).
  const hasOverview = mode === "docs" && typeof doc.info?.description === "string" && doc.info.description.trim().length > 0;

  const defaultId = useMemo<string | null>(() => {
    if (hasOverview) {
      return OVERVIEW_ID;
    }
    const firstOp = groups[0]?.operations[0]?.id;
    if (firstOp) {
      return firstOp;
    }
    const firstSchema = schemas[0]?.name;
    return firstSchema ? modelNavId(firstSchema) : null;
  }, [hasOverview, groups, schemas]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Resolve the effective selection. A stale selection (doc changed under us, e.g. after AI
  // Documentize) silently falls back to the default rather than rendering a missing operation.
  const effectiveId = useMemo<string | null>(() => {
    if (selectedId) {
      if (selectedId === OVERVIEW_ID) {
        if (hasOverview) {
          return OVERVIEW_ID;
        }
      } else if (isModelId(selectedId)) {
        const name = modelNameFromId(selectedId);
        if (name && schemas.some((s) => s.name === name)) {
          return selectedId;
        }
      } else if (opById.has(selectedId)) {
        return selectedId;
      }
    }
    return defaultId;
  }, [selectedId, opById, schemas, defaultId, hasOverview]);

  // Branch the content pane on the effective selection.
  const selectedModelName = isModelId(effectiveId) ? modelNameFromId(effectiveId) : undefined;
  const selectedSchema = selectedModelName ? schemas.find((s) => s.name === selectedModelName) : undefined;
  const selectedOp = effectiveId && !isModelId(effectiveId) ? opById.get(effectiveId) : undefined;

  // Nothing to show at all — neither operations nor schemas.
  if (!defaultId) {
    return (
      <div className="solarch-api-ref-root bg-[var(--paper)]">
        <style>{LAYOUT_STYLES}</style>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="solarch-api-ref-root bg-[var(--paper)]">
      <style>{LAYOUT_STYLES}</style>

      <div className="solarch-api-ref-grid">
        <ApiSidebar doc={doc} selectedId={effectiveId} onSelect={setSelectedId} overview={hasOverview} />

        <div className="solarch-api-ref-content min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-[1100px] px-6 py-7">
            {effectiveId === OVERVIEW_ID ? (
              <OverviewView doc={doc} />
            ) : selectedOp ? (
              mode === "client" ? (
                <ClientOperation doc={doc} op={selectedOp} serverUrl={serverUrl} onSend={onSend} />
              ) : (
                <OperationView doc={doc} op={selectedOp} serverUrl={serverUrl} />
              )
            ) : selectedSchema ? (
              mode === "client" ? (
                <ClientSchemaHint />
              ) : (
                <SchemaView doc={doc} name={selectedSchema.name} schema={selectedSchema.schema} />
              )
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
