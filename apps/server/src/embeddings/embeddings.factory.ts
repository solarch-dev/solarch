import { OpenAIEmbeddings } from "@langchain/openai";
import { env } from "../config/env";

/** local → her zaman hazır (offline ONNX). bedrock → key + base URL gerekir. */
export function embeddingsConfigured(): boolean {
  if (env.EMBED_PROVIDER === "local") return true;
  return !!(env.BEDROCK_API_KEY && env.BEDROCK_BASE_URL);
}

/** bedrock-mantle OpenAI-uyumlu /embeddings. Şu an mantle embed modeli sunmuyor;
 *  ileride sunarsa EMBED_PROVIDER=bedrock + EMBED_MODEL ile devreye girer. */
export function makeBedrockEmbedder(): OpenAIEmbeddings {
  if (!env.BEDROCK_API_KEY || !env.BEDROCK_BASE_URL) {
    throw new Error("BEDROCK_API_KEY ve BEDROCK_BASE_URL gerekli (embeddings=bedrock).");
  }
  return new OpenAIEmbeddings({
    model: env.EMBED_MODEL,
    apiKey: env.BEDROCK_API_KEY,
    configuration: { baseURL: env.BEDROCK_BASE_URL },
  });
}
