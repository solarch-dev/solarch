import { ChatOpenAI } from "@langchain/openai";
import { ChatDeepSeek } from "@langchain/deepseek";
import { env } from "../../config/env";

export type GenerationChat = ChatOpenAI;

export interface ChatOpts {
  /** true: tool calling modu (response_format kaldırılır, bindTools ile kullanılır).
   *  false (default): JSON object modu (chatStream öncesi monolithic chat akışı için). */
  toolCalling?: boolean;
  /** true: token streaming aktif (llm.stream() gerçek chunks döner — instruct mode için).
   *  false (default): tek response, llm.stream() yine de tek chunk yield eder (tool call JSON bozulmasın). */
  streaming?: boolean;
  /** Model override — provider-specific (DeepSeek: v4-pro/v4-flash, Bedrock: kimi-k2.5...).
   *  Boş ise env default. Agent mode v4-pro (mimari karar), instruct mode v4-flash (sohbet). */
  model?: string;
}

/** generation → mimari üretim. toolCalling=true ise atomic create_node/create_edge
 *  agent loop'u için optimize (chatStream); false ise full-graph JSON akışı (chat). */
export function getGenerationChat(opts: ChatOpts = {}): GenerationChat {
  if (env.LLM_GENERATION_PROVIDER === "bedrock") {
    return makeBedrock(opts);
  }
  return makeDeepSeek(opts);
}

/** chat → genel diyalog / özet (DeepSeek default). */
export function getChatChat(): GenerationChat {
  if (env.LLM_CHAT_PROVIDER === "bedrock") {
    return makeBedrock();
  }
  return makeDeepSeek();
}

export function isGenerationConfigured(): boolean {
  return env.LLM_GENERATION_PROVIDER === "bedrock"
    ? !!(env.BEDROCK_API_KEY && env.BEDROCK_BASE_URL)
    : !!env.DEEPSEEK_API_KEY;
}

/** Bedrock-mantle = OpenAI-uyumlu Chat Completions endpoint + bearer API key.
 *  AWS Kimi K2.5 için önerilen yol (native Converse IAM-yetkisizdi). */
function makeBedrock(opts: ChatOpts = {}): ChatOpenAI {
  if (!env.BEDROCK_API_KEY || !env.BEDROCK_BASE_URL) {
    throw new Error("BEDROCK_API_KEY ve BEDROCK_BASE_URL gerekli (generation=bedrock).");
  }
  return new ChatOpenAI({
    model: opts.model ?? env.BEDROCK_MODEL,
    apiKey: env.BEDROCK_API_KEY,
    temperature: 0.3,
    maxTokens: 16000, // Kimi K2.5 max output 16K
    timeout: 120_000, // tek LLM çağrısı 2dk'da hard-fail (askıda kalma + maliyet koruması)
    maxRetries: 1,
    // streaming: tool call JSON chunk bölünmesin diye default false; instruct mode'da true
    streaming: opts.streaming ?? false,
    configuration: { baseURL: env.BEDROCK_BASE_URL },
  });
}

function makeDeepSeek(opts: ChatOpts = {}): ChatOpenAI {
  if (!env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY gerekli.");
  }
  // tool calling modu: response_format kaldırılır (json_object + tools çakışır).
  // Atomic tool args (~1-2K char) bozulma eşiğinin (10K) çok altında olduğundan
  // v4-flash + non-thinking + tools deterministik çalışır.
  const modelKwargs: Record<string, unknown> = { thinking: { type: "disabled" } };
  if (!opts.toolCalling) {
    modelKwargs.response_format = { type: "json_object" };
  }
  return new ChatDeepSeek({
    model: opts.model ?? env.DEEPSEEK_MODEL,
    apiKey: env.DEEPSEEK_API_KEY,
    temperature: 0.3,
    // v4 max output 384K; düşük cap büyük graf JSON'ını kesip "Expecting ','" veriyordu.
    maxTokens: 32000,
    timeout: 120_000, // tek LLM çağrısı 2dk'da hard-fail (askıda kalma + maliyet koruması)
    maxRetries: 1,
    // streaming: tool call JSON chunk bölünmesin diye default false; instruct mode'da true
    streaming: opts.streaming ?? false,
    configuration: { baseURL: env.DEEPSEEK_BASE_URL },
    modelKwargs,
  }) as unknown as ChatOpenAI;
}
