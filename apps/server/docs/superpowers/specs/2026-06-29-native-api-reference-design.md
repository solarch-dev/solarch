# Solarch-Native API Reference (replace native Scalar — brand identity)

**Date:** 2026-06-29
**Status:** Approved design (pre-plan). Revises the frontend render of the API-docs feature
(`2026-06-29-api-docs-test-design.md`); backend OpenAPI emitter + AI Documentize stay unchanged.

## Goal

Using native Scalar (`@scalar/api-reference` in-app, `@scalar/nestjs-api-reference` in the generated
app) stamps Scalar's visual identity onto Solarch's product AND onto every app built with Solarch — a
corporate-identity problem. Replace it with a **Solarch-branded API reference** that replicates
Scalar's proven three-pane UX (sidebar nav by tag → operations + a schemas section; main operation
panel with parameters / request body / responses / examples / code sample; an interactive "Try it"
console) in Solarch's own design language. Built ONCE as portable components, used in BOTH surfaces.

## Decision: build once, portable

The reference is a **self-contained, props-only React component tree** — `<SolarchApiReference doc
serverUrl onSend? />` — with NO coupling to the Solarch app's store, router, or query client. That
single tree is consumed two ways:
1. **In-app** (`solarch-frontend`): `ApiDocsPanel` imports it directly (replaces `@scalar/api-reference`).
2. **Generated app `/docs`**: a standalone Vite **library build** emits a self-contained
   `solarch-api-reference.{js,css}` bundle; it is **vendored into the backend codegen assets**; the
   generated NestJS `main.ts` serves a tiny static `/docs` HTML that mounts the bundle against the
   app's own `/openapi.json` (replaces `@scalar/nestjs-api-reference`).

Both deps are removed. The generated app stays self-contained (bundle vendored in the project, not
fetched from Solarch — consistent with "code/runtime never on our servers").

## Scalar UX (what to replicate) — grounded in Scalar's architecture

Scalar (Vue) is a three-pane reference: left sidebar (tags → operations, + a Models/Schemas section,
with search), main content (per-operation: method+path, description, parameters, request body schema,
responses + examples, multi-language code samples), and an integrated API console for live requests.
We rebuild the same UX in React + Solarch tokens (Scalar is Vue, so it is a reimplementation, not a
restyle).

## Components (`solarch-frontend/src/features/api/reference/`, portable)

- `SolarchApiReference.tsx` — orchestrator: holds the parsed doc + selected operation/schema state;
  three-pane layout. Props: `{ doc: OpenAPIObject; serverUrl?: string; onSend?: (req) => Promise<Res> }`
  (`onSend` lets a host override transport — in-app uses browser fetch / later the VS Code bridge;
  defaults to browser fetch when omitted).
- `ApiSidebar.tsx` — search field; tag (controller) groups → operation rows (`MethodBadge` + path); a
  "Schemas" section listing component schemas. Selection-driven.
- `OperationView.tsx` — header (method + full path + summary), AI-Documentize description,
  **Parameters** table (path/query: name/type/required/description), **Request body** (`SchemaTree`),
  **Responses** (per status: badge + description + `SchemaTree` + example JSON), a copyable code
  sample (curl + fetch), and the `TryItConsole`.
- `SchemaTree.tsx` — recursively renders a JSON-Schema node (resolves `$ref` into
  `doc.components.schemas`), expandable nested objects/arrays, enum chips, required markers.
- `TryItConsole.tsx` — inputs for path/query params + a JSON body editor (prefilled with the
  example), **Send** → response viewer (status + headers + body). Uses `onSend` (or browser fetch to
  `serverUrl`).
- `MethodBadge.tsx` + `openapi-nav.ts` (build tag→operation tree, resolve `$ref`, pick examples).

`ApiDocsPanel.tsx` becomes a thin host: fetch `{ doc }` (`useOpenApi`), the "AI Documentize" button
(`useDocumentize`), the "Server URL" field, then `<SolarchApiReference doc serverUrl />`.

## Design language

Solarch tokens only: `--ink`/`--paper`/`--paper-raised`/`--border`/`--accent`; JetBrains Mono for
method/path/code, Satoshi/sans for prose; soft borders; **no AI-slop** (no gradients/glassmorphism/
pills); method badges color-disciplined but muted (GET green, POST blue, PUT/PATCH amber, DELETE red);
calm spacing; dark/light via the existing `.dark` token system. The standalone bundle **inlines** the
needed token values (it cannot rely on the app's global CSS) and ships a light+dark theme toggle.

## Scope (two plans)

- **Plan A — in-app native reference:** build the portable `reference/` components + rewire
  `ApiDocsPanel` to use them; remove `@scalar/api-reference`. Test = manual Server URL (browser-direct),
  as today. Delivers the branded in-app API surface.
- **Plan B — generated `/docs` branded bundle:** add a standalone Vite lib build of the reference
  (token values inlined, self-contained); vendor the artifact into `solarch-backend` codegen assets;
  the scaffold emitter serves it at `/docs` against the generated `/openapi.json`; remove
  `@scalar/nestjs-api-reference` from the generated app. Delivers Solarch-branded docs in every
  generated app.

**OUT:** multi-language code samples beyond curl+fetch; saved request collections; the VS Code
local-deploy + proxy bridge (separate Plan 2 — the privacy-clean test transport plugs into `onSend`).

## Risks

- **Portability**: the component tree must not import the app's store/router/query — props only — or
  the standalone bundle breaks. Enforce by building Plan B's bundle from the SAME files.
- **Standalone self-containment**: the bundle cannot depend on the app's global CSS/tokens; inline the
  token palette + scope styles so it renders correctly inside an arbitrary generated app.
- **Cross-repo vendoring**: Plan B copies a frontend build artifact into the backend repo; needs a
  documented build step (frontend `build:reference` → copy to `solarch-backend/src/codegen/assets/`).
- **Re-implementation surface**: an OpenAPI reference is non-trivial (schema `$ref` resolution,
  oneOf/allOf, nested arrays). Scope schema rendering to what `projectOpenApi` actually emits
  (objects, arrays, enums, `$ref`s, scalar formats) — not the full JSON-Schema spec.
