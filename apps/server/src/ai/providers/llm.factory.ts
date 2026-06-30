import { ChatOpenAI } from "@langchain/openai";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatGroq } from "@langchain/groq";
import { ChatOllama } from "@langchain/ollama";
import { env } from "../../config/env";

/** The rest of the codebase treats every chat client as a ChatOpenAI (it only uses the shared
 *  BaseChatModel surface: invoke / stream / bindTools / .tool_calls). Non-OpenAI providers are
 *  cast through this alias — every LangChain chat model implements the same interface. */
export type GenerationChat = ChatOpenAI;

export type LlmProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "mistral"
  | "groq"
  | "openrouter"
  | "ollama"
  | "bedrock"
  | "openai-compatible";

export interface ChatOpts {
  /** true: tool-calling mode (no response_format; used with bindTools by the streaming agent).
   *  false (default): JSON-object mode (the legacy monolithic chat() flow). */
  toolCalling?: boolean;
  /** true: token streaming (llm.stream() yields real chunks — instruct mode). */
  streaming?: boolean;
  /** Logical tier; the factory maps it to the active provider's model. "agent" = architecture
   *  generation (high capability), "instruct" = chat (fast). Undefined = provider default. */
  tier?: "agent" | "instruct";
  /** Explicit model override (rare — usually use `tier` or the LLM_MODEL env). */
  model?: string;
}

const COMMON = { temperature: 0.3, timeout: 120_000, maxRetries: 1 } as const;

/** opts.model > LLM_MODEL (global override) > the provider's default for this tier. */
function pickModel(opts: ChatOpts, agentDefault: string, instructDefault = agentDefault): string {
  if (opts.model) return opts.model;
  if (env.LLM_MODEL) return env.LLM_MODEL;
  return opts.tier === "instruct" ? instructDefault : agentDefault;
}

interface ProviderDef {
  /** Env var the user must set for this provider (shown by env-check when missing). */
  envHint: string;
  /** Whether the provider has the credentials/config it needs. */
  configured: () => boolean;
  /** Tool-calling capable — required for the Architect (agent mode). Advisory. */
  supportsTools: boolean;
  /** Build a chat client (cast to ChatOpenAI — see GenerationChat). */
  build: (opts: ChatOpts) => ChatOpenAI;
}

/** Provider registry. Adding a provider = one entry here + (if a new SDK) a dependency.
 *  Provider-specific quirks stay local to each builder (e.g. DeepSeek's json_object/thinking). */
