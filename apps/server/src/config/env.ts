import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  // Bind address. Default 127.0.0.1 (single-box: only the local reverse proxy reaches
  // the backend). In Docker each service is its own container, so the proxy container
  // cannot reach loopback — set HOST=0.0.0.0 there (the port is not published to the host).
  HOST: z.string().default("127.0.0.1"),
  NEO4J_URI: z.string().url(),
  NEO4J_USER: z.string().min(1),
  NEO4J_PASSWORD: z.string().min(1),
// Connection pool / timeout — against "connection not available" under load.
// Reasonable for single-box launch; increase if necessary.
  NEO4J_MAX_POOL_SIZE: z.coerce.number().int().positive().default(50),
  NEO4J_CONNECTION_ACQUISITION_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  NEO4J_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  NEO4J_MAX_TX_RETRY_TIME_MS: z.coerce.number().int().positive().default(30_000),
  NEO4J_MAX_CONNECTION_LIFETIME_MS: z.coerce.number().int().positive().default(3_600_000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // Self-host local owner id (LocalAuthGuard fallback when no API key is sent).
  LOCAL_USER_ID: z.string().default("local_owner"),

  // ── AI providers — required; if the active provider's key is missing, /ai/* returns 503.
  // generation = architecture generation + tool calling; chat = instruct/dialogue.
  // Set both to the same provider unless you intentionally split tiers.
  // (Registry + per-provider quirks live in src/ai/providers/llm.factory.ts.)
  LLM_GENERATION_PROVIDER: z.enum([
    "openai", "anthropic", "google", "deepseek", "mistral", "groq", "openrouter", "ollama", "bedrock", "openai-compatible",
  ]),
  LLM_CHAT_PROVIDER: z.enum([
    "openai", "anthropic", "google", "deepseek", "mistral", "groq", "openrouter", "ollama", "bedrock", "openai-compatible",
  ]),
  // Optional model override for the ACTIVE provider (else the registry's default model is used).
  LLM_MODEL: z.string().optional(),

  // Per-provider keys (first-class LangChain integrations). Set the one you selected.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(), // Azure / OpenAI-compatible override
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(), // gateway to 300+ models
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"), // local, no key

  // Generic OpenAI-compatible endpoint (xAI, Together, Fireworks, vLLM, LM Studio, ...).
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().url().optional(),

  // Bedrock — bedrock-mantle (OpenAI-compatible) endpoint + long-term bearer API key.
  BEDROCK_API_KEY: z.string().optional(),
  BEDROCK_BASE_URL: z.string().url().optional(),
  AWS_REGION: z.string().default("us-east-1"),
  BEDROCK_MODEL: z.string().default("moonshotai.kimi-k2.5"),
  // DeepSeek
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com/v1"),
  // Legacy default — newer code uses DEEPSEEK_MODEL_AGENT / DEEPSEEK_MODEL_INSTRUCT.
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-flash"),
  // Agent mode (architecture generation, tool calling) — high-capability reasoning tier.
  DEEPSEEK_MODEL_AGENT: z.string().default("deepseek-v4-pro"),
  // Instruct mode (chat, explanation) — fast tier.
  DEEPSEEK_MODEL_INSTRUCT: z.string().default("deepseek-v4-flash"),

// Agent loop round ceiling (1 round = 1 LLM call; one round can loop MULTIPLE tool calls).
// Production does NOT stop when the ceiling is full: 'paused' event + user "Continue"
// continues where it left off (the agent sees the current graph, does not create it again). 120 = reasonable
// one-time step; great architecture is completed with a few "Go"s.
  AI_MAX_TURNS: z.coerce.number().int().positive().default(120),

  // Codegen fill endpoint rate limit (requests per minute).
  CODEGEN_FILL_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),

  // ── Embeddings (Phase 4 GraphRAG) ──
  // bedrock-mantle does not offer embedding models (chat LLMs only) → local default.
  // local = @xenova/transformers (ONNX, offline, CPU). bedrock = future embed model via OpenAIEmbeddings.
  EMBED_PROVIDER: z.enum(["local", "bedrock"]).default("local"),
  // Multilingual (50+ languages), 384 dim — more accurate cross-locale than
  // all-MiniLM-L6-v2 (mainly English). Same size → index unchanged.
  EMBED_MODEL: z.string().default("Xenova/paraphrase-multilingual-MiniLM-L12-v2"),
  EMBED_DIM: z.coerce.number().int().positive().default(384),
  EMBED_TOP_K: z.coerce.number().int().positive().default(3),
  EMBED_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.7),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return EnvSchema.parse(source);
}

export const env = parseEnv(process.env);
