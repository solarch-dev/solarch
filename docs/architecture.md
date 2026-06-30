# Architecture

Solarch is a monorepo with two deployable apps that share one thesis: **architecture is
generated first, validated by a strict Rules Engine, and only correct graphs ever land**.

```
solarch/
  apps/
    web/      Vite + React 19 — the canvas editor (custom Canvas 2D renderer)
    server/   NestJS 11 + Neo4j — graph model, Rules Engine, AI, codegen
  deploy/     Caddyfile (single-origin reverse proxy)
  docs/       this folder
```

Tooling: pnpm workspaces + Turborepo. One lockfile, `pnpm build` / `pnpm dev` fan out to both
apps. The published `@solarch/*` packages (CLI, ast-core, MCP, VS Code extension) live in the
separate [`solarch-tools`](https://github.com/solarch-dev/solarch-tools) repo; the server
depends on `@solarch/cli` from npm for the surgical-fill engine.

## Server (`apps/server`)

A NestJS API over a Neo4j graph. The graph **is** the source of truth.

- **Rules Engine** (`src/rules`) — a deterministic gate over every mutation: whitelist rules,
  anti-patterns, and conditional checks. Illegal edges never commit.
- **AI** (`src/ai`) — an agentic LLM loop with atomic tool calls (create/update node, create
  edge, apply graph). Rejections from the Rules Engine feed back into the agent state until
  the graph is clean.
- **GraphRAG** (`src/patterns`, `src/embeddings`) — local ONNX embeddings (multilingual,
  384-d) + a Neo4j vector index over a canonical pattern library. The agent retrieves
  patterns before generating; no blank context.
- **Codegen** (`src/codegen`) — a deterministic IR + NestJS emitters. The "Constructor"
  turns the graph into code without AI; **Surgical AI** fills only method bodies (run as a
  `@solarch/cli` subprocess for isolation).
- **Type-safety** — Zod schemas → OpenAPI → typed client. The API contract is a compile-time
  check on the frontend.

The server binds `127.0.0.1` by default (single-box: only the local reverse proxy reaches
it). Set `HOST=0.0.0.0` in containerized deployments.

## Web (`apps/web`)

A Vite + React 19 SPA with a custom Canvas 2D renderer (dual-canvas, viewport culling, 60fps).

- **State** — Zustand stores + TanStack Query; the typed `openapi-fetch` client talks to the
  server with the Clerk session.
- **Surfaces** — Canvas (Technical / Simple), Code (Agent / Editor), API, and Docs, switched
  from one control in the top bar.
- **API contract** — `src/api/schema.d.ts` is generated from the server's OpenAPI via
  `openapi-typescript`, so a backend change that breaks the contract breaks the web build.

The SPA calls a relative `/api`; in dev the Vite proxy forwards it to the server, and in
production Caddy proxies it same-origin (so the Clerk `__session` cookie is valid for both).

## Data flow (one request)

1. The web app sends a typed request to `/api/v1/...` (Clerk session attached).
2. The server validates the body (Zod), applies the mutation through the Rules Engine, and
   persists to Neo4j — or rejects with a structured error.
3. For AI requests, the agent retrieves patterns (GraphRAG), proposes graph operations, and
   loops against the Rules Engine until valid.
4. Codegen projects the validated graph to deterministic code; Surgical AI fills bodies.
