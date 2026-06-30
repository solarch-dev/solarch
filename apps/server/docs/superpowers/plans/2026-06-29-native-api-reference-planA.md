# Solarch-Native API Reference — Plan A (in-app), 1 of 2

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Checkbox steps.

**Goal:** Replace `@scalar/api-reference` in the in-app "API" surface with a Solarch-branded reference that replicates Scalar's UX (sidebar nav by tag→operations + schemas; operation view with parameters/request-body/responses/examples/code-sample; "Try it" console) using React + Solarch design tokens. Built as PORTABLE, props-only components (no app store/router) so Plan B can bundle the same files for the generated app's `/docs`.

**Architecture:** A `reference/` component tree under `solarch-frontend/src/features/api/`. Pure helpers (`$ref` resolver, nav-tree builder, example generator) feed presentational components (`MethodBadge`, `SchemaTree`, `OperationView`, `ApiSidebar`, `TryItConsole`) assembled by `SolarchApiReference` (2-pane grid). `ApiDocsPanel` becomes a thin host. We feed a plain OpenAPI 3.1 object (what the backend `projectOpenApi` emits) — so we replicate the two responsibilities Scalar's store does internally: `$ref` resolution + nav tree.

**Tech Stack:** React, TanStack Query (host only), Solarch tokens. NO new runtime deps; `@scalar/api-reference` is REMOVED in the last task.

## Global Constraints

