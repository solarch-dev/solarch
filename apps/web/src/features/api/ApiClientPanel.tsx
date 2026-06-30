/** ApiClientPanel — the "API" workspace surface (interactive test client).
 *
 *  The Postman-style counterpart to the read-only Docs surface: pick an endpoint on the left, fill
 *  its path/query params + JSON body, and fire a real request at a running instance. It renders the
 *  same Solarch-native reference in `client` mode (sidebar + Try-it console, no read-only schema
 *  prose). A "Server URL" field sets the target (default localhost:3000); the request goes
 *  browser-direct (Plan 1) — Plan 2's VS Code bridge will plug into the reference's `onSend` seam so
 *  the request can be proxied through the locally-deployed app instead.
 *
 *  Body layer (not a modal): morphs open/closed OVER the canvas, scale+fade on `active` — same shell
 *  as CodegenPanel / the Docs surface. Host owns the data layer only: it fetches `{doc}` via
 *  `useOpenApi` and holds the Server URL, then hands a plain OpenAPI 3.1 object to the portable,
 *  props-only `SolarchApiReference`. */

import { useCallback, useEffect, useState } from "react";
import { Braces, Loader2, X } from "lucide-react";
import { useWorkspaceView } from "@/state/workspace-view";
import { Z_LAYERS } from "../../lib/z-layers";
import { cn } from "@/lib/utils";
import { useOpenApi } from "../../api/openapi";
import { SolarchApiReference } from "./reference/SolarchApiReference";

export interface ApiClientPanelProps {
  projectId: string;
  /** Whether the API view is active (view==="api"). The morph + the doc fetch lock onto this so we
   *  never fetch/render until the surface is opened. Close = store.setView("canvas"). */
  active: boolean;
}

export function ApiClientPanel({ projectId, active }: ApiClientPanelProps) {
  const setView = useWorkspaceView((s) => s.setView);
  const onClose = useCallback(() => setView("canvas"), [setView]);

  // Only fetch once the surface is open (mirror the Docs surface / useSimpleView pattern).
  const openApi = useOpenApi(active ? projectId : undefined);
  const doc = openApi.data?.doc;

  // The localhost target a test request is fired at; also used to build the request preview URL.
  const [serverUrl, setServerUrl] = useState("http://localhost:3000");

  // Esc closes the surface (matches CodegenPanel / Docs).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  return (
    // BODY LAYER (not a modal) — morphs open/closed OVER the canvas.
    <div
      role="region"
      aria-label="API test client"
      aria-hidden={!active}
      className={cn(
        "absolute inset-0 flex flex-col overflow-hidden bg-[color:var(--paper)]",
        "transition-[opacity,transform] duration-[360ms] [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        active ? "pointer-events-auto opacity-100 scale-100" : "pointer-events-none opacity-0 scale-[0.985]",
      )}
      style={{ zIndex: Z_LAYERS.MODAL }}
    >
      {/* Slim top strip — title + Server URL + Close. */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[hsl(var(--border))] px-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[hsl(var(--muted))] text-[color:var(--ink-soft)]">
            <Braces size={14} />
          </span>
          <h2 className="font-sans text-[13px] font-semibold text-[color:var(--ink)]">API</h2>
          <span className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--ink-faint)]">
            test client
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Localhost test target — forwarded to the reference as `serverUrl`. */}
          <label className="flex items-center gap-1.5">
            <span className="font-sans text-[11px] text-[color:var(--ink-faint)]">Server URL</span>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              spellCheck={false}
              placeholder="http://localhost:3000"
              aria-label="Server URL — the target for sending test requests"
              className="h-7 w-[200px] rounded-md border border-[hsl(var(--border))] bg-[color:var(--paper)] px-2 font-mono text-[12px] text-[color:var(--ink)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
            />
          </label>

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

      {/* Body — the Solarch-native reference in client mode (sidebar + Try-it console). */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {openApi.isLoading && (
          <div className="grid h-full place-items-center">
            <p className="flex items-center gap-2 font-mono text-[13px] text-[color:var(--ink-faint)]">
              <Loader2 size={14} className="motion-safe:animate-spin" />
              preparing API client…
            </p>
          </div>
        )}

        {!openApi.isLoading && doc && <SolarchApiReference doc={doc} mode="client" serverUrl={serverUrl} />}
      </div>
    </div>
  );
}