const PROVIDERS: Record<LlmProvider, ProviderDef> = {
  openai: {
    envHint: "OPENAI_API_KEY",
    configured: () => !!env.OPENAI_API_KEY,
    supportsTools: true,
    build: (o) =>
      new ChatOpenAI({
        ...COMMON,
        model: pickModel(o, "gpt-4o"),
        apiKey: env.OPENAI_API_KEY,
        maxTokens: 16000,
        streaming: o.streaming ?? false,
        ...(env.OPENAI_BASE_URL ? { configuration: { baseURL: env.OPENAI_BASE_URL } } : {}),
        // OpenAI supports JSON-object mode (conflicts with tools, so only when not tool-calling).
        ...(!o.toolCalling ? { modelKwargs: { response_format: { type: "json_object" } } } : {}),
      }),
  },

  anthropic: {
    envHint: "ANTHROPIC_API_KEY",
    configured: () => !!env.ANTHROPIC_API_KEY,
    supportsTools: true,
    build: (o) =>
      new ChatAnthropic({
        ...COMMON,
        model: pickModel(o, "claude-3-5-sonnet-latest"),
        apiKey: env.ANTHROPIC_API_KEY,
        maxTokens: 8192,
        streaming: o.streaming ?? false,
      }) as unknown as ChatOpenAI,
  },

  google: {
    envHint: "GOOGLE_API_KEY",
    configured: () => !!env.GOOGLE_API_KEY,
    supportsTools: true,
    build: (o) =>
      new ChatGoogleGenerativeAI({
        model: pickModel(o, "gemini-1.5-pro"),
        apiKey: env.GOOGLE_API_KEY,
        temperature: 0.3,
        maxOutputTokens: 8192,
        maxRetries: 1,
        streaming: o.streaming ?? false,
      }) as unknown as ChatOpenAI,
  },

  deepseek: {
    envHint: "DEEPSEEK_API_KEY",
    configured: () => !!env.DEEPSEEK_API_KEY,
    supportsTools: true,
    build: (o) => {
      // tool-calling mode drops response_format (json_object + tools conflict). Atomic tool
      // args are far below the corruption threshold so non-thinking + tools is deterministic.
      const modelKwargs: Record<string, unknown> = { thinking: { type: "disabled" } };
      if (!o.toolCalling) modelKwargs.response_format = { type: "json_object" };
      // Preserve the two-tier behavior: agent → v4-pro, instruct → v4-flash, untiered → legacy.
      const model =
        o.model ??
        env.LLM_MODEL ??
        (o.tier === "agent"
          ? env.DEEPSEEK_MODEL_AGENT
          : o.tier === "instruct"
            ? env.DEEPSEEK_MODEL_INSTRUCT
            : env.DEEPSEEK_MODEL);
      return new ChatDeepSeek({
        ...COMMON,
        model,
        apiKey: env.DEEPSEEK_API_KEY!,
        maxTokens: 32000, // v4 max output is large; a low cap truncated big graph JSON
        streaming: o.streaming ?? false,
        configuration: { baseURL: env.DEEPSEEK_BASE_URL },
        modelKwargs,
      }) as unknown as ChatOpenAI;
    },
  },

  mistral: {
    envHint: "MISTRAL_API_KEY",
    configured: () => !!env.MISTRAL_API_KEY,
    supportsTools: true,
    build: (o) =>
      new ChatMistralAI({
        model: pickModel(o, "mistral-large-latest"),
        apiKey: env.MISTRAL_API_KEY,
        temperature: 0.3,
        maxTokens: 8192,
        maxRetries: 1,
        streaming: o.streaming ?? false,
      }) as unknown as ChatOpenAI,
  },

  groq: {
    envHint: "GROQ_API_KEY",
    configured: () => !!env.GROQ_API_KEY,
    supportsTools: true,
    build: (o) =>
      new ChatGroq({
        model: pickModel(o, "llama-3.3-70b-versatile"),
        apiKey: env.GROQ_API_KEY,
        temperature: 0.3,
        maxTokens: 8192,
        maxRetries: 1,
        streaming: o.streaming ?? false,
      }) as unknown as ChatOpenAI,
  },

  // OpenRouter — an OpenAI-compatible gateway to 300+ models. Model id is "vendor/model".
  openrouter: {
    envHint: "OPENROUTER_API_KEY",
    configured: () => !!env.OPENROUTER_API_KEY,
    supportsTools: true, // model-dependent; pick a tool-calling-capable model for the Architect
    build: (o) =>
      new ChatOpenAI({
        ...COMMON,
        model: pickModel(o, "openai/gpt-4o"),
        apiKey: env.OPENROUTER_API_KEY,
        maxTokens: 16000,
        streaming: o.streaming ?? false,
        configuration: { baseURL: "https://openrouter.ai/api/v1" },
      }),
  },

  // Ollama — fully local/offline, no API key. Inside Docker, point OLLAMA_BASE_URL at the host.
  ollama: {
    envHint: "OLLAMA_BASE_URL",
    configured: () => !!env.OLLAMA_BASE_URL, // always set (defaulted); reachability is runtime
    supportsTools: true, // model-dependent (llama3.1+ etc.)
    build: (o) =>
      new ChatOllama({
        model: pickModel(o, "llama3.1"),
        baseUrl: env.OLLAMA_BASE_URL,
        temperature: 0.3,
        streaming: o.streaming ?? false,
      }) as unknown as ChatOpenAI,
  },

  // Bedrock-mantle = OpenAI-compatible Chat Completions endpoint + bearer API key.
  bedrock: {
    envHint: "BEDROCK_API_KEY + BEDROCK_BASE_URL",
    configured: () => !!(env.BEDROCK_API_KEY && env.BEDROCK_BASE_URL),
    supportsTools: true,
    build: (o) => {
      if (!env.BEDROCK_API_KEY || !env.BEDROCK_BASE_URL) {
        throw new Error("BEDROCK_API_KEY and BEDROCK_BASE_URL are required (provider=bedrock).");
      }
      return new ChatOpenAI({
        ...COMMON,
        model: pickModel(o, env.BEDROCK_MODEL),
        apiKey: env.BEDROCK_API_KEY,
        maxTokens: 16000,
        streaming: o.streaming ?? false,
        configuration: { baseURL: env.BEDROCK_BASE_URL },
      });
    },
  },

  // Generic OpenAI-compatible endpoint (xAI, Together, Fireworks, Azure, vLLM, LM Studio, ...).
  "openai-compatible": {
    envHint: "LLM_API_KEY + LLM_BASE_URL + LLM_MODEL",
    configured: () => !!(env.LLM_API_KEY && env.LLM_BASE_URL && env.LLM_MODEL),
    supportsTools: true,
    build: (o) => {
      if (!env.LLM_BASE_URL || !env.LLM_MODEL) {
        throw new Error("LLM_BASE_URL and LLM_MODEL are required (provider=openai-compatible).");
      }
      return new ChatOpenAI({
        ...COMMON,
        model: o.model ?? env.LLM_MODEL,
        apiKey: env.LLM_API_KEY ?? "not-needed",
        maxTokens: 16000,
        streaming: o.streaming ?? false,
        configuration: { baseURL: env.LLM_BASE_URL },
      });
    },
  },
};

function buildFor(provider: LlmProvider, opts: ChatOpts): GenerationChat {
  const def = PROVIDERS[provider];
  if (!def.configured()) {
    throw new Error(`AI provider "${provider}" is not configured — set ${def.envHint}.`);
  }
  return def.build(opts);
}

/** generation → architecture generation. toolCalling=true drives the atomic agent loop
 *  (chatStream); false is the full-graph JSON flow (legacy chat()). */
export function getGenerationChat(opts: ChatOpts = {}): GenerationChat {
  return buildFor(env.LLM_GENERATION_PROVIDER, opts);
}

/** chat → general dialogue / summary. */
export function getChatChat(opts: ChatOpts = {}): GenerationChat {
  return buildFor(env.LLM_CHAT_PROVIDER, opts);
}

export function isGenerationConfigured(): boolean {
  return PROVIDERS[env.LLM_GENERATION_PROVIDER].configured();
}

/** For env-check: is the given provider configured, and which env var does it need. */
export function providerStatus(provider: LlmProvider): { configured: boolean; envHint: string } {
  const def = PROVIDERS[provider];
  return { configured: def.configured(), envHint: def.envHint };
}
