/** ApiDocsPanel — the "API" workspace surface (3rd ViewSwitch segment).
 *
 *  Renders the architecture graph as interactive OpenAPI documentation via the Solarch-native API
 *  reference (`SolarchApiReference`). The structure is deterministic/graph-true; "AI Documentize"
 *  re-runs a grounded enrichment that only adds prose + examples on EXISTING operations/schemas (it
 *  never invents paths). A "Server URL" field sets the test target so a request can be fired straight
 *  at a locally running app (default localhost:3000).
 *
 *  Body layer (not a modal): morphs open/closed OVER the canvas, scale+fade on `active` — same shell
 *  as CodegenPanel. This host owns the data layer only: it fetches `{doc}` via `useOpenApi`, runs
 *  `useDocumentize`, and holds the Server URL; it then hands a plain OpenAPI 3.1 object to
 *  `SolarchApiReference`, which is a portable, props-only React component (no Scalar, no app store). */

import { useCallback, useEffect } from "react";
import { BookOpen, Loader2, X } from "lucide-react";
import { useWorkspaceView } from "@/state/workspace-view";
import { Z_LAYERS } from "../../lib/z-layers";
import { cn } from "@/lib/utils";
import { useOpenApi, useDocumentize } from "../../api/openapi";
import { SolarchApiReference } from "./reference/SolarchApiReference";

export interface ApiDocsPanelProps {
  projectId: string;
  /** Whether the API view is active (view==="api"). Morph + the doc fetch lock onto this so we never
   *  fetch/render until the surface is opened. Close = store.setView("canvas"). */
  active: boolean;
}

export function ApiDocsPanel({ projectId, active }: ApiDocsPanelProps) {
  const setView = useWorkspaceView((s) => s.setView);
  const onClose = useCallback(() => setView("canvas"), [setView]);

  // Only fetch once the surface is open (mirror useSimpleView(canvasMode === "simple" ? id : undefined)).
  const openApi = useOpenApi(active ? projectId : undefined);
  const documentize = useDocumentize(projectId);

  const doc = openApi.data?.doc;
  const source = openApi.data?.source;
  const aiConfigured = openApi.data?.aiConfigured;
  const pathCount = doc ? Object.keys(doc.paths ?? {}).length : 0;

  // Esc closes the surface (matches CodegenPanel).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  const documenting = documentize.isPending;

  return (
    // BODY LAYER (not a modal) — morphs open/closed OVER the canvas.
    <div
      role="region"
      aria-label="API documentation"
      aria-hidden={!active}
      className={cn(
        "absolute inset-0 flex flex-col overflow-hidden bg-[color:var(--paper)]",
        "transition-[opacity,transform] duration-[360ms] [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        active ? "pointer-events-auto opacity-100 scale-100" : "pointer-events-none opacity-0 scale-[0.985]",
      )}
      style={{ zIndex: Z_LAYERS.MODAL }}
    >
      {/* Slim top strip — title + Server URL + AI Documentize + AI state + Close. */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[hsl(var(--border))] px-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[hsl(var(--muted))] text-[color:var(--ink-soft)]">
            <BookOpen size={14} />
          </span>
          <h2 className="font-sans text-[13px] font-semibold text-[color:var(--ink)]">Docs</h2>
          <span className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--ink-faint)]">
            openapi 3.1
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* AI Documentize — re-run the grounded enrichment (prose + examples on existing ops). */}
          <button
            type="button"
            onClick={() => documentize.mutate()}
            disabled={documenting || !doc || pathCount === 0}
            title={
              aiConfigured === false
                ? "AI is off (DEEPSEEK_API_KEY not set) — the doc is the plain deterministic structure"
                : "AI Documentize — add descriptions + examples to existing operations and schemas"
            }
            className="flex h-7 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[color:var(--paper)] px-2 font-sans text-[12px] text-[color:var(--ink-soft)] outline-none transition-colors hover:text-[color:var(--ink)] disabled:cursor-default disabled:opacity-60 cursor-pointer focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
          >
            {documenting && <Loader2 size={13} className="motion-safe:animate-spin" />}
            {documenting ? "Documenting…" : "AI Documentize"}
          </button>

          {/* AI state — honest, plain (no badge): is the AI on, and did it document this doc? */}
          {!documenting && aiConfigured !== undefined && (
            <span
              className="font-sans text-[11px] text-[color:var(--ink-faint)]"
              title={
                aiConfigured
                  ? source === "ai"
                    ? "AI added descriptions + examples"
                    : "AI is configured but this doc is the plain structure — AI Documentize to retry"
                  : "AI is off (DEEPSEEK_API_KEY not set) — showing the plain structure"
              }
            >
              {aiConfigured ? (source === "ai" ? "AI documented" : "AI: plain structure") : "AI off"}
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--ink-faint)] outline-none transition-colors hover:text-[color:var(--ink)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Body — the Solarch-native reference, or an honest loading state. The reference owns its own
          empty state (no operations + no schemas) and internal scrolling. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {openApi.isLoading && (
          <div className="grid h-full place-items-center">
            <p className="flex items-center gap-2 font-mono text-[13px] text-[color:var(--ink-faint)]">
              <Loader2 size={14} className="motion-safe:animate-spin" />
              preparing API docs…
            </p>
          </div>
        )}

        {!openApi.isLoading && doc && <SolarchApiReference doc={doc} mode="docs" />}
      </div>
    </div>
  );
}
