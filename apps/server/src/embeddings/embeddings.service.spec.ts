import { describe, it, expect } from "vitest";
import { EmbeddingsService } from "./embeddings.service";

describe("EmbeddingsService", () => {
  it("local provider'da isConfigured true", () => {
    expect(new EmbeddingsService().isConfigured()).toBe(true);
  });

it("embed converts local extractor output to number[]", async () => {
    const svc = new EmbeddingsService();
    (svc as any).extractorPromise = Promise.resolve(
      async () => ({ data: new Float32Array([0.1, 0.2, 0.3]) }),
    );
    const vec = await svc.embed("x");
    expect(vec).toHaveLength(3);
    expect(vec[0]).toBeCloseTo(0.1, 5);
  });

  it("embedBatch her metni embed eder", async () => {
    const svc = new EmbeddingsService();
    (svc as any).extractorPromise = Promise.resolve(
      async () => ({ data: new Float32Array([1, 0]) }),
    );
    const vecs = await svc.embedBatch(["a", "b"]);
    expect(vecs).toHaveLength(2);
    expect(vecs[0]).toEqual([1, 0]);
  });
});
