# CLI & API keys

The OSS web app has **no login**. Automation (CLI, MCP, scripts) uses **personal API keys**
prefixed with `slk_`.

## Browser vs CLI identity

| Client | Identity |
|--------|----------|
| **Browser** (same origin) | Fixed local owner — `LOCAL_USER_ID` (default `local_owner`). No header required. |
| **CLI / MCP / curl** | `Authorization: Bearer slk_…` **or** `X-Solarch-Api-Key: slk_…` |

Keys are stored as SHA-256 hashes in Neo4j; plaintext is shown **once** at creation.

## Create a key

1. Open the app → **Settings**.
2. **Create API key** — copy the `slk_…` value immediately.
3. Limit: 10 keys per local owner (OSS single-user instance).

Manage keys: `POST/GET/DELETE /api/v1/api-keys` (authenticated as local owner or via existing key).

## Solarch CLI

The CLI lives in [**solarch-tools**](https://github.com/solarch-dev/solarch-tools):

```bash
npm install -g @solarch/cli   # or use npx
solarch login                 # paste slk_ key; stored locally
solarch projects list
```

Typical flows:

- Pull/push graph deltas against `graphRevision` (conflict-aware retry).
- Report implementation progress from your real codebase.
- Integrate with CI or editor workflows.

Point the CLI at your instance base URL (e.g. `http://localhost:3000` or your VPS hostname).

## MCP server

The MCP package in **solarch-tools** exposes graph read tools and rule-checked mutations for AI
agents in Cursor, Claude Desktop, etc. Authenticate with the same `slk_*` key.

## Basic Auth + API key (LAN/VPS)

When [HTTP Basic Auth](self-hosting.md#lan--remote) is enabled, Caddy consumes
`Authorization: Basic …`. The CLI's Bearer key cannot share that header.

Use **two headers**:

```bash
curl -u "$SOLARCH_BASIC_AUTH_USER:$PASSWORD" \
  -H "X-Solarch-Api-Key: slk_your_key" \
  https://your-host.example/api/v1/projects
```

SSE (AI streaming) works through the same Basic Auth session in the browser.

## Graph revision & conflicts

Project graph carries a **`graphRevision`** counter. Batch `POST …/graph/apply` accepts
`baseRevision`; stale clients receive `409 ERR_GRAPH_REVISION_CONFLICT` with
`currentRevision` for re-pull.

CLI push implements automatic re-pull + single retry — safe for scripted updates.

## Security notes

- Treat `slk_*` like passwords — especially on internet-exposed hosts (always pair with Basic Auth).
- Keys grant full access to projects on that instance under the local owner.
- Rotate by deleting old keys in Settings and issuing new ones.

## See also

- [Self-hosting](self-hosting.md) — exposure profiles and rate limits.
- [Development](development.md) — local API base URL for CLI testing.
- [Canvas & Rules Engine](canvas-and-rules.md) — what mutations the CLI may apply.
