# solarch-frontend

Solarch's architecture builder UI. **Smooth custom Canvas 2D**, rule-driven interactions, and a natural language AI Omni-Bar — all in one app. Not React Flow, not DOM — its own render engine drawing hundreds of nodes at 60fps.

## Stack

- **Vite 8 + React 19 + TypeScript 6** — fast HMR, erasable syntax
- **Custom Canvas 2D engine** — under `src/canvas/`, **outside** React: dual-canvas (static + interactive), viewport culling, `requestAnimationFrame` throttle, devicePixelRatio, `ResizeObserver`, `arcTo`-based rounded rect (browser-independent)
- **openapi-fetch + openapi-typescript** — `schema.d.ts` generated from backend Zod schemas, **typed API client**
- **TanStack Query 5** — server state, cache, invalidation
- **Zustand** — view-local state (zoom, pan, selection)
- **react-router-dom 7** — `/projects`, `/projects/:id/:tabId`
- **IBM Plex Sans/Mono** — system-aware, engineer aesthetic

## Aesthetic: Light Technical Blueprint

Light background · thin blue grid · family-colored node accents · soft borders · sans-serif only. Linear/Vercel premium feel — *animation polish > ambition*.

## Features

- **Drag-and-drop node positioning** → debounced layout save to backend
- **Right-click + Add Node menu** — pick from 21 node types, family-color accented
- **Arrow drawing (port-drag)** — only edge kinds **allowed by the Rules Engine** light up (gray-out default-deny)
- **Edge Picker** — bottom Omni-Bar style panel, rule-compliant kind selection
- **AI Omni-Bar** — architecture generation from natural language (`/ai/chat`), error details shown as real messages; AI-added elements arrive as **green proposals** with Approve/Reject
- **Inline AI expansion** — right-click or drag from a node to grow the diagram in place
- **Auto-arrange** — dagre-based layout; triggers automatically when the AI adds edges
- **Pan / zoom** — mouse wheel + drag, viewport-aware
- **Multi-select** — rubber-band, bulk movement of multiple nodes
- **Multi-tab** — fully aligned with the backend's single-home + reference model
- **Auth & guest mode** — Clerk sign-in, or draw one project as a guest; the drawing migrates to your account on sign-up
- **Onboarding tour** — one-time spotlight tour for new users, ends with an Omni-Bar hint
- **Billing** — Polar subscriptions; AI quotas on a rolling 4-hour window, `zip`/Generate Code gated to Build+
- **Code generation** — NestJS scaffold from the graph, zip assembled client-side
- **Settings → API Keys** — create/copy-once/delete `slk_…` keys for the [Solarch CLI](../solarch-tools/) (`solarch login`)

## Folder structure

```
src/
├── api/                 # openapi-fetch client + TanStack Query hooks
│   ├── client.ts        # unwrap + ApiError (+ guest token headers)
│   ├── projects.ts      # useProjects, useProject
│   ├── tabs.ts          # useTabGraph, useSaveLayout
│   ├── nodes.ts         # useCreateNode (with templates)
│   ├── edges.ts         # useCreateEdge (IsAsync default)
│   ├── rules.ts         # legalEdgeKinds
│   ├── ai.ts            # useAiChat (SSE stream), isAiActive (auto-arrange grace)
│   ├── api-keys.ts      # useApiKeys / create / delete (CLI credentials)
│   ├── billing.ts       # subscription + quota state
│   └── codegen.ts       # generate + zip download
├── canvas/              # render engine — outside React
│   ├── types.ts         # NODE_W, NODE_H, PORT_R
│   ├── families.ts      # type → family → color, nameOf
│   ├── node-templates.ts # minimal-valid props for 21 types
│   ├── renderer.ts      # drawScene: dot grid, nodes, edge trunks/jumps, proposals
│   └── CanvasView.tsx   # hit-test, drag, pan/zoom, port-drag, rubber-band, auto-arrange
├── components/          # TopBar, BottomBar, Inspector, CommandPalette, ui/
├── features/
│   ├── auth/            # Clerk pages + guest mode + project claim
│   ├── canvas/          # ProjectPage + AddNodeMenu + EdgePicker + OmniBar + inline AI
│   ├── billing/         # plans, quota banners
│   ├── codegen/         # generate panel + zip
│   ├── onboarding/      # OnboardingTour + OmniBar hint
│   ├── settings/        # SettingsPage (API Keys)
│   └── welcome/         # /start project hub
└── index.css            # Blueprint design tokens
```

## Development

```bash
# 1. Dependencies
pnpm install

# 2. Backend must be running (:4000)
#    See: ../solarch-backend

# 3. Dev server
pnpm dev               # http://localhost:5173

# 4. Production build
pnpm build
```

**Backend proxy:** `vite.config.ts` proxies `/api → http://localhost:4000` → no CORS in dev.

## Backend relationship

- The API contract is generated from the backend's OpenAPI/Scalar spec into `schema.d.ts` via `openapi-typescript` → 100% typed client.
- The backend's `ok()` envelope is unwrapped with `unwrap()`, errors are converted to `ApiError`; the Omni-Bar displays these to the user as real messages.
- Layout (position changes) uses a debounced `PATCH /tabs/:id/layout` — doesn't save while dragging, fires when you stop.

## Performance notes

- React **never touches the canvas** — nodes aren't triggered by React, just raw `drawScene` calls. Targeting 60fps even with 500+ nodes.
- **Viewport culling**: off-screen nodes don't even get a `ctx.fillRect` call.
- **rAF throttle**: single render scheduler per frame — no pointermove spam leaking through.
- **StrictMode rAF cleanup**: `raf.current = 0` after `cancelAnimationFrame` — render doesn't block on remount (known StrictMode pitfall).

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| Foundation | Vite/React/TS skeleton, design tokens, router | ✅ |
| Canvas v1 | Render engine, hit-test, drag, pan/zoom | ✅ |
| Interactions | AddNodeMenu, EdgePicker (with Rules), port-drag | ✅ |
| AI | Omni-Bar + real error messages + green proposals + inline expansion | ✅ |
| Node inspector | Properties editing (type-aware variant) | ✅ |
| Auth & billing | Clerk + guest mode + Polar + quotas | ✅ |
| Codegen | NestJS scaffold + client-side zip | ✅ |
| Settings | API Keys for the Solarch CLI | ✅ |
| Edge aesthetics | Trunk bundling, edge jumps, transparent labels, auto-arrange | ✅ |
| Live presence | "Someone else changed this" notifications (graphRevision-aware) | ⏳ Phase 4 |
| Polish | Mini-map, pattern search in Omni-Bar | ⏳ |

## License

Not yet licensed.
