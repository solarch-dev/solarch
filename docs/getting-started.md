# Getting started

This guide gets you from zero to a running Solarch instance and your first architecture on
the canvas in about ten minutes.

## Install

### Option A — install wizard (recommended)

```bash
git clone https://github.com/solarch-dev/solarch.git
cd solarch
./install.sh          # Linux / macOS
# or: ./install.ps1   # Windows PowerShell
```

The wizard asks for:

1. **Neo4j password** — stored in `.env` as `NEO4J_PASSWORD` (used on first database init).
2. **AI provider** — e.g. OpenAI, Anthropic, Ollama, DeepSeek. It writes `LLM_GENERATION_PROVIDER`,
   `LLM_CHAT_PROVIDER`, and the matching API key into `.env`.
3. **Exposure profile** — local-only (`127.0.0.1`) or LAN/VPS with optional HTTP Basic Auth.

Then start the stack:

```bash
docker compose up --build
```

First build can take several minutes (embeddings model prefetch, image build).

### Option B — manual

```bash
cp .env.example .env
# Edit .env: NEO4J_PASSWORD, LLM_GENERATION_PROVIDER, LLM_CHAT_PROVIDER, provider API key
docker compose up --build
```

See [Self-hosting](self-hosting.md) for every env variable.

## Open the app

Navigate to **http://localhost:3000**.

There is **no login screen**. The OSS edition assigns a fixed local owner identity
(`LOCAL_USER_ID`, default `local_owner`). Your browser session owns all projects on this instance.

You should land on **Welcome** or an existing project and then the **Canvas**.

## The four surfaces

Use the central switch in the top bar to move between product modes on the same project:

| Surface | Purpose |
|---------|---------|
| **Canvas** | Draw and inspect architecture — Technical view (full graph) or Simple view (high-level). |
| **Code** | Generate NestJS from the graph; **Agent** (Surgical AI chat) or **Editor** (plain files). |
| **API** | Project-scoped OpenAPI reference and a localhost test client. |
| **Docs** | In-app node/edge library and keyboard shortcuts. |

The core loop: design on **Canvas** → validate via the **Rules Engine** → **Generate Code** →
refine in **Code** → explore endpoints in **API**.

## First steps on the canvas

1. **Create or open a project** — Welcome flow creates one automatically; tabs organize sub-views
   of the same project.
2. **Add nodes** — palette or inspector: Table, Service, Controller, Repository, DTO, …
   (21 types — see [Canvas & Rules Engine](canvas-and-rules.md)).
3. **Connect nodes** — drag edges; illegal connections show a rule error immediately.
4. **AI Architect** — bottom **OmniBar**: describe what you want in natural language (Agent mode).
   The model proposes nodes and edges; the Rules Engine approves or rejects each step.
5. **Generate code** — command palette or top bar → **Generate Code** (NestJS skeleton from the
   graph). See [Codegen](codegen.md).

## Settings & API keys

Open **Settings** from the top bar:

- **API keys** — create `slk_*` personal access keys for the [Solarch CLI](cli-and-api-keys.md)
  and MCP tools. Keys are shown once; store them safely.
- **Theme** — light / dark / system.

Browser sessions do not need a key. CLI and automation use `Authorization: Bearer slk_…` or
`X-Solarch-Api-Key: slk_…`.

## Verify AI is working

1. Confirm `.env` has `LLM_GENERATION_PROVIDER`, `LLM_CHAT_PROVIDER`, and the provider's API key.
2. Restart after env changes: `docker compose up -d --build`.
3. On the canvas, open the OmniBar and ask the Agent to add a small CRUD stack (e.g. "User table,
   service, controller").
4. If the provider is misconfigured, `/ai/*` returns **503**; the rest of the app still works.

Provider details: [AI providers](ai-providers.md). Behavior: [AI Architect](ai-architect.md).

## Next steps

- [Canvas & Rules Engine](canvas-and-rules.md) — what you can connect and why rejections happen.
- [Self-hosting](self-hosting.md) — expose on LAN, Basic Auth, rate limits.
- [Development](development.md) — run web + server without Docker for hacking on the repo.
