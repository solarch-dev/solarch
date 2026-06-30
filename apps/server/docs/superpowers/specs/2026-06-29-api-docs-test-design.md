# AI Documentize — API Docs + Test (Diagram → Code → API Docs + Test)

**Date:** 2026-06-29
**Status:** Approved design (pre-plan)

## Goal

Extend the pipeline with a final stage: **Diagram → Code → API Docs + Test**. An "AI Documentize"
action turns the architecture graph into beautiful, interactive **Scalar** API documentation whose
endpoints can be **tested**, and makes the generated NestJS app **self-document** (ships its own
Scalar docs). The OpenAPI structure is deterministic (verified from the graph); the AI only adds
prose and examples — it never invents endpoints, keeping Solarch's "verified, not guessed" promise.

## Prior art (already present — this is mostly wiring + one new emitter)

- Backend deps already installed: `@nestjs/swagger@^11.4.4`, `@scalar/nestjs-api-reference@^1.1.17`.
  Frontend has `openapi-fetch` + `openapi-typescript` (no `@scalar/api-reference` yet — to add).
- The graph is FULLY rich for OpenAPI: `controller.schema` Endpoints carry HttpMethod, Route,
  BaseRoute, PathParams, QueryParams, RequestDTORef, ResponseDTORef, ReturnsCollection, RequiresAuth,
  RequiredRoles, **StatusCodes (Code + Description)**, RateLimit, Description; `dto.schema` Fields
  carry DataType, IsRequired, IsArray, ValidationRules (Min/Max/Email/…), DefaultValue, NestedDTORef,
  EnumRef, Description; `model.schema` + `enum.schema` (values + descriptions + transitions).
- Deterministic graph→artifact projection pattern exists: `src/codegen/simple-projection.ts`
  (`projectSimpleView(graph: CodeGraph): DTO`). The OpenAPI emitter mirrors it.
- AI-enrich pattern exists: Simple View `aiEnrichSketchModel` (tool-calling, grounded, cached per
  graph version, deterministic baseline + AI layer, falls back when AI off).
- Frontend surface-switch pattern exists: `useWorkspaceView` (`view: "canvas" | "code"`) +
  `ViewSwitch` + `ProjectPage` mounting `CodegenPanel`. A 3rd `"api"` surface slots in cleanly.
- Codegen does NOT yet emit `@nestjs/swagger` decorators, and the generated `main.ts` listens but is
  never served by Solarch — see components below.

## Decisions (locked during design)

1. **OpenAPI is derived deterministically from the graph** (instant, no run, verified) for the in-app
   view; the AI only enriches prose/examples.
2. **One enrichment feeds two outputs:** (a) the in-app Scalar "API" surface, and (b) the generated
   app's own `@nestjs/swagger` decorators — so the shipped app's docs are rich too.
3. **The generated app self-documents:** codegen emits swagger decorators + SwaggerModule +
   `@scalar/nestjs-api-reference` at `/docs`.
4. **Code never resides or runs on Solarch servers (hard privacy principle).** The generated NestJS
   app is deployed (run) LOCALLY on the user's device **via the VS Code extension**, which also
   exposes a **local proxy bridge**; the in-app Scalar tests endpoints THROUGH that bridge. Solarch
   cloud only ever holds the diagram + the graph-derived OpenAPI doc — never the generated code, and
   never executes or proxies it cloud-side. A manual browser-direct "Server URL" (default
   `http://localhost:3000`) remains a no-extension fallback; either way requests are browser→localhost
   (or browser→extension-bridge→localhost), never through Solarch's servers. (This supersedes any
   Solarch-hosted execution or cloud backend proxy — those are explicitly rejected.)
5. **New `"api"` surface** alongside Canvas/Code.

## Architecture (pipeline)

```
Graph ──[projectOpenApi: deterministic]──▶ OpenAPI 3.1 (paths/schemas/auth/status) — VERIFIED
      └─[AI Documentize: summaries/descriptions/examples/errors]──▶ enriched OpenAPI (cached)
            ├──▶ in-app "API" surface: Scalar render + "Test Request" → VS Code extension local bridge → locally-deployed app (code never leaves the device)
            └──▶ codegen: @nestjs/swagger decorators + SwaggerModule + Scalar @ /docs (generated app self-documents)
```

The generated CODE lives, runs, and is proxied entirely on the user's machine (via the VS Code
extension). Solarch cloud holds only the diagram + the graph-derived OpenAPI doc — never the code.

## Components

