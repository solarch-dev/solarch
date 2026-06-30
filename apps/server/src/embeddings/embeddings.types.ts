/** DI token + interface — patterns service connects to this abstraction,
 *  testlerde fake embedder ile override edilir. */
export const EMBEDDINGS = Symbol("EMBEDDINGS");

export interface IEmbeddings {
  isConfigured(): boolean;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
