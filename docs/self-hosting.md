# Self-hosting Solarch

The whole stack — a vector-native Neo4j, the NestJS server, and the canvas web app behind a
single-origin reverse proxy — runs with one command.

## Requirements

- Docker + Docker Compose
- A [Clerk](https://clerk.com) application (free) for authentication
- An API key for an OpenAI-compatible LLM provider (the AI Architect / chat)

## Quick start

```bash
git clone https://github.com/solarch-dev/solarch.git
cd solarch
cp .env.example .env
# edit .env — set NEO4J_PASSWORD, the Clerk keys, and an LLM provider key
docker compose up --build
# → http://localhost:3000
```

On first boot the server initializes the graph database (schema, the GraphRAG vector index,
and the canonical pattern seed). This is idempotent, so restarts are safe.

## What goes in `.env`

The minimum for a working instance:

| Variable | Why |
|---|---|
| `NEO4J_PASSWORD` | Database password (written on first run; reset the volume to change it later) |
| `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY` | Server-side auth |
| `VITE_CLERK_PUBLISHABLE_KEY` | Same publishable key, baked into the web build |
| `DEEPSEEK_API_KEY` (or a Bedrock block) | AI Architect / chat |

Everything else (Polar billing, PostHog analytics, guest mode) is optional and degrades
gracefully when left blank. See `.env.example` for the full annotated list.

> **Note on the web build:** Vite inlines `VITE_*` variables at build time, so the web image
> is built locally with your keys via `docker compose up --build`. Change a `VITE_*` value →
> rebuild (`docker compose up --build`).

## How it fits together

- **neo4j** — graph + vector store (APOC enabled). Internal network only.
- **server** — NestJS API on `:4000` (internal). Binds `0.0.0.0` inside its container.
- **web** — Caddy serving the built SPA and reverse-proxying `/api/*` to the server. This is
  the only service published to the host (`:3000`). Single origin keeps the Clerk
  `__session` cookie valid for both the app and the API.

## Local development (without Docker)

```bash
pnpm install
pnpm db:up                 # start just Neo4j in Docker
cp apps/server/.env.example apps/server/.env   # fill in keys
cp apps/web/.env.example apps/web/.env
pnpm dev                   # web (Vite) + server (Nest) together via Turborepo
```

The Vite dev server proxies `/api` to the server on `:4000`, mirroring the production
single-origin setup.

## Optional: data enrichment migrations

Beyond the automatic first-boot setup, a few optional data-enrichment migrations exist for
richer node-type metadata. Run them against a running stack if needed:

```bash
docker compose exec server sh -lc 'node_modules/.bin/tsx src/neo4j/migrations/data/001-enrich-faz-a.ts'
# ...002, 003, 005-tabs.ts as desired
```
