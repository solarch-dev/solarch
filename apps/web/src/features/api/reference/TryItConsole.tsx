/**
 * TryItConsole — an inline "send a real request" console for one operation.
 *
 * Reimplements, in React + Solarch tokens, the request build/send + response handling that Scalar
 * splits across its API-client package (studied from the real source):
 *   - features/test-request-button/TestRequestButton.vue — the entry point. Scalar's button only
 *     emits `ui:open:client-modal` to hand off to a separate API-client surface; we keep the console
 *     inline (no modal, no event bus) so the reference stays a single self-contained, portable tree.
 *   - v2/blocks/operation-block/helpers/har-to-fetch-request.ts — `harToFetchRequest` turns a request
 *     description into a `[url, RequestInit]` tuple: method + reconstructed Headers + a body built
 *     from postData (FormData / URLSearchParams / encoded text). We build the same `{ method, url,
 *     headers, body }` shape, scoped to `application/json` (what `projectOpenApi` emits), with path
 *     params substituted into the URL and query params appended.
 *   - v2/blocks/operation-block/helpers/send-request.ts — `sendRequest` measures duration with
 *     `performance.now()` around the fetch, then normalizes the response into headers-as-object +
 *     status + statusText + duration + decoded body, and on failure returns a normalized error
 *     (`[normalizeError(error, ERRORS.REQUEST_FAILED), null]`). We mirror that exactly in
 *     `runFetch` (timing, header object, text body, JSON pretty-print) and surface a single honest
 *     error string on network/CORS failure instead of throwing.
 *
 * We do NOT copy Scalar's CSS, event bus, plugin pipeline, cookie/proxy handling, or streaming
 * reader path — those belong to its full client. Surfaces/text/borders use Solarch design tokens
 * and the method chip is the shared `MethodBadge`.
 *
 * Transport seam: when `onSend` is provided the console calls it instead of `fetch`. This is the
 * exact point Plan 2's VS Code bridge plugs into (route the request through the extension host so it
 * is not bound by browser CORS). With no `onSend`, it uses the browser `fetch`.
 *
 * Portable (props-only): the only imports are React, the pure `openapi.ts` helpers, the sibling
 * `MethodBadge`, and the type-only seam from `OperationView` (erased at build under
 * `verbatimModuleSyntax`, so there is no runtime import cycle). No app store / router / react-query /
 * `@/`-singletons — Plan B can bundle this file standalone for the generated app's `/docs`.
 */

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { NavOp, OpenApiDoc, ParameterObject } from "./openapi";
import { exampleFromSchema } from "./openapi";
import { MethodBadge } from "./MethodBadge";
import type { ApiRequest, ApiResponse, SendFn } from "./transport";

export interface TryItConsoleProps {
  doc: OpenApiDoc;
  /** The operation to send (id/method/path/operation), from `buildNav`. */
  op: NavOp;
  /** Base URL the request targets (e.g. http://localhost:3000). May be empty. */
  serverUrl?: string;
  /** Transport seam: when set, the console calls this instead of `fetch` (Plan 2 bridge). */
  onSend?: SendFn;
}

/** Methods that may carry a request body (mirrors Scalar's `canMethodHaveBody`). */
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/* ── Small self-contained UI atoms (kept local for portability) ────────────────────────────────── */

function CaretIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden
      className="shrink-0 text-[var(--ink-faint)]"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms ease" }}
    >
      <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard may be unavailable (insecure context) — fail quietly rather than throwing.
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Copied" : "Copy"}
      title={copied ? "Copied" : "Copy"}
      className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--ink-faint)] outline-none transition-colors hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden className="text-[var(--ok)]">
          <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M10.5 5.5 V4 a1.5 1.5 0 0 0 -1.5 -1.5 H4 A1.5 1.5 0 0 0 2.5 4 v5 A1.5 1.5 0 0 0 4 10.5 h1.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/** A faint mono eyebrow label for input groups. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">{children}</div>
  );
}

/** Status chip for the response, colored by class: 2xx ok / 4xx warn / 5xx danger / other neutral. */
function ResponseStatus({ status, statusText }: { status: number; statusText?: string }) {
  let tone = "bg-[color:var(--paper-sunken)] border-[color:hsl(var(--border))] text-[color:var(--ink-soft)]";
  if (status >= 200 && status < 300) {
    tone = "bg-[color:var(--ok-wash)] border-[color:var(--ok-border)] text-[color:var(--ok)]";
  } else if (status >= 400 && status < 500) {
    tone = "bg-[color:var(--warn-wash)] border-[color:var(--warn-border)] text-[color:var(--warn)]";
  } else if (status >= 500) {
    tone = "bg-[color:var(--danger-wash)] border-[color:var(--danger-border)] text-[color:var(--danger)]";
  }
  return (
    <span className={["inline-flex h-[20px] items-center gap-1.5 rounded-[4px] border px-1.5 font-mono text-[11px] font-semibold leading-none", tone].join(" ")}>
      <span>{status}</span>
      {statusText ? <span className="font-normal opacity-80">{statusText}</span> : null}
    </span>
  );
}

