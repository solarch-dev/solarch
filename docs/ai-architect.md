# AI Architect

Solarch's AI runs **on your server** with **your API key**. There is no Solarch-hosted model in
the OSS edition. The frontend is provider-agnostic — switching models is a `.env` change.

See [AI providers](ai-providers.md) for configuration. This document explains *how* AI is used.

## Two modes

| Mode | UI | Behavior |
|------|-----|----------|
| **Agent** | OmniBar (Agent) | Multi-turn **tool-calling** loop. Builds/refactors the graph with atomic operations. |
| **Instruct** | OmniBar (Instruct) | Streaming **chat** about the current design — explanations, reviews, no graph writes. |

Agent mode **requires a tool-calling-capable model**. Instruct mode works with any chat model.

## Agent loop (architecture generation)

The Agent does **not** emit one big JSON graph. It calls tools such as:

- `create_node`, `update_node`, `delete_node`
- `create_edge`, `delete_edge`
- `get_node` (read back properties)

Each write goes through the same path as the UI:

1. Zod validation on properties.
2. Rules Engine on edges.
3. Commit to Neo4j — or structured rejection.

When a tool fails (e.g. `ERR_NOT_WHITELISTED`), the error **message and suggestion** return to
the model, which is expected to fix direction or schema and retry. The loop continues until the
user's request is satisfied or limits are hit.

You can **Continue** after a pause — the agent sees the current graph state; it does not recreate
from scratch.

## GraphRAG (pattern retrieval)

Before generation, the server:

1. Embeds your prompt with a **local multilingual model** (default: ONNX via
   `@xenova/transformers`, 384 dimensions, offline-capable).
2. Searches a **canonical pattern library** in Neo4j (vector index, cosine similarity).
3. Injects top matches into the system prompt as **reference patterns**.

This gives the model proven scaffolding (e.g. layered CRUD) instead of a blank slate. Embeddings
do not require an external API key in the default setup.

Configure via `EMBED_PROVIDER`, `EMBED_MODEL`, `EMBED_TOP_K`, `EMBED_MIN_SCORE` in `.env`.

## System prompt & rules grounding

The system prompt embeds the live **whitelist matrix** (legal `source → edge → target` triples)
so the model knows passive nodes must be targets, Controller→Table shortcuts are forbidden, etc.

This stays in sync with the Rules Engine because both read the same registry — the prompt cannot
drift from enforcement.

## Streaming

Agent responses stream to the UI (SSE). Tool results and progress events interleave with text.
Instruct mode streams free-form markdown answers.

Rate limits: global throttling plus tighter limits on AI endpoints (`AI_THROTTLE_LIMIT` in
`.env`). See [Self-hosting](self-hosting.md).

## Failure behavior

| Condition | Result |
|-----------|--------|
| Provider key missing / invalid | `503` on `/ai/*`; canvas and codegen still work |
| Rule rejection | Tool error returned to model; user sees progress, not a hard crash |
| Max turns reached | Paused state; user can Continue |

OSS has **no metering** — usage is limited only by your provider quota and hardware.

## Tips for reliable Agent output

1. Pick a model known for **tool calling** (GPT-4o, Claude 3.5+, DeepSeek v4, Llama 3.1+ on
   Ollama, …).
2. Start with a clear bounded ask ("REST API for users: table, service, controller, DTO").
3. If edges keep failing, check [Canvas & Rules Engine](canvas-and-rules.md) — the suggestion
   text usually names the legal direction.

## See also

- [AI providers](ai-providers.md) — provider matrix and Ollama setup.
- [Canvas & Rules Engine](canvas-and-rules.md) — error codes the agent sees.
- [Codegen](codegen.md) — AI for method bodies (Surgical fill), separate from graph Agent.
