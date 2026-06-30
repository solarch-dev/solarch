/**
 * OperationView — the full detail view for one API operation.
 *
 * Reimplements, in React + Solarch tokens, the structure/behavior of Scalar's modern operation
 * layout (studied from the real Vue source):
 *   - features/Operation/layouts/ModernLayout.vue        — the operation grid. Scalar uses a single
 *                                                          CSS grid with `grid-template-areas`
 *                                                          (heading/badge, description/examples,
 *                                                          details/examples), a 48px column gap, a
 *                                                          sticky right "examples" column, and a
 *                                                          `@container (max-width: 900px)` collapse to
 *                                                          a single column (badge, heading,
 *                                                          description, examples, details). We mirror
 *                                                          that exactly with a scoped container query.
 *   - features/Operation/components/OperationParameters.vue — splits `parameters` by `in`
 *                                                          (path/query/header/cookie) into titled
 *                                                          groups, then the request body. We render
 *                                                          one titled table per non-empty location.
 *   - features/Operation/components/ParameterListItem.vue — a parameter row: name (mono, bold),
 *                                                          description, schema, and an uppercase
 *                                                          orange `required` marker. We flatten this
 *                                                          to a four-column table (name/type/required/
 *                                                          description) per the plan.
 *   - features/Operation/components/RequestBody.vue      — header (title + "· ModelName" + required +
 *                                                          content-type) then the schema. We show the
 *                                                          content-type label + a `SchemaTree`.
 *   - features/Operation/components/OperationResponses.vue — heading + a list, one entry per status
 *                                                          code, each carrying its schema. We add a
 *                                                          status-class badge (2xx/4xx/5xx) + a
 *                                                          collapsible example block.
 *   - features/example-responses/ExampleResponses.vue    — a sticky card of the example response
 *                                                          (Scalar tabs it by status). We show the
 *                                                          request code sample (curl/fetch) plus the
 *                                                          primary response example on the right.
 *
 * We do NOT copy Scalar's CSS or visual identity. Surfaces/text/borders use Solarch design tokens
 * (var(--paper-raised) / var(--paper-sunken) / var(--ink*) / hsl(var(--border)) / var(--accent)),
 * JetBrains Mono for method/path/code/JSON and Satoshi (sans) for prose, with status colors taken
 * from the shared semantic tokens (--ok / --warn / --danger). The method chip is `MethodBadge`
 * (one color map for the whole reference). No gradients, no glassmorphism, no fully-rounded pills.
 *
 * Scope = what the backend `projectOpenApi` emits: path/query parameters, an `application/json`
 * request body, and per-status responses with a single content type. Composition is not modelled.
 *
 * Portable (props-only): the only imports are React + the pure `openapi.ts` helpers + the sibling
 * presentational components (`MethodBadge`, `SchemaTree`). No app store / router / react-query /
 * `@/`-singletons, so Plan B can bundle this file standalone for the generated app's `/docs`.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import type {
  MediaTypeObject,
  NavOp,
  OpenApiDoc,
  ParameterObject,
  RequestBodyObject,
  ResponseObject,
} from "./openapi";
import { exampleFromSchema, resolveRef, schemaType } from "./openapi";
import { MethodBadge } from "./MethodBadge";
import { SchemaTree } from "./SchemaTree";
import { Markdown } from "./Markdown";

export interface OperationViewProps {
  doc: OpenApiDoc;
  /** The selected operation (id/method/path/summary/operation), from `buildNav`. */
  op: NavOp;
  /** The base URL the code samples target (e.g. http://localhost:3000). */
  serverUrl?: string;
}

/* ── Scoped layout (mirrors ModernLayout's grid + 900px container collapse) ────────────────────── */

const LAYOUT_STYLES = `
.solarch-op { container-type: inline-size; }
.solarch-op-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas:
    'header header'
    'desc examples'
    'details examples';
  column-gap: 40px;
  row-gap: 0;
}
.solarch-op-header { grid-area: header; }
.solarch-op-desc { grid-area: desc; min-width: 0; }
.solarch-op-details { grid-area: details; min-width: 0; }
.solarch-op-examples {
  grid-area: examples;
  min-width: 0;
  align-self: start;
  position: sticky;
  top: 16px;
}
@container (max-width: 900px) {
  .solarch-op-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'header'
      'desc'
      'examples'
      'details';
    column-gap: 0;
  }
  .solarch-op-examples { position: static; }
}
`;

/* ── Small inline icons (no icon-lib import — keeps the file portable, like SchemaTree) ─────────── */

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

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
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
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
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

/* ── Reusable surfaces ─────────────────────────────────────────────────────────────────────────── */

