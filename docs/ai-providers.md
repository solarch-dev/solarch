# AI providers

Solarch's AI runs **server-side, with your own API key** (bring-your-own-key). There is no
Solarch-hosted AI in a self-host install — requests go straight from your server to the
provider you configure. The frontend is provider-agnostic; switching providers is purely a
server config change.

## How AI is used

- **Agent (architecture generation)** — a multi-turn tool-calling loop. The model proposes
  graph operations (`create_node`, `create_edge`, …); the **Rules Engine** validates each one,
  and rejections feed back until the graph is clean. This path **requires a tool-calling-capable
  model**.
- **Instruct (chat)** — ask questions about your design; streamed free-text answers.
- **Embeddings (GraphRAG)** — run **locally** by default (on-box ONNX, multilingual, 384-d, no
  key). The Docker image pre-fetches the model, so it works fully offline.

If the active provider has no key, the AI endpoints return `503` and the rest of the app keeps
working.

## Supported providers

Set `LLM_GENERATION_PROVIDER` (and `LLM_CHAT_PROVIDER`) to one of the ids below, then set that
provider's key. Optionally set `LLM_MODEL` to override the default model.

| Provider id | Env key(s) | Default model | Tool calling | Notes |
|---|---|---|---|---|
| `openai` | `OPENAI_API_KEY` (`OPENAI_BASE_URL` for Azure) | `gpt-4o` | ✓ | |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-3-5-sonnet-latest` | ✓ | Claude |
| `google` | `GOOGLE_API_KEY` | `gemini-1.5-pro` | ✓ | Gemini |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-v4-pro` / `-flash` | ✓ | Default; proven tool calling |
| `mistral` | `MISTRAL_API_KEY` | `mistral-large-latest` | ✓ | |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | ✓ | Fast inference |
| `openrouter` | `OPENROUTER_API_KEY` | `openai/gpt-4o` | ✓* | Gateway to 300+ models; `LLM_MODEL` = `vendor/model` |
| `ollama` | `OLLAMA_BASE_URL` | `llama3.1` | ✓* | Local / offline, no key |
| `bedrock` | `BEDROCK_API_KEY` + `BEDROCK_BASE_URL` | `BEDROCK_MODEL` | ✓ | OpenAI-compatible endpoint |
| `openai-compatible` | `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` | — | ✓* | xAI, Together, Fireworks, vLLM, LM Studio, … |

`*` model-dependent — for the Architect, choose a model that supports tool calling.

## Switching provider

- **Wizard:** re-run `./install.sh` (or `./install.ps1`) and pick a different provider.
- **By hand:** edit `.env` (`LLM_GENERATION_PROVIDER` / `LLM_CHAT_PROVIDER` + the key), then
  recreate the server: `docker compose up -d --build`. (Env is read at startup.)

### Ollama (fully local, private)

Run [Ollama](https://ollama.com) on the host, then set `LLM_GENERATION_PROVIDER=ollama`. From
inside Docker, point at the host: `OLLAMA_BASE_URL=http://host.docker.internal:11434` and set
`LLM_MODEL` to a tool-calling-capable model (e.g. `llama3.1`). No API key, no data leaves the box.

## Billing / metering

Self-host runs with `BILLING_ENABLED=false` (the default in `docker-compose.yml`), which
bypasses all metering — **unlimited** AI and code generation with your own key. The paid SaaS
sets `BILLING_ENABLED=true` to enforce plan limits via Polar.