/* ── Helpers (scoped to what the emitter produces) ─────────────────────────────────────────────── */

/** The initial string value for a path/query input — a scalar example from the param schema. */
function initialParamValue(doc: OpenApiDoc, param: ParameterObject): string {
  const value = exampleFromSchema(doc, param.schema ?? {});
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** The request body's media entry (preferring `application/json`) and a pretty-printed example. */
function requestBodyDraft(doc: OpenApiDoc, op: NavOp): { contentType: string; example: string } | undefined {
  const content = op.operation.requestBody?.content;
  if (!content) {
    return undefined;
  }
  const keys = Object.keys(content);
  if (keys.length === 0) {
    return undefined;
  }
  const contentType = keys.includes("application/json") ? "application/json" : keys[0];
  const media = content[contentType] ?? {};
  let value: unknown = media.example;
  if (value === undefined && media.examples && typeof media.examples === "object") {
    const first = Object.values(media.examples)[0];
    value = first && typeof first === "object" && "value" in (first as Record<string, unknown>) ? (first as { value: unknown }).value : first;
  }
  if (value === undefined && media.schema !== undefined) {
    value = exampleFromSchema(doc, media.schema);
  }
  const example = value === undefined ? "" : JSON.stringify(value, null, 2);
  return { contentType, example };
}

/** Pretty-print a JSON response body; leave non-JSON text untouched. */
function prettyBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return body;
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return body;
  }
}

/** Run the request through the browser `fetch`, normalized to `ApiResponse` (mirrors `sendRequest`). */
async function runFetch(req: ApiRequest): Promise<ApiResponse> {
  const start = performance.now();
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });
  const durationMs = Math.round(performance.now() - start);
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = await res.text();
  return { status: res.status, statusText: res.statusText, durationMs, headers, body };
}

/* ── Console ───────────────────────────────────────────────────────────────────────────────────── */