### 1. OpenAPI emitter — `src/codegen/openapi.emitter.ts` (NEW, deterministic)
- `projectOpenApi(graph: CodeGraph): OpenAPIObject` (OpenAPI 3.1). Mirrors `simple-projection.ts`.
- Walk `graph.allOf("Controller")` → for each Endpoint build a path item: method, full path
  (BaseRoute + Route, `:id`→`{id}`), parameters (PathParams + QueryParams), requestBody
  (`$ref` to RequestDTORef schema), responses (per StatusCode → ResponseDTORef schema or array if
  ReturnsCollection; default 200/201), `security` if RequiresAuth, `x-rate-limit` from RateLimit,
  `tags: [controllerName]`, `operationId`.
- Walk `graph.allOf("DTO")` + `"Model"` + `"Enum"` → `components.schemas`: field → JSON Schema
  (DataType→type, IsArray→array, IsRequired→required[], ValidationRules→min/max/format/pattern,
  EnumRef→enum, NestedDTORef→`$ref`).
- Pure, deterministic, no run. Unit-tested against a fixture graph.

### 2. AI Documentize — `src/codegen/api-doc.service.ts` (NEW, AI-enrich)
- `documentize(graph): Promise<{ doc: OpenAPIObject; source: "ai" | "deterministic"; aiConfigured }>`.
- Deterministic baseline = `projectOpenApi(graph)`. If AI configured, an enrichment agent
  (tool-calling, mirrors `aiEnrichSketchModel`) adds: operation `summary`/`description`, field
  `description`, realistic request/response `examples`, and error-response descriptions. Tools only
  SET prose/examples on EXISTING operations/schemas (grounded; cannot add/rename paths). Cached per
  graph hash (persisted on the project, like the Simple View model). Falls back to baseline on AI
  failure (logged, not swallowed).
- The enriched descriptions/examples are also consumable by the codegen emitters (component 4).

### 3. Endpoints — `src/codegen/codegen.controller.ts` (extend)
- `GET projects/:id/openapi.json?stage=baseline|full` → the (baseline or enriched) OpenAPI. Free,
  no billing gate (like Simple View). `stage=baseline` returns the deterministic doc instantly.
- `POST projects/:id/openapi/documentize` → force re-enrich (bypass cache), returns enriched doc.
- Optional `POST projects/:id/api-proxy { targetUrl, method, path, headers, body }` → server-side
  proxy for PUBLIC test targets (CORS sidestep); localhost targets use browser-direct.

### 4. Codegen swagger emission (extend emitters)
- `emitters/nestjs/controller.emitter.ts`: per controller `@ApiTags`; per endpoint `@ApiOperation
  ({ summary, description })`, `@ApiResponse` per StatusCode (+ type from ResponseDTORef),
  `@ApiBearerAuth()` when RequiresAuth.
- `emitters/nestjs/dto.emitter.ts`: per field `@ApiProperty({ required, type, isArray, example,
  description, enum })`.
- `emitters/nestjs/scaffold.emitter.ts` (main.ts): add `SwaggerModule.createDocument` +
  `apiReference` (`@scalar/nestjs-api-reference`) mounted at `/docs`; ensure `enableCors` permits the
  configured docs/test origin (dev-friendly). Descriptions/examples come from the enriched doc when
  available, else deterministic.
- Bump `CODEGEN_VERSION` (output changed).

### 5. Frontend "API" surface
- `state/workspace-view.ts`: `view: "canvas" | "code" | "api"`.
- `components/ViewSwitch.tsx`: add a 3rd tab "API" (3-segment chip; keep the no-slop styling).
- `features/api/ApiDocsPanel.tsx` (NEW): renders Scalar (`@scalar/api-reference` — add to frontend
  deps) against `GET /openapi.json`; an **"AI Documentize"** button (triggers `documentize`, shows
  progress, then re-renders enriched doc); a **"Server URL"** field (default `http://localhost:3000`)
  bound to Scalar's server target so "Test Request" hits the user's running instance.
- `api/openapi.ts` (NEW): `useOpenApi(projectId, stage?)` + `useDocumentize(projectId)` (mirror the
  Simple View hooks).
- The "Server URL" / test target points at the **VS Code extension local bridge** (component 6) when
  paired, else a manual localhost URL (no-extension fallback).

### 6. VS Code extension — local deploy + proxy bridge (the privacy core)
The generated code stays on the user's machine; the extension runs it and bridges Scalar to it.
- **Local deploy command** ("Solarch: Run API locally"): materialize the generated project on disk
  (the extension already drives codegen via the CLI/MCP it ships with), install deps (reuse a warm
  deps cache like the fill flow), start the app (`start:dev` / `node dist/main.js`) on a local port;
  surface status + logs in the extension.
- **Local proxy bridge**: the extension runs a tiny HTTP bridge on a localhost port that forwards
  incoming requests to the locally-running app and returns the response. The in-app Scalar's "Test
  Request" hits this bridge (browser → `http://localhost:<bridgePort>` → local app). This is the
  "proxy" — entirely on the device; Solarch cloud is never in the request path.