- **STUDY THE REAL SCALAR SOURCE before building each component.** It is cloned (sparse) at
  `SCALAR=/tmp/claude-1000/-home-balicien-Masa-st--Arsiv-Solarch/2034a6a2-f175-4b88-a688-76b5b5b35569/scratchpad/scalar` —
  api-reference at `$SCALAR/packages/api-reference/src`. Each task names the exact Scalar file(s) to read first. Scalar is Vue; reimplement its STRUCTURE/behavior in React + our tokens (do NOT copy Vue verbatim, do NOT carry Scalar's visual identity).
- **Frontend has NO test runner** (vite only). Verification per task = `pnpm build` (vite type-check + bundle) MUST pass. The user reviews behavior live (HMR). Do NOT add a test framework.
- Builds: `export PATH="/run/host/usr/bin:/usr/bin:$HOME/.local/share/pnpm:$PATH"` first, in `solarch-frontend`. **git uses DEFAULT PATH.**
- Commits → `solarch-dev` → **NO Co-Authored-By/Claude trailer**. Code (comments + UI strings) **English only**. **No emojis.**
- **Design tokens (Solarch, NOT Scalar):** surfaces `var(--paper)` / `var(--paper-raised)` / `var(--paper-sunken)`; text `var(--ink)` / `var(--ink-soft)` / `var(--ink-faint)`; `hsl(var(--border))`; accent `var(--accent)`; **no gradients/glassmorphism/pills**; soft borders; calm spacing; dark/light via the existing `.dark` system (tokens already flip). Fonts: JetBrains Mono for method/path/code/JSON, sans (Satoshi) for prose.
- **Method colors** (muted, token-based; map Scalar's mapping to ours): GET→blue, POST→green, PUT→orange, PATCH→amber/yellow, DELETE→red, other→purple. Define ONE map in `MethodBadge`.
- **Portability rule:** files under `reference/` MUST NOT import the app store, router, react-query, or `@/`-app singletons — props only. (Plan B bundles them standalone.) The host (`ApiDocsPanel`) does the data fetching.
- **Scope the schema renderer to what `projectOpenApi` emits:** object (properties + required), array (items), `$ref` → `#/components/schemas/*`, enum, scalar (type + format + validation keywords min/max/minLength/maxLength/pattern/format), description. oneOf/allOf/anyOf/discriminator are NOT emitted by our backend → handle gracefully (render type + note) but do NOT build the full composition UI.

---

### Task 1: OpenAPI helpers — `$ref` resolver, nav tree, example generator

**Files:** Create `solarch-frontend/src/features/api/reference/openapi.ts` (types + helpers).
**Study first:** `$SCALAR/packages/api-reference/src/features/Search/helpers/create-search-index.ts` (the `TraversedEntry` nav shape + recursive walk), `$SCALAR/packages/api-reference/src/features/example-responses/ExampleResponse.vue` (how `getExampleFromSchema` is used), `$SCALAR/packages/api-reference/src/components/Content/Schema/helpers/get-ref-name.ts` (ref → name).

**Interfaces (Produces):**
- `type OpenApiDoc = { openapi: string; info: {...}; paths: Record<string, PathItem>; components?: { schemas?: Record<string, Schema>; securitySchemes?: Record<string, unknown> }; tags?: {name:string;description?:string}[] }` (structural; loose `Schema = Record<string, unknown>`).
- `resolveRef(doc, schemaOrRef): { schema: Schema; refName?: string }` — if `{$ref:'#/components/schemas/X'}` → return `doc.components.schemas.X` + `refName:'X'`; else return as-is.
- `buildNav(doc): NavGroup[]` where `NavGroup = { tag: string; description?: string; operations: NavOp[] }` and `NavOp = { id: string; method: string; path: string; summary?: string; operation: OperationObject }`; plus `listSchemas(doc): { name: string; schema: Schema }[]`. Group operations by their first `tags[0]` (fallback "default"); `id = method+":"+path`.
- `exampleFromSchema(doc, schema): unknown` — recursive: prefer `example`/`default`/`const`/first `enum`; object → `{prop: example(child)}` (resolve `$ref`); array → `[example(items)]`; scalar → type placeholder (string→"string", integer/number→0, boolean→true, format date-time→ISO). Guard `$ref` cycles with a seen-set.

- [ ] **Step 1: Implement** `openapi.ts` with the three helpers + types (study the Scalar refs above for the nav shape + example approach; reimplement in TS).
- [ ] **Step 2: Build** `cd solarch-frontend && export PATH="/run/host/usr/bin:/usr/bin:$HOME/.local/share/pnpm:$PATH" && pnpm build` → PASS (pure TS, type-checked).
- [ ] **Step 3: Commit** `git add src/features/api/reference/openapi.ts && git commit -m "feat(api-ref): OpenAPI helpers — ref resolver, nav tree, example generator"`

---

### Task 2: `MethodBadge`

**Files:** Create `reference/MethodBadge.tsx`.
**Study first:** `$SCALAR/packages/api-reference/src/components/HttpMethod/HttpMethod.vue` + `$SCALAR/packages/api-reference/src/components/OperationsList/OperationsListItem.vue` (method + path row).

**Interface:** `MethodBadge({ method, size? }: { method: string; size?: "sm"|"md" })`. One color map: `{ get:"blue", post:"green", put:"orange", patch:"amber", delete:"red" }` → muted token colors (use a small per-color style, e.g. text + faint bg, no pill-gradient). Mono font, uppercase short label.

- [ ] **Step 1: Implement** (token colors; no slop). **Step 2: Build** → PASS. **Step 3: Commit** `feat(api-ref): MethodBadge`.

---

### Task 3: `SchemaTree` (recursive schema renderer — the crux)

**Files:** Create `reference/SchemaTree.tsx`.
**Study first:** `$SCALAR/packages/api-reference/src/components/Content/Schema/Schema.vue`, `SchemaObjectProperties.vue`, `SchemaProperty.vue`, `SchemaPropertyHeading.vue` (name/type/format/constraints/required), `helpers/get-schema-type.ts`.

**Interface:** `SchemaTree({ doc, schema, required?, name?, depth? })`. Recursion (scoped to our emitter):
- resolve `$ref` (via `resolveRef`); show the `refName` as a "type · ModelName" link/label.
- object → list properties; each row = `SchemaPropertyHeading`-style line (name in mono, type, format, validation chips, `required` marker in `var(--accent)`/orange) + description (prose) + nested `SchemaTree` (depth+1) for object/array-of-object; collapse nested objects with a disclosure (default open ≤ depth 1).
- array → render `items` schema with an "array" type marker.
- enum → small value chips.
- scalar → type + format + constraints inline.
- Cycle guard via a `seen` set of ref names (do not infinitely recurse self-referential schemas).

- [ ] **Step 1: Implement** (faithful to Scalar's recursion, our tokens). **Step 2: Build** → PASS. **Step 3: Commit** `feat(api-ref): SchemaTree recursive renderer`.

---

### Task 4: `OperationView`

**Files:** Create `reference/OperationView.tsx`. (Imports `MethodBadge`, `SchemaTree`, `TryItConsole` (Task 6 — import lazily / accept as prop to avoid ordering; OK to land the Try-it section in Task 6 and leave a placeholder slot here, clearly marked, replaced in Task 6).)
**Study first:** `$SCALAR/.../features/Operation/layouts/ModernLayout.vue` (the operation grid), `components/OperationParameters.vue`, `components/RequestBody.vue`, `components/OperationResponses.vue`, `components/ParameterListItem.vue`, `features/example-responses/ExampleResponses.vue`.

**Interface:** `OperationView({ doc, op, serverUrl, onSend? })` where `op: NavOp`. Layout: a 2-column grid on wide containers (left = details, right = sticky examples), single column when narrow — mirror ModernLayout's `grid-template-areas`. Sections:
- Header: `MethodBadge` + full path (mono) + summary; description (prose, from AI Documentize).
- **Parameters**: group path/query params → a table (name / type / required / description).
- **Request body**: content-type label + `SchemaTree` of the requestBody schema (if any).
- **Responses**: per status code → badge (2xx green / 4xx amber / 5xx red) + description + `SchemaTree` of the response schema + an example JSON block (`exampleFromSchema`).
- **Examples (right, sticky)**: a code sample (curl + fetch, copyable, built from method/path/serverUrl/example body) + the example response JSON.
- **Try it**: render `<TryItConsole>` (Task 6).

- [ ] **Step 1: Implement** (Try-it slot can be a stub comment until Task 6). **Step 2: Build** → PASS. **Step 3: Commit** `feat(api-ref): OperationView (params/body/responses/examples)`.

---

### Task 5: `ApiSidebar`

**Files:** Create `reference/ApiSidebar.tsx`.
**Study first:** `$SCALAR/packages/components/src/components/ScalarSidebar/*` + `$SCALAR/packages/api-reference/src/components/OperationsList/OperationsListItem.vue`.

**Interface:** `ApiSidebar({ doc, selectedId, onSelect })`. Builds nav via `buildNav(doc)` + `listSchemas(doc)`. Renders: a search input (filters operations + schemas by path/summary/name); collapsible tag groups → operation rows (`MethodBadge` + path, active state on `selectedId`); a "Schemas" section listing model names (select → `model:<name>`). Solarch sidebar styling (paper-sunken rail, soft borders, active row = accent-tinted, no slop). Keyboard accessible (rows are buttons).

- [ ] **Step 1: Implement.** **Step 2: Build** → PASS. **Step 3: Commit** `feat(api-ref): ApiSidebar (tags/operations/schemas + search)`.

---

### Task 6: `TryItConsole`

**Files:** Create `reference/TryItConsole.tsx`. Wire it into `OperationView` (replace the Task-4 stub slot).
**Study first:** `$SCALAR/packages/api-reference/src/features/test-request-button/TestRequestButton.vue` + `$SCALAR/packages/api-client/src/v2/blocks/operation-block/helpers/send-request.ts` + `har-to-fetch-request.ts` (request build/send + response shape).

**Interface:** `TryItConsole({ doc, op, serverUrl, onSend? })`. Inputs for path params + query params + (for write methods) a JSON body editor (textarea, prefilled with `exampleFromSchema(requestBody)`). A **Send** button builds the request: `url = serverUrl + path` (substitute `{param}` + append query), method, `Content-Type: application/json`, body. Transport: `onSend ? await onSend({method,url,headers,body}) : await fetch(url, {...})`. Response viewer: status badge + duration + headers + pretty body (mono). Honest error on network/CORS failure with a hint ("is your API running at <serverUrl>? CORS must allow this origin"). `onSend` is the seam Plan 2's VS Code bridge plugs into.

- [ ] **Step 1: Implement** + wire into OperationView. **Step 2: Build** → PASS. **Step 3: Commit** `feat(api-ref): TryItConsole (build/send request + response viewer)`.

---

### Task 7: `SolarchApiReference` orchestrator

**Files:** Create `reference/SolarchApiReference.tsx` (+ a small `SchemaView.tsx` for the models view, or inline).
**Study first:** `$SCALAR/packages/api-reference/src/components/ApiReference.vue` (the 2-area grid) + `Content/Content.vue`.

**Interface:** `SolarchApiReference({ doc, serverUrl?, onSend? }: { doc: OpenApiDoc; serverUrl?: string; onSend?: SendFn })`. State: `selectedId` (default first operation). Layout: 2-pane CSS grid `[sidebar 288px | content 1fr]`, single-column under a container breakpoint. Renders `<ApiSidebar selectedId onSelect>` + content = the selected `OperationView` (or a schema view when `model:<name>` selected). Empty state when `paths` is empty ("No endpoints yet"). PROPS-ONLY (portability rule) — no store/router/query imports.

- [ ] **Step 1: Implement.** **Step 2: Build** → PASS. **Step 3: Commit** `feat(api-ref): SolarchApiReference orchestrator (2-pane)`.

---

### Task 8: Rewire `ApiDocsPanel` + remove `@scalar/api-reference`

**Files:** Modify `solarch-frontend/src/features/api/ApiDocsPanel.tsx`; modify `solarch-frontend/package.json` (remove `@scalar/api-reference`).
**Interface:** `ApiDocsPanel` keeps its current responsibilities (fetch `{doc}` via `useOpenApi`, the "AI Documentize" button via `useDocumentize`, the "Server URL" field, AI-state line) but renders `<SolarchApiReference doc={doc} serverUrl={serverUrl} />` instead of the Scalar component. Remove the `@scalar/api-reference` import + dependency.

- [ ] **Step 1: Rewire** ApiDocsPanel to `SolarchApiReference`; delete the Scalar import/usage.
- [ ] **Step 2: Remove dep** — `pnpm remove @scalar/api-reference`.
- [ ] **Step 3: Build** `pnpm build` → PASS (no dangling Scalar import). **Step 4: Commit** `feat(api-ref): use Solarch-native reference in ApiDocsPanel; drop @scalar/api-reference`.

---

## Self-Review

**Spec coverage (Plan A portion):** portable props-only component tree (Tasks 1-7 ✓: openapi helpers, MethodBadge, SchemaTree, OperationView, ApiSidebar, TryItConsole, SolarchApiReference), rewire + drop Scalar dep (Task 8 ✓), `onSend` seam for Plan 2 (Tasks 6-7 ✓), Solarch tokens + method colors (constraints + Task 2 ✓). The generated-app `/docs` bundle is **Plan B** (deferred).

**No-test-runner adaptation:** frontend has no vitest → each task gates on `pnpm build` (type-check) + the user's live HMR review; pure logic (Task 1) is strongly typed. This matches the project norm (build is the frontend smoke check). NOT a placeholder — a deliberate, codebase-consistent verification choice.

**Type consistency:** `OpenApiDoc`, `NavOp`/`NavGroup`, `SendFn`, `resolveRef`/`buildNav`/`exampleFromSchema` are defined in Task 1 and consumed unchanged by Tasks 3-7. `MethodBadge` color map defined once (Task 2), reused (Tasks 4-5).

## Notes for the executor

- **Study the named Scalar file under `$SCALAR` before writing each component** — the user explicitly required replicating from the real Scalar source, not from guesses. Reimplement structure/behavior in React + our tokens.
- Keep `reference/*` PROPS-ONLY (portability for Plan B). The only data-fetching lives in `ApiDocsPanel` (Task 8).
- Do not introduce a CSS-in-JS lib or copy Scalar's CSS; use Tailwind + the Solarch token classes already used across the app (look at `SketchMap`/`CodegenPanel`/`ViewSwitch` for the established class patterns).