export function TryItConsole({ doc, op, serverUrl = "", onSend }: TryItConsoleProps) {
  const method = op.method.toUpperCase();
  const params = op.operation.parameters ?? [];
  const pathParams = useMemo(() => params.filter((p) => p.in === "path"), [params]);
  const queryParams = useMemo(() => params.filter((p) => p.in === "query"), [params]);
  const bodyDraft = useMemo(() => (BODY_METHODS.has(method) ? requestBodyDraft(doc, op) : undefined), [doc, op, method]);

  const [pathValues, setPathValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(pathParams.map((p) => [p.name, initialParamValue(doc, p)])),
  );
  const [queryValues, setQueryValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(queryParams.map((p) => [p.name, ""])),
  );
  const [bodyText, setBodyText] = useState<string>(() => bodyDraft?.example ?? "");

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showHeaders, setShowHeaders] = useState(false);

  // The concrete URL the request targets: substitute `{path}` params, append non-empty query params.
  const previewUrl = useMemo(() => {
    const base = serverUrl.replace(/\/+$/, "");
    let path = op.path;
    for (const p of pathParams) {
      path = path.replace(`{${p.name}}`, encodeURIComponent(pathValues[p.name] ?? ""));
    }
    const query = queryParams
      .filter((p) => (queryValues[p.name] ?? "").trim() !== "")
      .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(queryValues[p.name] ?? "")}`)
      .join("&");
    return `${base}${path}${query ? `?${query}` : ""}`;
  }, [serverUrl, op.path, pathParams, queryParams, pathValues, queryValues]);

  const send = async () => {
    setLoading(true);
    setErrorMessage(null);
    setResponse(null);

    const includeBody = bodyDraft !== undefined && bodyText.trim() !== "";
    const headers: Record<string, string> = {};
    if (includeBody) {
      headers["Content-Type"] = bodyDraft?.contentType ?? "application/json";
    }
    const request: ApiRequest = {
      method,
      url: previewUrl,
      headers,
      body: includeBody ? bodyText : undefined,
    };

    try {
      const result = onSend ? await onSend(request) : await runFetch(request);
      setResponse(result);
    } catch (error) {
      // Honest failure: a browser `fetch` rejection is almost always network/CORS, not an HTTP error.
      const detail = error instanceof Error ? error.message : String(error);
      const hint = serverUrl
        ? `Could not reach ${serverUrl}. Is your API running there, and does its CORS policy allow this origin?`
        : "Set a Server URL above, make sure your API is running, and that its CORS policy allows this origin.";
      setErrorMessage(`${detail} — ${hint}`);
    } finally {
      setLoading(false);
    }
  };

  const bodyText$ = response ? prettyBody(response.body) : "";
  const responseHeaders = response?.headers ? Object.entries(response.headers) : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Path parameters */}
      {pathParams.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Path parameters</Eyebrow>
          {pathParams.map((p) => (
            <FieldRow key={`path:${p.name}`} label={p.name} required={p.required}>
              <input
                type="text"
                value={pathValues[p.name] ?? ""}
                onChange={(e) => setPathValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                spellCheck={false}
                aria-label={`Path parameter ${p.name}`}
                className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[color:var(--paper)] px-2 font-mono text-[12px] text-[var(--ink)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
            </FieldRow>
          ))}
        </div>
      )}

      {/* Query parameters */}
      {queryParams.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Query parameters</Eyebrow>
          {queryParams.map((p) => (
            <FieldRow key={`query:${p.name}`} label={p.name} required={p.required}>
              <input
                type="text"
                value={queryValues[p.name] ?? ""}
                onChange={(e) => setQueryValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                spellCheck={false}
                placeholder={initialParamValue(doc, p) || "value"}
                aria-label={`Query parameter ${p.name}`}
                className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[color:var(--paper)] px-2 font-mono text-[12px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
            </FieldRow>
          ))}
        </div>
      )}

      {/* Request body (write methods with a body schema) */}
      {bodyDraft && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Eyebrow>Body</Eyebrow>
            <span className="font-mono text-[11px] text-[var(--ink-faint)]">{bodyDraft.contentType}</span>
          </div>
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            spellCheck={false}
            rows={Math.min(14, Math.max(4, bodyText.split("\n").length))}
            aria-label="Request body (JSON)"
            className="w-full resize-y rounded-md border border-[hsl(var(--border))] bg-[color:var(--paper-sunken)] p-2.5 font-mono text-[12px] leading-[1.6] text-[var(--ink)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
        </div>
      )}

      {/* Request line + Send */}
      <div className="flex items-center gap-3 border-t border-[hsl(var(--border))] pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <MethodBadge method={op.method} size="sm" />
          <span className="truncate font-mono text-[12px] text-[var(--ink-soft)]" title={previewUrl}>
            {previewUrl}
          </span>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={loading}
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 font-sans text-[12px] font-semibold text-black outline-none transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden fill="currentColor">
            <path d="M2.5 1.5 L10 6 L2.5 10.5 Z" />
          </svg>
          {loading ? "Sending" : "Send"}
        </button>
      </div>

      {/* Error */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-[color:var(--danger-border)] bg-[color:var(--danger-wash)] p-2.5 font-sans text-[12.5px] leading-[1.5] text-[color:var(--danger)]"
        >
          {errorMessage}
        </div>
      )}

      {/* Response */}
      {response && (
        <div className="flex flex-col gap-2.5" aria-live="polite">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <ResponseStatus status={response.status} statusText={response.statusText} />
            {typeof response.durationMs === "number" && (
              <span className="font-mono text-[11px] text-[var(--ink-faint)]">{response.durationMs} ms</span>
            )}
          </div>

          {responseHeaders.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowHeaders((v) => !v)}
                aria-expanded={showHeaders}
                className="inline-flex items-center gap-1.5 rounded-[4px] font-mono text-[11px] text-[var(--ink-faint)] outline-none transition-colors hover:text-[var(--ink-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <CaretIcon open={showHeaders} />
                Headers ({responseHeaders.length})
              </button>
              {showHeaders && (
                <dl className="mt-1.5 overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[color:var(--paper-sunken)]">
                  {responseHeaders.map(([name, value], i) => (
                    <div
                      key={name}
                      className={["flex gap-2 px-2.5 py-1.5 font-mono text-[11.5px]", i > 0 ? "border-t border-[hsl(var(--border))]" : ""].join(" ")}
                    >
                      <dt className="shrink-0 text-[var(--ink-faint)]">{name}</dt>
                      <dd className="min-w-0 break-all text-[var(--ink-soft)]">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[color:var(--paper-sunken)]">
            <div className="flex h-8 items-center justify-between border-b border-[hsl(var(--border))] px-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">Response body</span>
              <CopyButton text={bodyText$} />
            </div>
            <pre className="max-h-[420px] overflow-auto p-3 font-mono text-[12px] leading-[1.6] text-[var(--ink)]">
              <code>{bodyText$ || "(empty body)"}</code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/** A labeled input row: name (mono, with an orange required marker) above the control. */
function FieldRow({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 font-mono text-[12px] text-[var(--ink-soft)]">
        {label}
        {required && (
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--accent)]">required</span>
        )}
      </span>
      {children}
    </label>
  );
}