- **Pairing / security**: the bridge MUST NOT be an open localhost relay any site can abuse. It
  (a) checks the `Origin` against the Solarch web origin allowlist, and (b) requires a one-time
  pairing token the extension generates and the user pastes into the "API" surface (or a localhost
  loopback handshake). Only the paired Solarch session can drive the bridge.
- **No cloud code**: the project files, the running process, and the bridge all live on the device.
  Solarch cloud sends only the OpenAPI doc to the browser; the browser sends test requests to the
  local bridge. This realizes "never keep code on our servers" for both Scalar testing AND deploy.

## Data flow (example)

Open "API" surface → `GET /projects/:id/openapi.json?stage=baseline` (instant deterministic doc) →
Scalar renders paths/schemas. User clicks **AI Documentize** → `POST …/documentize` → enriched doc
(summaries + examples) re-renders. In VS Code the user runs
"Solarch: Run API locally" → the extension deploys the generated app on the device + starts its local
bridge, then pairs with the "API" surface. User clicks **Test** on `POST /users` → Scalar →
extension bridge → locally-deployed app → real response shown (no code/request through Solarch
cloud). On next codegen, the generated app ships `@ApiOperation` + Scalar `/docs` with the same
descriptions.

## Error handling

- AI enrichment failure → fall back to deterministic doc, log a warning (never swallow), surface
  `source: "deterministic"` so the UI can offer "Retry / AI off".
- Test request CORS/connection failure → Scalar shows the network error; the UI hints "is your app
  running at <Server URL>? CORS must allow this origin (the generated app enables it by default)."
- Empty graph / no controllers → a valid empty OpenAPI + an honest "No endpoints yet" state.
- Public-target proxy errors (bad URL, timeout) → clear message; localhost is browser-direct only.

## Testing strategy

- **Unit:** `projectOpenApi` against a fixture graph → assert paths/methods/params/schemas/auth/status
  (deterministic, the core). `api-doc.service` enrichment only mutates prose/examples on existing
  operations (never adds paths) — assert with a stub LLM.
- **Codegen:** assert the controller/dto/scaffold emitters output `@ApiTags/@ApiOperation/
  @ApiProperty/@ApiResponse` + `SwaggerModule` + Scalar in main.ts (snapshot-ish on a fixture graph),
  and that the project still builds (`nest build` of generated output stays green via existing tests).
- **Frontend:** build (`pnpm build`) + manual: open API surface, Documentize, set Server URL, Test.

## Scope

**IN (slice 1):** deterministic `projectOpenApi` emitter; AI Documentize enrichment (cached);
`openapi.json` + `documentize` endpoints; codegen swagger emission (controller/dto/main.ts + Scalar
`/docs`); frontend "API" surface with Scalar + AI Documentize button; **VS Code extension local
deploy ("Run API locally") + local proxy bridge + pairing with the API surface** (the privacy core);
manual localhost Server-URL fallback for no-extension users; generated dev-CORS.

**OUT (phase 2+):** Solarch-cloud execution / cloud proxy (explicitly rejected — code never on our
servers); saved request collections / history; auth-token helper for test requests; non-NestJS doc
emission; remote/non-local deploy targets.

## Risks / things to watch

- **CORS for testing**: localhost is browser-direct; the generated app must emit dev-CORS allowing
  the Solarch origin or "Test" fails. We control codegen, so emit it — but watch existing CORS config
  in `scaffold.emitter` (don't loosen prod CORS; gate the permissive origin to a docs/dev setting).
- **Enrichment grounding**: the AI must only annotate existing operations/schemas; enforce via tools
  that reference existing operationIds/schema names (reject unknown), mirroring the Simple View guard.
- **OpenAPI fidelity**: status-code→schema mapping and nested/enum `$ref`s are the fiddly parts; cover
  them in the emitter unit tests first.
- **CODEGEN_VERSION bump** triggers drift/"update available" — expected.
- **Local bridge security**: a localhost bridge is reachable by ANY web page on the machine; it MUST
  enforce an Origin allowlist (Solarch web origin) AND a pairing token, or a malicious site could
  drive the user's locally-running app. Treat as a security-review item.
- **Extension prerequisites**: the privacy-core path needs the VS Code extension installed + the
  generated app locally runnable (deps install, any DB/env the app needs). The no-extension manual
  Server-URL fallback keeps the feature usable without it.
- **Web → localhost from an https origin**: `http://localhost`/`127.0.0.1` is a secure context, so
  browsers permit it; a deployed (non-localhost) bridge would need TLS — out of scope (local only).
