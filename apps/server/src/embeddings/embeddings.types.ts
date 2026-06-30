/** DI token + arayüz — patterns servisi bu abstraction'a bağlanır,
 *  testlerde fake embedder ile override edilir. */
export const EMBEDDINGS = Symbol("EMBEDDINGS");

export interface IEmbeddings {
  isConfigured(): boolean;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
