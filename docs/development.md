# Development

Guide for running Solarch from source (without the all-in-one Docker bundle).

## Prerequisites

- Node.js **≥ 20.19**
- **pnpm 10** (see root `packageManager` field)
- **Docker** — for Neo4j (`apps/server/docker-compose.yml` or root compose)
- LLM provider env vars (same as production)

## Clone & install

```bash
git clone https://github.com/solarch-dev/solarch.git
cd solarch
pnpm install
```

Monorepo layout: **pnpm workspaces** + **Turborepo**. Root scripts fan out to `apps/web` and
`apps/server`.

## Environment

```bash
cp .env.example .env
# Required: NEO4J_PASSWORD, LLM_GENERATION_PROVIDER, LLM_CHAT_PROVIDER, provider API key
```

For split dev (web on 5173, server on 4000), keep `CORS_ORIGIN=http://localhost:5173` in server
env when not using the Vite proxy-only flow.

## Neo4j

From `apps/server/`:

```bash
pnpm neo4j:up        # docker compose up -d (Neo4j only)
pnpm neo4j:migrate   # constraints + vector index (needs .env with NEO4J_*)
```

Or use root `docker compose up neo4j -d` if you prefer the full stack file.

## Run dev servers

**Terminal 1 — API:**

```bash
pnpm dev:server      # NestJS watch → http://localhost:4000/api/v1
                     # Scalar docs → http://localhost:4000/api/v1/docs (non-production)
```

**Terminal 2 — Web:**

```bash
pnpm dev:web         # Vite → http://localhost:5173
                     # proxies /api → :4000
```

Open **http://localhost:5173** during development.

## Tests

```bash
pnpm test:server     # unit tests (820+), excludes heavy Docker specs by default
```

From `apps/server/`:

```bash
pnpm test            # all unit specs in src/
pnpm test:e2e        # Testcontainers Neo4j + HTTP e2e (Docker required, ~2 min first run)
pnpm test:codegen-gate  # codegen golden gate
```

Vitest injects minimal `NEO4J_*` and `LLM_*` env for imports — see `vitest.config.ts`.

## Build smoke check

```bash
pnpm build           # turbo: server + web production builds
```

There is no separate typecheck script — `next build` / `nest build` enforce types.

## OpenAPI client sync

Web types come from the server OpenAPI document. After API changes, regenerate from `apps/web/`
(if a generate script exists in package.json) or run the documented openapi-typescript step in
that package.

## Optional: solarch-tools sibling checkout

Surgical fill and import resolution look for:

```
../solarch-tools/packages/cli/dist/index.js
```

relative to the server cwd. Clone [solarch-tools](https://github.com/solarch-dev/solarch-tools)
next to the monorepo for local CLI dev; Docker images bundle a release CLI.

## Project-specific READMEs

- [`apps/server/README.md`](../apps/server/README.md) — server stack and auth model.
- [`apps/web/README.md`](../apps/web/README.md) — canvas UI folders.

## See also

- [Architecture](architecture.md) — how web and server connect.
- [Self-hosting](self-hosting.md) — production env reference.
- [Deployment](deployment.md) — Caddy/systemd when you leave dev mode.