/** A titled section with the Scalar-style heading underline (border-bottom + medium label). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7 first:mt-0">
      <h3 className="border-b border-[hsl(var(--border))] pb-2 font-sans text-[13px] font-semibold text-[var(--ink)]">{title}</h3>
      <div className="pt-3">{children}</div>
    </section>
  );
}

/** A faint mono eyebrow label (group titles, "Request" / "Response"). */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">{children}</div>
  );
}

/** A bordered monospace code surface with an optional header (label + copy). */
function CodeSurface({ code, header }: { code: string; header?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-[hsl(var(--border))] bg-[var(--paper-sunken)]">
      {header && (
        <div className="flex h-8 items-center justify-between border-b border-[hsl(var(--border))] px-2">{header}</div>
      )}
      <pre className="max-h-[420px] overflow-auto p-3 font-mono text-[12px] leading-[1.6] text-[var(--ink)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** A tabbed code surface (e.g. curl / fetch). The active tab's code feeds the copy button. */
function CodeTabs({ tabs }: { tabs: { id: string; label: string; code: string }[] }) {
  const [active, setActive] = useState(0);
  const current = tabs[active] ?? tabs[0];
  return (
    <div className="overflow-hidden rounded-[8px] border border-[hsl(var(--border))] bg-[var(--paper-sunken)]">
      <div className="flex h-8 items-center justify-between border-b border-[hsl(var(--border))] pl-1 pr-2">
        <div className="flex items-center gap-0.5">
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(i)}
              aria-pressed={i === active}
              className={[
                "h-6 rounded-[4px] px-2 font-mono text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                i === active
                  ? "bg-[var(--accent-wash)] text-[var(--accent)]"
                  : "text-[var(--ink-faint)] hover:text-[var(--ink-soft)]",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CopyButton text={current?.code ?? ""} />
      </div>
      <pre className="max-h-[360px] overflow-auto p-3 font-mono text-[12px] leading-[1.6] text-[var(--ink)]">
        <code>{current?.code ?? ""}</code>
      </pre>
    </div>
  );
}

/** Status-code chip, colored by class: 2xx ok / 4xx warn / 5xx danger / other neutral. */
function StatusBadge({ code }: { code: string }) {
  const n = Number.parseInt(code, 10);
  let tone = "bg-[var(--paper-sunken)] border-[hsl(var(--border))] text-[var(--ink-soft)]";
  if (n >= 200 && n < 300) {
    tone = "bg-[color:var(--ok-wash)] border-[color:var(--ok-border)] text-[color:var(--ok)]";
  } else if (n >= 400 && n < 500) {
    tone = "bg-[color:var(--warn-wash)] border-[color:var(--warn-border)] text-[color:var(--warn)]";
  } else if (n >= 500) {
    tone = "bg-[color:var(--danger-wash)] border-[color:var(--danger-border)] text-[color:var(--danger)]";
  }
  return (
    <span className={["inline-flex h-[20px] items-center rounded-[4px] border px-1.5 font-mono text-[11px] font-semibold leading-none", tone].join(" ")}>
      {code}
    </span>
  );
}

/* ── Helpers (scoped to what the emitter produces) ─────────────────────────────────────────────── */

/** A short type label for a parameter / scalar schema: "ModelName", "string · uuid", "ModelName[]". */
function typeLabel(doc: OpenApiDoc, raw: unknown): string {
  const { schema, refName } = resolveRef(doc, raw);
  const base = schemaType(schema);
  if (base === "array" || schema.items !== undefined) {
    const { schema: items, refName: itemsRef } = resolveRef(doc, schema.items);
    return itemsRef ? `${itemsRef}[]` : `${schemaType(items) || "any"}[]`;
  }
  if (refName) {
    return refName;
  }
  const format = typeof schema.format === "string" ? schema.format : "";
  if (!base) {
    return "any";
  }
  return format ? `${base} · ${format}` : base;
}

/** A scalar example rendered as a string for a path/query placeholder in a code sample. */
function paramSampleValue(doc: OpenApiDoc, param: ParameterObject): string {
  const value = exampleFromSchema(doc, param.schema ?? {});
  if (value === null || value === undefined) {
    return param.name;
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** The first content entry of a request body / response, preferring `application/json`. */
function firstContent(content?: Record<string, MediaTypeObject>): { contentType: string; media: MediaTypeObject } | undefined {
  if (!content) {
    return undefined;
  }
  const keys = Object.keys(content);
  if (keys.length === 0) {
    return undefined;
  }
  const contentType = keys.includes("application/json") ? "application/json" : keys[0];
  return { contentType, media: content[contentType] ?? {} };
}

/** The example value for a media type: explicit `example` / first `examples[*].value` / from schema. */
function mediaExample(doc: OpenApiDoc, media: MediaTypeObject | undefined): unknown {
  if (!media) {
    return undefined;
  }
  if (media.example !== undefined) {
    return media.example;
  }
  if (media.examples && typeof media.examples === "object") {
    const first = Object.values(media.examples)[0];
    if (first && typeof first === "object" && "value" in (first as Record<string, unknown>)) {
      return (first as { value: unknown }).value;
    }
    if (first !== undefined) {
      return first;
    }
  }
  if (media.schema !== undefined) {
    return exampleFromSchema(doc, media.schema);
  }
  return undefined;
}

/** Build the concrete request URL: substitute `{path}` params, append example query params. */
function buildRequestUrl(doc: OpenApiDoc, op: NavOp, serverUrl: string): string {
  const base = serverUrl.replace(/\/+$/, "");
  let path = op.path;
  const params = op.operation.parameters ?? [];
  for (const param of params) {
    if (param.in === "path") {
      path = path.replace(`{${param.name}}`, encodeURIComponent(paramSampleValue(doc, param)));
    }
  }
  const query = params
    .filter((p) => p.in === "query")
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(paramSampleValue(doc, p))}`)
    .join("&");
  return `${base}${path}${query ? `?${query}` : ""}`;
}

/** A curl sample for the operation. Body + Content-Type only when there is a request body. */
function curlSample(method: string, url: string, body?: string): string {
  const lines = [`curl -X ${method} '${url}'`];
  if (body) {
    lines.push(`  -H 'Content-Type: application/json'`);
    lines.push(`  -d '${body}'`);
  }
  return lines.join(" \\\n");
}

/** A fetch sample for the operation, matching the curl request. */
function fetchSample(method: string, url: string, body?: string): string {
  const lines = [`await fetch('${url}', {`, `  method: '${method}',`];
  if (body) {
    lines.push(`  headers: { 'Content-Type': 'application/json' },`);
    lines.push(`  body: JSON.stringify(${body}),`);
  }
  lines.push("});");
  return lines.join("\n");
}

/* ── Parameter table (one per location) ────────────────────────────────────────────────────────── */

function ParamTable({ doc, title, params }: { doc: OpenApiDoc; title: string; params: ParameterObject[] }) {
  if (params.length === 0) {
    return null;
  }
  return (
    <div className="mt-5 first:mt-0">
      <Eyebrow>{title}</Eyebrow>
      <div className="mt-1.5 overflow-hidden rounded-[7px] border border-[hsl(var(--border))]">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-[var(--paper-sunken)]">
              <th className="px-3 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--ink-faint)]">Name</th>
              <th className="px-3 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--ink-faint)]">Type</th>
              <th className="px-3 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--ink-faint)]">Required</th>
              <th className="px-3 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--ink-faint)]">Description</th>
            </tr>
          </thead>
          <tbody>
            {params.map((param) => (
              <tr key={`${param.in}:${param.name}`} className="border-t border-[hsl(var(--border))] align-top">
                <td className="px-3 py-2 font-mono text-[12.5px] font-semibold text-[var(--ink)]">{param.name}</td>
                <td className="px-3 py-2 font-mono text-[12px] text-[var(--ink-soft)]">{typeLabel(doc, param.schema)}</td>
                <td className="px-3 py-2">
                  {param.required ? (
                    <span className="font-mono text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--accent)]">required</span>
                  ) : (
                    <span className="font-mono text-[11px] text-[var(--ink-faint)]">optional</span>
                  )}
                </td>
                <td className="px-3 py-2 font-sans text-[12.5px] leading-[1.5] text-[var(--ink-soft)]">{param.description ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Responses ─────────────────────────────────────────────────────────────────────────────────── */

function ResponseItem({ doc, code, response }: { doc: OpenApiDoc; code: string; response: ResponseObject }) {
  const [showExample, setShowExample] = useState(false);
  const content = firstContent(response.content);
  const schema = content?.media.schema;
  const example = content ? mediaExample(doc, content.media) : undefined;
  const exampleText = example !== undefined ? JSON.stringify(example, null, 2) : undefined;

  return (
    <div className="mt-4 first:mt-0">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <StatusBadge code={code} />
        {response.description && (
          <span className="font-sans text-[13px] text-[var(--ink-soft)]">{response.description}</span>
        )}
      </div>

      {schema !== undefined && (
        <div className="mt-2.5">
          <SchemaTree doc={doc} schema={schema} />
        </div>
      )}

      {exampleText !== undefined && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowExample((v) => !v)}
            aria-expanded={showExample}
            className="inline-flex items-center gap-1.5 rounded-[4px] font-mono text-[11px] text-[var(--ink-faint)] outline-none transition-colors hover:text-[var(--ink-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <CaretIcon open={showExample} />
            Example
          </button>
          {showExample && (
            <div className="mt-1.5">
              <CodeSurface code={exampleText} header={<CopyButton text={exampleText} />} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Operation view ────────────────────────────────────────────────────────────────────────────── */

export function OperationView({ doc, op, serverUrl = "" }: OperationViewProps) {
  const method = op.method.toUpperCase();
  const operation = op.operation;
  const description = typeof operation.description === "string" ? operation.description : undefined;

  // Parameters grouped by location (matches OperationParameters' split).
  const params = operation.parameters ?? [];
  const pathParams = params.filter((p) => p.in === "path");
  const queryParams = params.filter((p) => p.in === "query");
  const headerParams = params.filter((p) => p.in === "header");
  const cookieParams = params.filter((p) => p.in === "cookie");
  const hasParams = params.length > 0;

  // Request body (first content entry — our emitter uses application/json).
  const requestBody = operation.requestBody as RequestBodyObject | undefined;
  const bodyContent = firstContent(requestBody?.content);
  const bodyExample = bodyContent ? mediaExample(doc, bodyContent.media) : undefined;
  const bodyText = bodyExample !== undefined ? JSON.stringify(bodyExample) : undefined;

  // Responses, ordered by status code (matches ExampleResponses' ordering).
  const responsesRaw = operation.responses ?? {};
  const responseEntries = Object.keys(responsesRaw)
    .sort()
    .map((code) => [code, responsesRaw[code] as ResponseObject] as const);

  // The primary response example for the sticky right column: first 2xx with content, else first with content.
  const primaryResponse =
    responseEntries.find(([code, r]) => Number.parseInt(code, 10) >= 200 && Number.parseInt(code, 10) < 300 && firstContent(r.content)) ??
    responseEntries.find(([, r]) => firstContent(r.content));
  const primaryExample = primaryResponse ? mediaExample(doc, firstContent(primaryResponse[1].content)?.media) : undefined;
  const primaryExampleText = primaryExample !== undefined ? JSON.stringify(primaryExample, null, 2) : undefined;

  // Code samples (curl + fetch) targeting the configured server URL.
  const requestUrl = buildRequestUrl(doc, op, serverUrl);
  const codeTabs = [
    { id: "curl", label: "curl", code: curlSample(method, requestUrl, bodyText) },
    { id: "fetch", label: "fetch", code: fetchSample(method, requestUrl, bodyText) },
  ];

  return (
    <div className="solarch-op">
      <style>{LAYOUT_STYLES}</style>

      <div className="solarch-op-grid">
        {/* Header — method + path + summary (the request example carries the path on the right too). */}
        <div className="solarch-op-header">
          <div className="flex flex-wrap items-center gap-2.5">
            <MethodBadge method={op.method} />
            <span className="break-all font-mono text-[14px] text-[var(--ink)]">{op.path}</span>
          </div>
          {op.summary && (
            <h2 className="mt-3 font-sans text-[19px] font-semibold leading-[1.4] text-[var(--ink)]">{op.summary}</h2>
          )}
        </div>

        {/* Description (Markdown prose, from AI Documentize). */}
        <div className="solarch-op-desc">
          {description && <Markdown>{description}</Markdown>}
        </div>

        {/* Details — parameters, request body, responses, and the Try-it console. */}
        <div className="solarch-op-details">
          {hasParams && (
            <Section title="Parameters">
              <ParamTable doc={doc} title="Path parameters" params={pathParams} />
              <ParamTable doc={doc} title="Query parameters" params={queryParams} />
              <ParamTable doc={doc} title="Headers" params={headerParams} />
              <ParamTable doc={doc} title="Cookies" params={cookieParams} />
            </Section>
          )}

          {bodyContent && (
            <Section title="Request body">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] text-[var(--ink-soft)]">{bodyContent.contentType}</span>
                {requestBody?.required && (
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--accent)]">required</span>
                )}
              </div>
              {requestBody?.description && (
                <div className="mb-3">
                  <Markdown size="sm">{requestBody.description}</Markdown>
                </div>
              )}
              {bodyContent.media.schema !== undefined && <SchemaTree doc={doc} schema={bodyContent.media.schema} />}
            </Section>
          )}

          {responseEntries.length > 0 && (
            <Section title="Responses">
              {responseEntries.map(([code, response]) => (
                <ResponseItem key={code} doc={doc} code={code} response={response} />
              ))}
            </Section>
          )}
        </div>

        {/* Examples — request code sample + the primary response example (sticky on wide containers). */}
        <div className="solarch-op-examples flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Eyebrow>Request</Eyebrow>
            <CodeTabs tabs={codeTabs} />
          </div>

          {primaryResponse && primaryExampleText !== undefined && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Eyebrow>Response</Eyebrow>
                <StatusBadge code={primaryResponse[0]} />
              </div>
              <CodeSurface code={primaryExampleText} header={<CopyButton text={primaryExampleText} />} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
