# Self-hosting Solarch

Configuration and security for running Solarch OSS on your own infrastructure.

For install steps and a first-run tour, see [Getting started](getting-started.md).

## Required configuration

| Variable | Purpose |
|---|---|
| `NEO4J_PASSWORD` | Neo4j database password (set on first volume init) |
| `LLM_GENERATION_PROVIDER` | AI Architect provider (`openai`, `anthropic`, `ollama`, …) |
| `LLM_CHAT_PROVIDER` | Usually same as generation |
| Provider API key | e.g. `OPENAI_API_KEY` for OpenAI |

Both LLM provider variables are **required** — there is no silent default in code. The install
wizard pre-fills OpenAI; copy [`.env.example`](../.env.example) uses the same.

## Quick start (reference)

```bash
git clone https://github.com/solarch-dev/solarch.git && cd solarch
./install.sh
docker compose up --build
```

Open **http://localhost:3000** — fixed local owner identity, no login screen.

## Security / exposure

Solarch OSS has **no in-app login**. Security is network-boundary + optional edge auth.

| Profile | `BIND_ADDRESS` | Basic auth | Who can reach it |
|---|---|---|---|
| **Local (default)** | `127.0.0.1` | off | This machine only |
| **LAN / VPS** | `0.0.0.0` | **required** | Your network / internet (with password) |

### Local (recommended default)

```env
BIND_ADDRESS=127.0.0.1
# SOLARCH_BASIC_AUTH_* unset
```

Docker binds port 3000 to loopback only — other devices cannot connect.

### LAN / remote

Use `./install.sh` option **2**, or set manually:

```env
BIND_ADDRESS=0.0.0.0
SOLARCH_BASIC_AUTH_USER=solarch
SOLARCH_BASIC_AUTH_HASH=<bcrypt hash from: caddy hash-password --plaintext 'your-password'>
```

The browser shows a native HTTP Basic Auth prompt. SSE (AI streaming) works through the same session.

**Before exposing to the internet:** enable basic auth, use a strong Neo4j password, and restrict port 3000 in your firewall (e.g. `ufw allow from 192.168.1.0/24 to any port 3000`).

Alternatives: Tailscale, Cloudflare Access, or SSH tunnel to `127.0.0.1:3000`.

### CLI behind Basic Auth

Caddy uses `Authorization: Basic …`; the CLI uses `Authorization: Bearer slk_…` — one header cannot carry both. Pass the API key separately:

```bash
curl -u "$SOLARCH_BASIC_AUTH_USER:$PASSWORD" \
  -H "X-Solarch-Api-Key: slk_your_key" \
  http://your-host:3000/api/v1/projects
```

Details: [CLI & API keys](cli-and-api-keys.md).

## Optional variables

| Variable | Default | Purpose |
|---|---|---|
| `LOCAL_USER_ID` | `local_owner` | Identity for browser sessions |
| `PUBLIC_URL` | `http://localhost:3000` | Public URL (CORS) |
| `LLM_MODEL` | provider default | Model override |
| `THROTTLE_BY` | `ip` | Rate limit key: `ip` or `user` |
| `THROTTLE_LIMIT` | `60` | Global requests per minute |
| `THROTTLE_TTL_MS` | `60000` | Rate limit window |
| `AI_THROTTLE_LIMIT` | `20` | AI endpoint requests per minute |
| `CODEGEN_FILL_THROTTLE_LIMIT` | `10` | Surgical fill requests per minute |

Embeddings (GraphRAG) default to local ONNX — see [AI Architect](ai-architect.md).

## API keys (CLI)

Create keys in the app under **Settings** → use with `solarch login` and MCP/CLI tools.
See [CLI & API keys](cli-and-api-keys.md).

## AI providers

See [ai-providers.md](ai-providers.md) for the full provider list and Ollama local setup.
Agent vs Instruct behavior: [AI Architect](ai-architect.md).

## Production deployment

Caddy, systemd, backups: [Deployment](deployment.md).

## See also

- [Getting started](getting-started.md)
- [Architecture](architecture.md)
- [Development](development.md)
