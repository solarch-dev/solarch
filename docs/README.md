# Solarch documentation

English documentation for the **Solarch OSS** self-host edition.

## Read this first

1. **[Getting started](getting-started.md)** — install, open the app, tour the four surfaces.
2. **[Self-hosting](self-hosting.md)** — env vars, security, exposing on LAN/VPS.
3. **[AI providers](ai-providers.md)** — pick a model provider and API key.

## Product guides

| Document | Topics |
|----------|--------|
| [Canvas & Rules Engine](canvas-and-rules.md) | 21 node types, 16 edge kinds, tabs, whitelist/blacklist, error codes |
| [AI Architect](ai-architect.md) | Agent mode, Instruct chat, GraphRAG patterns, self-correction |
| [Codegen](codegen.md) | Deterministic NestJS scaffold, Surgical AI fill, Agent/Editor modes |
| [CLI & API keys](cli-and-api-keys.md) | Personal access keys, `solarch login`, Basic Auth + CLI |

## Operator & contributor guides

| Document | Topics |
|----------|--------|
| [Architecture](architecture.md) | Monorepo layout, server vs web, request flow |
| [Development](development.md) | Local pnpm workflow, Neo4j migrate, tests |
| [Deployment](deployment.md) | Production Caddy, systemd, backups |

## Quick links

- [Root README](../README.md)
- [`.env.example`](../.env.example)
- [solarch-tools (CLI / MCP)](https://github.com/solarch-dev/solarch-tools)
