import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";
import { embeddingsConfigured, makeBedrockEmbedder } from "./embeddings.factory";
import type { IEmbeddings } from "./embeddings.types";

/** @xenova/transformers feature-extraction pipeline a callable function. */
type Extractor = (text: string, opts: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array }>;

@Injectable()
export class EmbeddingsService implements IEmbeddings {
  private readonly logger = new Logger(EmbeddingsService.name);
  private extractorPromise: Promise<Extractor> | null = null;
  private bedrock: ReturnType<typeof makeBedrockEmbedder> | null = null;

  isConfigured(): boolean {
    return embeddingsConfigured();
  }

/** Lazy load the local ONNX model (~1sec on first call, then cache). */
  private localExtractor(): Promise<Extractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
// dynamic import: @xenova/transformers ESM/CJS interop is safe in CJS build.
        const { pipeline } = await import("@xenova/transformers");
        this.logger.log(`Loading local embedder: ${env.EMBED_MODEL}`);
        return (await pipeline("feature-extraction", env.EMBED_MODEL)) as unknown as Extractor;
      })();
    }
    return this.extractorPromise;
  }

  async embed(text: string): Promise<number[]> {
    if (env.EMBED_PROVIDER === "bedrock") {
      this.bedrock ??= makeBedrockEmbedder();
      return this.bedrock.embedQuery(text);
    }
    const extractor = await this.localExtractor();
    const out = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
