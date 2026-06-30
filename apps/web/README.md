# Solarch Web (OSS)

Architecture builder UI for the self-hosted Solarch monorepo. Custom Canvas 2D engine, rule-driven interactions, and a natural-language AI OmniBar — no login screen.

## Stack

- **Vite + React 19 + TypeScript** — fast HMR
- **Custom Canvas 2D** — under `src/canvas/` (dual-canvas, viewport culling)
- **openapi-fetch + openapi-typescript** — typed API client from backend OpenAPI
- **TanStack Query 5** — server state
- **Zustand** — view-local state (zoom, pan, selection, theme)
- **react-router-dom 7** — `/start`, `/projects/:id/:tabId`

## Development

```bash
pnpm install
pnpm dev:web    # http://localhost:5173 — proxies /api → :4000
pnpm build:web
```

Run the API from `../server` or `docker compose up` from the monorepo root.

## Key folders

```
src/
├── api/           # typed client + TanStack Query hooks
├── canvas/        # render engine (outside React)
├── components/    # TopBar, OmniBar, Inspector, …
├── features/      # canvas, codegen, settings, welcome
└── state/         # workspace + theme stores
```

## Documentation

- [Root README](../../README.md) — product overview & quick start
- [Docs index](../../docs/README.md) — full guide list
- [Getting started](../../docs/getting-started.md) — four surfaces tour

## License

[PolyForm Noncommercial](../../LICENSE)
