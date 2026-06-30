# Solarch Server (OSS)

Architecture graph backend for the self-hosted Solarch monorepo. Node/edge CRUD, Rules Engine, GraphRAG, AI architect, and codegen.

## Stack

- **NestJS 11** — modular API, global Zod validation, typed error envelope
- **Neo4j 5** — graph storage + native vector index (GraphRAG)
- **Zod 4 + nestjs-zod** — node/edge schemas, OpenAPI in dev
- **LangChain** — multi-provider LLM (OpenAI, Anthropic, Ollama, DeepSeek, …)
- **@xenova/transformers** — local embeddings (default, offline-capable)
- **Vitest + Testcontainers** — unit and e2e tests

## Auth (OSS)

Every HTTP request is handled by **`LocalAuthGuard`**:

- Browser / same-origin SPA → fixed local owner (`LOCAL_USER_ID`, default `local_owner`)
- CLI / MCP → `Authorization: Bearer slk_*` or `X-Solarch-Api-Key: slk_*`

See [CLI & API keys](../../docs/cli-and-api-keys.md) and [Self-hosting](../../docs/self-hosting.md).

## Dev commands

```bash
pnpm install
pnpm neo4j:up
pnpm neo4j:migrate   # from apps/server with .env
pnpm dev             # http://localhost:4000/api/v1
pnpm test            # unit
pnpm test:e2e        # e2e (Testcontainers, first run ~2 min)
```

## Environment

Copy root [`.env.example`](../../.env.example) and see [`src/config/env.ts`](src/config/env.ts). Provider choice is required (`LLM_*_PROVIDER` + matching API key).

## Documentation

Full OSS documentation: **[`docs/README.md`](../../docs/README.md)** (index).

| Guide | Link |
|-------|------|
| Getting started | [docs/getting-started.md](../../docs/getting-started.md) |
| Canvas & Rules | [docs/canvas-and-rules.md](../../docs/canvas-and-rules.md) |
| AI Architect | [docs/ai-architect.md](../../docs/ai-architect.md) |
| Codegen | [docs/codegen.md](../../docs/codegen.md) |
| Development | [docs/development.md](../../docs/development.md) |
| Deployment | [docs/deployment.md](../../docs/deployment.md) |

## License

[PolyForm Noncommercial](../../LICENSE)
