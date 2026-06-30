# Phase 4 — Pattern Library + GraphRAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Küratörlü mimari pattern kütüphanesi + Neo4j native vector index + Bedrock embeddings ile AI agent'a retrieval-augmented üretim eklemek.

**Architecture:** `:Pattern` node'ları (alt-graf + açıklama + embedding) Neo4j'de izole tutulur; native vector index ile semantik aranır. `EmbeddingsService` (provider-abstracted, bedrock-mantle default) sorguyu vektörler; `AiService.chat` LLM turundan önce top-K pattern'i system prompt'a otomatik enjekte eder. Doluluk: seed + promote.

**Tech Stack:** NestJS 11, Neo4j 5-community (native vector index 5.13+), Zod + nestjs-zod, `@langchain/openai` `OpenAIEmbeddings`, Vitest + Testcontainers.

**Referans desenler (oku):** `src/ai/providers/llm.factory.ts` (provider abstraction), `src/neo4j/migrations/data/001-enrich-faz-a.ts` (TS migration), `src/nodes/nodes.repository.ts` (Cypher repo + JSON.stringify properties), `src/graph/dto/apply-graph.dto.ts` (graphJson formatı), `src/common/envelope.ts` (`ok()`), `src/node-types/node-types.controller.ts` (Scalar `@ApiOperation` decorator deseni).

---

## File Structure

- `src/config/env.ts` — EMBED_* env değişkenleri (modify)
- `src/embeddings/embeddings.types.ts` — `IEmbeddings` interface + `EMBEDDINGS` DI token
- `src/embeddings/embeddings.factory.ts` — `OpenAIEmbeddings` üretimi (bedrock-mantle)
- `src/embeddings/embeddings.service.ts` — `IEmbeddings` impl (embed/embedBatch/isConfigured)
- `src/embeddings/embeddings.module.ts` — provider export
- `src/patterns/schemas/pattern.schema.ts` — Zod: PatternGraph, Pattern, CreatePattern, SearchPattern
- `src/patterns/dto/*.dto.ts` — createZodDto sınıfları
- `src/patterns/patterns.repository.ts` — Cypher CRUD + vector search
- `src/patterns/patterns.service.ts` — embed+store, search, promote
- `src/patterns/patterns.controller.ts` — endpoint'ler
- `src/patterns/patterns.module.ts` — modül
- `src/patterns/seed/canonical-patterns.ts` — ~12 kanonik pattern verisi
- `src/patterns/seed/seed.ts` — seed runner (`pnpm seed:patterns`)
- `src/neo4j/migrations/data/004-pattern-vector-index.ts` — vektör index (env EMBED_DIM)
- `src/ai/prompts/system-prompt.ts` — `buildSystemPrompt(graph, patterns?)` (modify)
- `src/ai/ai.service.ts` — retrieval + enjeksiyon (modify)
- `src/ai/ai.module.ts` — EmbeddingsModule + PatternsModule import (modify)
- `src/app.module.ts` — PatternsModule + EmbeddingsModule (modify)
- `test/patterns.e2e-spec.ts` — fake embedder + vector index round-trip
- `package.json` — scripts (modify)

---

### Task 1: bedrock-mantle `/embeddings` doğrulama (spike)

**Amaç:** Embedding endpoint'i, model id'si ve **boyutu** (vector index'i belirler) doğrulamak. TDD değil — keşif; sonucu env default'larına yazarız.

**Files:** geçici script (commit edilmez).

- [ ] **Step 1: Geçici doğrulama scripti yaz ve çalıştır**

Repo kökünde `verify-embed.ts` (sonra silinecek):

```ts
import { OpenAIEmbeddings } from "@langchain/openai";
import { env } from "./src/config/env";

const CANDIDATES = ["amazon.titan-embed-text-v2:0", "cohere.embed-english-v3", "amazon.titan-embed-text-v1"];

(async () => {
  for (const model of CANDIDATES) {
    try {
      const e = new OpenAIEmbeddings({
        model,
        apiKey: env.BEDROCK_API_KEY,
        configuration: { baseURL: env.BEDROCK_BASE_URL },
      });
      const vec = await e.embedQuery("merhaba mimari test");
      console.log(`✓ ${model} → dim=${vec.length}`);
    } catch (err: any) {
      console.log(`✗ ${model} → ${err?.status ?? ""} ${err?.message?.slice(0, 120)}`);
    }
  }
})();
```

Run: `pnpm exec tsx --env-file=.env verify-embed.ts`

- [ ] **Step 2: Sonucu kaydet, scripti sil**

Çalışan ilk modelin id'si → `EMBED_MODEL` default'u; `dim` → `EMBED_DIM` default'u (Task 2).
**Eğer hiçbiri çalışmazsa** (mantle embeddings sunmuyorsa): `EMBED_PROVIDER=local` yolunu seç —
`@langchain/community` + `@xenova/transformers` ile `Xenova/all-MiniLM-L6-v2` (dim=384). Bu durumda
Task 3 factory'sine local branch eklenir (plan Task 3 Step 3'te belirtildi).

Run: `rm -f verify-embed.ts`
Expected: temizlendi. Karar bir cümleyle commit mesajına / Task 2'ye yazılır.

---

### Task 2: Embedding env değişkenleri

**Files:**
- Modify: `src/config/env.ts`
- Test: `src/config/env.spec.ts`

- [ ] **Step 1: Failing test ekle**

`src/config/env.spec.ts` içine:

```ts
it("embedding default'larını doldurur", () => {
  const e = parseEnv({ NEO4J_URI: "bolt://localhost:7687", NEO4J_USER: "neo4j", NEO4J_PASSWORD: "x" });
  expect(e.EMBED_PROVIDER).toBe("bedrock");
  expect(e.EMBED_DIM).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Test fail (EMBED_PROVIDER undefined)**

Run: `pnpm vitest run src/config/env.spec.ts`
Expected: FAIL.

- [ ] **Step 3: env.ts'e alanları ekle**

`EnvSchema` içine (DEEPSEEK_MODEL satırından sonra), Task 1'de bulunan değerlerle:

```ts
  // ── Embeddings (Phase 4 GraphRAG) ──
  EMBED_PROVIDER: z.enum(["bedrock", "local"]).default("bedrock"),
  EMBED_MODEL: z.string().default("amazon.titan-embed-text-v2:0"), // Task 1 sonucu
  EMBED_DIM: z.coerce.number().int().positive().default(1024),       // Task 1 sonucu
  EMBED_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.7),
  EMBED_TOP_K: z.coerce.number().int().positive().default(3),
```

(bedrock embeddings, mevcut `BEDROCK_API_KEY` + `BEDROCK_BASE_URL`'i yeniden kullanır — yeni anahtar yok.)

- [ ] **Step 4: Test pass**

Run: `pnpm vitest run src/config/env.spec.ts`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/config/env.spec.ts
git commit -m "feat(config): embedding env (EMBED_PROVIDER/MODEL/DIM/TOP_K/MIN_SCORE)"
```

---

### Task 3: Embeddings provider abstraction

**Files:**
- Create: `src/embeddings/embeddings.types.ts`, `embeddings.factory.ts`, `embeddings.service.ts`, `embeddings.module.ts`
- Test: `src/embeddings/embeddings.service.spec.ts`

- [ ] **Step 1: Interface + token (types)**

`src/embeddings/embeddings.types.ts`:

```ts
export const EMBEDDINGS = Symbol("EMBEDDINGS");

export interface IEmbeddings {
  isConfigured(): boolean;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

- [ ] **Step 2: Factory (llm.factory ikizi)**

`src/embeddings/embeddings.factory.ts`:

```ts
import { OpenAIEmbeddings } from "@langchain/openai";
import { env } from "../config/env";

/** bedrock-mantle = OpenAI-uyumlu /embeddings; mevcut BEDROCK_API_KEY ile. */
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

export function embeddingsConfigured(): boolean {
  if (env.EMBED_PROVIDER === "local") return true;
  return !!(env.BEDROCK_API_KEY && env.BEDROCK_BASE_URL);
}
```

(Task 1 local'e karar verdiyse: `makeLocalEmbedder()` ekle — `@langchain/community`
`HuggingFaceTransformersEmbeddings` `Xenova/all-MiniLM-L6-v2` — ve `getEmbedderImpl()`
provider'a göre seçsin.)

- [ ] **Step 3: Service (IEmbeddings impl)**

`src/embeddings/embeddings.service.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { Embeddings } from "@langchain/core/embeddings";
import { makeBedrockEmbedder, embeddingsConfigured } from "./embeddings.factory";
import type { IEmbeddings } from "./embeddings.types";

@Injectable()
export class EmbeddingsService implements IEmbeddings {
  private readonly logger = new Logger(EmbeddingsService.name);
  private embedder: Embeddings | null = null;

  isConfigured(): boolean {
    return embeddingsConfigured();
  }

  private get client(): Embeddings {
    if (!this.embedder) this.embedder = makeBedrockEmbedder();
    return this.embedder;
  }

  async embed(text: string): Promise<number[]> {
    return this.client.embedQuery(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.client.embedDocuments(texts);
  }
}
```

- [ ] **Step 4: Module**

`src/embeddings/embeddings.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { EmbeddingsService } from "./embeddings.service";
import { EMBEDDINGS } from "./embeddings.types";

@Module({
  providers: [EmbeddingsService, { provide: EMBEDDINGS, useExisting: EmbeddingsService }],
  exports: [EMBEDDINGS, EmbeddingsService],
})
export class EmbeddingsModule {}
```

- [ ] **Step 5: Failing test**

`src/embeddings/embeddings.service.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { EmbeddingsService } from "./embeddings.service";

describe("EmbeddingsService", () => {
  it("isConfigured boolean döner", () => {
    expect(typeof new EmbeddingsService().isConfigured()).toBe("boolean");
  });

  it("embed, embedder.embedQuery'yi çağırır", async () => {
    const svc = new EmbeddingsService();
    (svc as any).embedder = { embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]) };
    expect(await svc.embed("x")).toEqual([0.1, 0.2]);
  });
});
```

- [ ] **Step 6: Test pass + commit**

Run: `pnpm vitest run src/embeddings`
Expected: PASS (2 test).

```bash
git add src/embeddings/
git commit -m "feat(embeddings): provider-abstracted embeddings (bedrock-mantle default)"
```

---

### Task 4: Pattern Zod şeması

**Files:**
- Create: `src/patterns/schemas/pattern.schema.ts`
- Test: `src/patterns/schemas/pattern.schema.spec.ts`

- [ ] **Step 1: Şema (graphJson = apply mutations formatı)**

`src/patterns/schemas/pattern.schema.ts`:

```ts
import { z } from "zod";
import { EdgeKindSchema } from "../../edges/schemas/edge.schema";

// graphJson: GraphService.apply girdi formatıyla AYNI (tempId tabanlı) → pattern
// doğrudan apply edilebilir.
export const PatternGraphSchema = z.object({
  nodes: z.array(z.object({
    tempId: z.string().min(1),
    type: z.string().min(1),
    properties: z.record(z.unknown()),
  }).strict()).min(1),
  edges: z.array(z.object({
    sourceTempId: z.string().min(1),
    targetTempId: z.string().min(1),
    edgeType: EdgeKindSchema,
    label: z.string().optional(),
  }).strict()).default([]),
}).strict();

export const CreatePatternSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  graph: PatternGraphSchema,
}).strict();

export const SearchPatternSchema = z.object({
  query: z.string().min(1),
  k: z.number().int().positive().max(20).optional(),
  minScore: z.number().min(0).max(1).optional(),
}).strict();

export type PatternGraph = z.infer<typeof PatternGraphSchema>;
export type CreatePatternInput = z.infer<typeof CreatePatternSchema>;
export type SearchPatternInput = z.infer<typeof SearchPatternSchema>;

// Saklanan + dönen tam Pattern (embedding API yanıtında dönmez).
export interface StoredPattern {
  id: string;
  name: string;
  description: string;
  tags: string[];
  graph: PatternGraph;
  source: "seed" | "promoted";
  createdAt: string;
}
export interface PatternSummary {
  id: string; name: string; description: string; tags: string[];
  source: string; createdAt: string; nodeCount: number; edgeCount: number;
}
```

- [ ] **Step 2: Failing test**

`src/patterns/schemas/pattern.schema.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CreatePatternSchema, PatternGraphSchema } from "./pattern.schema";

const graph = {
  nodes: [{ tempId: "t_ctrl", type: "Controller", properties: { ControllerName: "X" } }],
  edges: [],
};

describe("CreatePatternSchema", () => {
  it("geçerli pattern'i parse eder, tags default boş", () => {
    const p = CreatePatternSchema.parse({ name: "n", description: "d", graph });
    expect(p.tags).toEqual([]);
    expect(p.graph.nodes).toHaveLength(1);
  });
  it("graph.nodes boşsa fırlatır", () => {
    expect(() => PatternGraphSchema.parse({ nodes: [], edges: [] })).toThrow();
  });
  it("geçersiz edgeType reddeder", () => {
    expect(() => PatternGraphSchema.parse({
      nodes: graph.nodes,
      edges: [{ sourceTempId: "a", targetTempId: "b", edgeType: "BOGUS" }],
    })).toThrow();
  });
});
```

- [ ] **Step 3: Test pass + commit**

Run: `pnpm vitest run src/patterns/schemas`
Expected: PASS (3 test).

```bash
git add src/patterns/schemas/
git commit -m "feat(patterns): Pattern Zod şeması (graphJson = apply formatı)"
```

---

### Task 5: Vektör index migration

**Files:**
- Create: `src/neo4j/migrations/data/004-pattern-vector-index.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Migration scripti**

`src/neo4j/migrations/data/004-pattern-vector-index.ts`:

```ts
import { Neo4jService } from "../../neo4j.service";
import { env } from "../../../config/env";

/** :Pattern(embedding) için native vektör index. Idempotent (IF NOT EXISTS).
 *  Boyut env.EMBED_DIM'den — model değişirse index drop + yeniden oluştur. */
async function main(): Promise<void> {
  const svc = new Neo4jService({ uri: env.NEO4J_URI, user: env.NEO4J_USER, password: env.NEO4J_PASSWORD });
  await svc.onModuleInit();
  await svc.run(
    `CREATE VECTOR INDEX pattern_embedding IF NOT EXISTS
     FOR (p:Pattern) ON (p.embedding)
     OPTIONS { indexConfig: {
       \`vector.dimensions\`: $dim,
       \`vector.similarity_function\`: 'cosine'
     } }`,
    { dim: env.EMBED_DIM },
  );
  await svc.onModuleDestroy();
  console.log(`✓ pattern_embedding vektör index hazır (dim=${env.EMBED_DIM}).`);
}

main().catch((e) => { console.error("✗ Index migration failed:", e); process.exit(1); });
```

- [ ] **Step 2: package.json script**

`scripts`'e ekle (migrate:data:faz-c satırından sonra):

```json
"migrate:patterns-index": "tsx --env-file=.env src/neo4j/migrations/data/004-pattern-vector-index.ts"
```

- [ ] **Step 3: Çalıştır (Neo4j açık)**

Run: `pnpm migrate:patterns-index`
Expected: `✓ pattern_embedding vektör index hazır (dim=...).`

Doğrula: `docker exec solarch-neo4j cypher-shell -u neo4j -p solarch_dev_password "SHOW INDEXES YIELD name WHERE name='pattern_embedding' RETURN name"` → `pattern_embedding`.

- [ ] **Step 4: Commit**

```bash
git add src/neo4j/migrations/data/004-pattern-vector-index.ts package.json
git commit -m "feat(neo4j): :Pattern vektör index migration (env EMBED_DIM, cosine)"
```

---

### Task 6: Patterns repository

**Files:**
- Create: `src/patterns/patterns.repository.ts`
- Test: `src/patterns/patterns.repository.spec.ts`

- [ ] **Step 1: Repository**

`src/patterns/patterns.repository.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../neo4j/neo4j.service";
import type { StoredPattern, PatternSummary } from "./schemas/pattern.schema";

export interface PatternSearchHit { pattern: StoredPattern; score: number; }

@Injectable()
export class PatternsRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async create(p: StoredPattern, embedding: number[]): Promise<void> {
    await this.neo4j.run(
      `CREATE (p:Pattern {
        id: $id, name: $name, description: $description, tags: $tags,
        graphJson: $graphJson, source: $source,
        createdAt: datetime($createdAt), embedding: $embedding
      })`,
      {
        id: p.id, name: p.name, description: p.description, tags: p.tags,
        graphJson: JSON.stringify(p.graph), source: p.source,
        createdAt: p.createdAt, embedding,
      },
    );
  }

  async list(): Promise<PatternSummary[]> {
    const res = await this.neo4j.run(
      `MATCH (p:Pattern) RETURN p ORDER BY p.createdAt DESC`,
    );
    return res.records.map((r) => toSummary(r.get("p").properties));
  }

  async getById(id: string): Promise<StoredPattern | null> {
    const res = await this.neo4j.run(`MATCH (p:Pattern {id: $id}) RETURN p`, { id });
    if (res.records.length === 0) return null;
    return toStored(res.records[0].get("p").properties);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.neo4j.run(
      `MATCH (p:Pattern {id: $id}) DELETE p RETURN 1 AS d`, { id },
    );
    return res.records.length > 0;
  }

  async findByName(name: string): Promise<boolean> {
    const res = await this.neo4j.run(`MATCH (p:Pattern {name: $name}) RETURN p LIMIT 1`, { name });
    return res.records.length > 0;
  }

  /** Native vektör arama: cosine top-K + minScore filtresi. */
  async search(embedding: number[], k: number, minScore: number): Promise<PatternSearchHit[]> {
    const res = await this.neo4j.run(
      `CALL db.index.vector.queryNodes('pattern_embedding', $k, $embedding)
       YIELD node, score
       WHERE score >= $minScore
       RETURN node, score ORDER BY score DESC`,
      { k, embedding, minScore },
    );
    return res.records.map((r) => ({
      pattern: toStored(r.get("node").properties),
      score: r.get("score"),
    }));
  }
}

function toStored(p: any): StoredPattern {
  return {
    id: p.id, name: p.name, description: p.description,
    tags: p.tags ?? [], graph: JSON.parse(p.graphJson),
    source: p.source, createdAt: new Date(p.createdAt).toISOString(),
  };
}
function toSummary(p: any): PatternSummary {
  const g = JSON.parse(p.graphJson);
  return {
    id: p.id, name: p.name, description: p.description, tags: p.tags ?? [],
    source: p.source, createdAt: new Date(p.createdAt).toISOString(),
    nodeCount: g.nodes.length, edgeCount: g.edges.length,
  };
}
```

- [ ] **Step 2: Failing test (mock Neo4jService)**

`src/patterns/patterns.repository.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { PatternsRepository } from "./patterns.repository";

const neo4j = { run: vi.fn() };
const repo = new PatternsRepository(neo4j as any);

describe("PatternsRepository", () => {
  it("search, vektör index'i çağırır ve hit map'ler", async () => {
    neo4j.run.mockResolvedValueOnce({
      records: [{
        get: (k: string) => k === "score" ? 0.91
          : { properties: { id: "1", name: "n", description: "d", tags: [], graphJson: '{"nodes":[],"edges":[]}', source: "seed", createdAt: "2026-05-22T00:00:00.000Z" } },
      }],
    });
    const hits = await repo.search([0.1, 0.2], 3, 0.7);
    expect(hits[0].score).toBe(0.91);
    expect(neo4j.run.mock.calls[0][0]).toContain("db.index.vector.queryNodes");
    expect(neo4j.run.mock.calls[0][1]).toEqual({ k: 3, embedding: [0.1, 0.2], minScore: 0.7 });
  });

  it("getById yoksa null döner", async () => {
    neo4j.run.mockResolvedValueOnce({ records: [] });
    expect(await repo.getById("x")).toBeNull();
  });
});
```

- [ ] **Step 3: Test pass + commit**

Run: `pnpm vitest run src/patterns/patterns.repository.spec.ts`
Expected: PASS (2 test).

```bash
git add src/patterns/patterns.repository.ts src/patterns/patterns.repository.spec.ts
git commit -m "feat(patterns): repository — Cypher CRUD + native vektör arama"
```

---

### Task 7: Patterns service

**Files:**
- Create: `src/patterns/patterns.service.ts`
- Test: `src/patterns/patterns.service.spec.ts`

- [ ] **Step 1: Service**

`src/patterns/patterns.service.ts`:

```ts
import { Injectable, Inject, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PatternsRepository, type PatternSearchHit } from "./patterns.repository";
import { ProjectsRepository } from "../projects/projects.repository";
import { EMBEDDINGS, type IEmbeddings } from "../embeddings/embeddings.types";
import type { CreatePatternInput, StoredPattern, PatternSummary, PatternGraph } from "./schemas/pattern.schema";

@Injectable()
export class PatternsService {
  constructor(
    private readonly repo: PatternsRepository,
    private readonly projectsRepo: ProjectsRepository,
    @Inject(EMBEDDINGS) private readonly embeddings: IEmbeddings,
  ) {}

  private embedText(p: { name: string; description: string; tags: string[] }): string {
    return `${p.name}\n${p.description}\n${p.tags.join(" ")}`;
  }

  async create(input: CreatePatternInput, source: "seed" | "promoted" = "seed"): Promise<PatternSummary> {
    this.assertEmbeddings();
    const stored: StoredPattern = {
      id: randomUUID(), name: input.name, description: input.description,
      tags: input.tags, graph: input.graph, source, createdAt: new Date().toISOString(),
    };
    const vec = await this.embeddings.embed(this.embedText(stored));
    await this.repo.create(stored, vec);
    return summarize(stored);
  }

  list(): Promise<PatternSummary[]> { return this.repo.list(); }

  async getById(id: string): Promise<StoredPattern> {
    const p = await this.repo.getById(id);
    if (!p) throw new NotFoundException({ code: "ERR_PATTERN_NOT_FOUND", message: `Pattern '${id}' bulunamadı.` });
    return p;
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repo.delete(id)))
      throw new NotFoundException({ code: "ERR_PATTERN_NOT_FOUND", message: `Pattern '${id}' bulunamadı.` });
  }

  /** Sorgu metnini embed edip top-K döner. Embedding yoksa boş (degrade). */
  async search(query: string, k: number, minScore: number): Promise<PatternSearchHit[]> {
    if (!this.embeddings.isConfigured()) return [];
    const vec = await this.embeddings.embed(query);
    return this.repo.search(vec, k, minScore);
  }

  /** Proje grafiğinden pattern terfi. nodeIds verilmezse tüm proje. */
  async promoteFromProject(
    projectId: string,
    input: { name: string; description: string; tags?: string[]; nodeIds?: string[] },
  ): Promise<PatternSummary> {
    const project = await this.projectsRepo.getById(projectId);
    if (!project) throw new NotFoundException({ code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' bulunamadı.` });
    const { nodes, edges } = await this.projectsRepo.getGraph(projectId);

    const selected = input.nodeIds?.length
      ? nodes.filter((n) => input.nodeIds!.includes(n.id))
      : nodes;
    if (selected.length === 0)
      throw new NotFoundException({ code: "ERR_PATTERN_NODE_NOT_FOUND", message: "Seçili nodeIds projede bulunamadı." });

    // gerçek id → tempId; sadece seçili node'lar arası edge'ler.
    const idToTemp = new Map<string, string>();
    selected.forEach((n, i) => idToTemp.set(n.id, `t_${i}_${n.type.toLowerCase()}`));
    const graph: PatternGraph = {
      nodes: selected.map((n) => ({ tempId: idToTemp.get(n.id)!, type: n.type, properties: n.properties })),
      edges: edges
        .filter((e) => idToTemp.has(e.sourceNodeId) && idToTemp.has(e.targetNodeId))
        .map((e) => ({
          sourceTempId: idToTemp.get(e.sourceNodeId)!,
          targetTempId: idToTemp.get(e.targetNodeId)!,
          edgeType: e.kind,
          label: e.properties?.Label,
        })),
    };
    return this.create({ name: input.name, description: input.description, tags: input.tags ?? [], graph }, "promoted");
  }

  private assertEmbeddings(): void {
    if (!this.embeddings.isConfigured())
      throw new ServiceUnavailableException({ code: "ERR_EMBEDDINGS_NOT_CONFIGURED", message: "Embedding sağlayıcı yapılandırılmamış (BEDROCK_API_KEY)." });
  }
}

function summarize(p: StoredPattern): PatternSummary {
  return {
    id: p.id, name: p.name, description: p.description, tags: p.tags,
    source: p.source, createdAt: p.createdAt,
    nodeCount: p.graph.nodes.length, edgeCount: p.graph.edges.length,
  };
}
```

- [ ] **Step 2: Failing test (mock repo + mock embeddings)**

`src/patterns/patterns.service.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { PatternsService } from "./patterns.service";

const graph = { nodes: [{ tempId: "t", type: "Controller", properties: {} }], edges: [] };

function make(embConfigured = true) {
  const repo = { create: vi.fn(), list: vi.fn(), getById: vi.fn(), delete: vi.fn(), search: vi.fn().mockResolvedValue([]) };
  const projectsRepo = { getById: vi.fn(), getGraph: vi.fn() };
  const embeddings = { isConfigured: () => embConfigured, embed: vi.fn().mockResolvedValue([0.1, 0.2]), embedBatch: vi.fn() };
  return { svc: new PatternsService(repo as any, projectsRepo as any, embeddings as any), repo, projectsRepo, embeddings };
}

describe("PatternsService", () => {
  it("create embed edip repo.create çağırır", async () => {
    const { svc, repo, embeddings } = make();
    await svc.create({ name: "n", description: "d", tags: [], graph } as any);
    expect(embeddings.embed).toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: "n", source: "seed" }), [0.1, 0.2]);
  });

  it("embedding yoksa search boş döner (degrade)", async () => {
    const { svc, embeddings } = make(false);
    expect(await svc.search("x", 3, 0.7)).toEqual([]);
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it("embedding yoksa create 503 fırlatır", async () => {
    const { svc } = make(false);
    await expect(svc.create({ name: "n", description: "d", tags: [], graph } as any)).rejects.toThrow();
  });

  it("promote: olmayan proje 404", async () => {
    const { svc, projectsRepo } = make();
    projectsRepo.getById.mockResolvedValue(null);
    await expect(svc.promoteFromProject("p", { name: "n", description: "d" })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Test pass + commit**

Run: `pnpm vitest run src/patterns/patterns.service.spec.ts`
Expected: PASS (4 test).

```bash
git add src/patterns/patterns.service.ts src/patterns/patterns.service.spec.ts
git commit -m "feat(patterns): service — embed+store, search (degrade), promote"
```

---

### Task 8: Patterns controller + DTO + modül

**Files:**
- Create: `src/patterns/dto/create-pattern.dto.ts`, `dto/search-pattern.dto.ts`, `dto/promote-pattern.dto.ts`, `patterns.controller.ts`, `patterns.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/patterns/patterns.controller.spec.ts`

- [ ] **Step 1: DTO sınıfları**

`src/patterns/dto/create-pattern.dto.ts`:

```ts
import { createZodDto } from "nestjs-zod";
import { CreatePatternSchema } from "../schemas/pattern.schema";
export class CreatePatternDto extends createZodDto(CreatePatternSchema) {}
```

`src/patterns/dto/search-pattern.dto.ts`:

```ts
import { createZodDto } from "nestjs-zod";
import { SearchPatternSchema } from "../schemas/pattern.schema";
export class SearchPatternDto extends createZodDto(SearchPatternSchema) {}
```

`src/patterns/dto/promote-pattern.dto.ts`:

```ts
import { z } from "zod";
import { createZodDto } from "nestjs-zod";
export const PromotePatternSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  nodeIds: z.array(z.string().uuid()).optional(),
}).strict();
export type PromotePatternInput = z.infer<typeof PromotePatternSchema>;
export class PromotePatternDto extends createZodDto(PromotePatternSchema) {}
```

- [ ] **Step 2: Controller**

`src/patterns/patterns.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { PatternsService } from "./patterns.service";
import { CreatePatternDto } from "./dto/create-pattern.dto";
import { SearchPatternDto } from "./dto/search-pattern.dto";
import { PromotePatternDto } from "./dto/promote-pattern.dto";
import { ok } from "../common/envelope";
import { env } from "../config/env";

@ApiTags("Patterns (GraphRAG)")
@Controller()
export class PatternsController {
  constructor(private readonly service: PatternsService) {}

  @Post("patterns")
  @ApiOperation({ summary: "Pattern oluştur", description: "Alt-graf + açıklama; embed edilip vektör index'e yazılır." })
  @ApiResponse({ status: 201, description: "Oluşturulan pattern özeti." })
  async create(@Body() body: CreatePatternDto) {
    return ok(await this.service.create(body as any));
  }

  @Get("patterns")
  @ApiOperation({ summary: "Pattern listesi" })
  async list() { return ok(await this.service.list()); }

  @Get("patterns/:id")
  @ApiOperation({ summary: "Tek pattern (graphJson dahil)" })
  @ApiParam({ name: "id", description: "Pattern UUID" })
  @ApiResponse({ status: 404, description: "ERR_PATTERN_NOT_FOUND" })
  async getById(@Param("id") id: string) { return ok(await this.service.getById(id)); }

  @Delete("patterns/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "Pattern sil" })
  async delete(@Param("id") id: string) { await this.service.delete(id); }

  @Post("patterns/search")
  @HttpCode(200)
  @ApiOperation({ summary: "Semantik pattern arama", description: "Sorguyu embed eder, native vektör index'te top-K cosine döner." })
  async search(@Body() body: SearchPatternDto) {
    const { query, k, minScore } = body as any;
    return ok(await this.service.search(query, k ?? env.EMBED_TOP_K, minScore ?? env.EMBED_MIN_SCORE));
  }

  @Post("projects/:projectId/patterns/promote")
  @ApiOperation({ summary: "Proje grafiğinden pattern terfi", description: "nodeIds verilmezse tüm proje grafiği pattern'e dönüşür." })
  @ApiParam({ name: "projectId", description: "Proje UUID" })
  @ApiResponse({ status: 404, description: "ERR_PROJECT_NOT_FOUND / ERR_PATTERN_NODE_NOT_FOUND" })
  async promote(@Param("projectId") projectId: string, @Body() body: PromotePatternDto) {
    return ok(await this.service.promoteFromProject(projectId, body as any));
  }
}
```

- [ ] **Step 3: Module**

`src/patterns/patterns.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { Neo4jModule } from "../neo4j/neo4j.module";
import { ProjectsModule } from "../projects/projects.module";
import { EmbeddingsModule } from "../embeddings/embeddings.module";
import { PatternsController } from "./patterns.controller";
import { PatternsService } from "./patterns.service";
import { PatternsRepository } from "./patterns.repository";

@Module({
  imports: [Neo4jModule, ProjectsModule, EmbeddingsModule],
  controllers: [PatternsController],
  providers: [PatternsService, PatternsRepository],
  exports: [PatternsService],
})
export class PatternsModule {}
```

- [ ] **Step 4: app.module.ts'e ekle**

`src/app.module.ts` `imports` dizisine `PatternsModule` ve `EmbeddingsModule` ekle (import satırlarıyla birlikte). Doğrula: `Neo4jModule` ve `ProjectsModule` zaten export ediyor (mevcut desen).

- [ ] **Step 5: Controller smoke test**

`src/patterns/patterns.controller.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { PatternsController } from "./patterns.controller";

describe("PatternsController", () => {
  const service = { create: vi.fn().mockResolvedValue({ id: "1" }), search: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue([]) };
  const c = new PatternsController(service as any);

  it("create envelope döner", async () => {
    const r = await c.create({ name: "n", description: "d", tags: [], graph: { nodes: [], edges: [] } } as any);
    expect(r).toEqual({ success: true, data: { id: "1" } });
  });
  it("search default k/minScore geçirir", async () => {
    await c.search({ query: "x" } as any);
    expect(service.search).toHaveBeenCalledWith("x", expect.any(Number), expect.any(Number));
  });
});
```

- [ ] **Step 6: Test + build + commit**

Run: `pnpm vitest run src/patterns && pnpm build`
Expected: PASS + build temiz.

```bash
git add src/patterns/ src/app.module.ts
git commit -m "feat(patterns): controller + DTO + modül (CRUD + search + promote)"
```

---

### Task 9: Seed — kanonik pattern'ler

**Files:**
- Create: `src/patterns/seed/canonical-patterns.ts`, `src/patterns/seed/seed.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Kanonik pattern verisi**

`src/patterns/seed/canonical-patterns.ts` — `CreatePatternInput[]` (en az 12). Her biri enriched v4
node şemalarına uymalı. Örnek 2 giriş (kalanları aynı yapıda ekle: JWT auth akışı, katmanlı CRUD,
Saga ödeme, CQRS read model, cache-aside, event-driven handler, API gateway routing,
repository+custom query, DTO validation katmanı, exception hiyerarşisi, worker/cron, external service entegrasyonu):

```ts
import type { CreatePatternInput } from "../schemas/pattern.schema";

export const CANONICAL_PATTERNS: CreatePatternInput[] = [
  {
    name: "Katmanlı CRUD (Controller→Service→Repository→Table)",
    description: "Standart REST CRUD: Controller HTTP isteğini alır, Service iş mantığını çalıştırır, Repository veriye erişir, Table veriyi tutar. En yaygın backend katmanlı mimari.",
    tags: ["crud", "layered", "rest", "backend"],
    graph: {
      nodes: [
        { tempId: "t_ctrl", type: "Controller", properties: { ControllerName: "ResourceController", Description: "Kaynak REST API", BaseRoute: "/api/v1/resources", Endpoints: [{ HttpMethod: "POST", Route: "/", RequestDTORef: "CreateResourceDTO", ResponseDTORef: "ResourceDTO", RequiresAuth: true }] } },
        { tempId: "t_svc", type: "Service", properties: { ServiceName: "ResourceService", Description: "Kaynak iş mantığı", IsTransactionScoped: true, Methods: [{ MethodName: "create", Parameters: [{ Name: "dto", Type: "CreateResourceDTO", DtoRef: "CreateResourceDTO" }], ReturnType: "ResourceDTO", ReturnDtoRef: "ResourceDTO", IsAsync: true }], Dependencies: [{ Kind: "Repository", Ref: "ResourceRepository" }] } },
        { tempId: "t_repo", type: "Repository", properties: { RepositoryName: "ResourceRepository", Description: "Kaynak veri erişimi", EntityReference: "resources", IsCached: false, CustomQueries: [] } },
        { tempId: "t_tbl", type: "Table", properties: { TableName: "resources", Description: "Kaynak tablosu", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }] } },
        { tempId: "t_dto", type: "DTO", properties: { Name: "CreateResourceDTO", Description: "Kaynak oluşturma isteği", Fields: [{ Name: "name", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "MinLength", Value: "1" }] }] } },
      ],
      edges: [
        { sourceTempId: "t_ctrl", targetTempId: "t_svc", edgeType: "CALLS" },
        { sourceTempId: "t_svc", targetTempId: "t_repo", edgeType: "CALLS" },
        { sourceTempId: "t_repo", targetTempId: "t_tbl", edgeType: "WRITES" },
        { sourceTempId: "t_ctrl", targetTempId: "t_dto", edgeType: "USES" },
      ],
    },
  },
  {
    name: "Cache-aside (Service→Cache + Service→Repository)",
    description: "Okuma yükünü azaltmak için cache-aside deseni: Service önce Cache'e bakar, yoksa Repository'den okur ve Cache'e yazar. Redis TTL'li.",
    tags: ["cache", "performance", "read-heavy", "redis"],
    graph: {
      nodes: [
        { tempId: "t_svc", type: "Service", properties: { ServiceName: "ProfileService", Description: "Profil okuma", IsTransactionScoped: false, Methods: [{ MethodName: "getProfile", Parameters: [{ Name: "id", Type: "UUID" }], ReturnType: "ProfileDTO", IsAsync: true }], Dependencies: [{ Kind: "Cache", Ref: "ProfileCache" }, { Kind: "Repository", Ref: "ProfileRepository" }] } },
        { tempId: "t_cache", type: "Cache", properties: { CacheName: "ProfileCache", Description: "Profil cache", KeyPattern: "profile:{id}", TTL_Seconds: 3600, Engine: "Redis", EvictionPolicy: "LRU" } },
        { tempId: "t_repo", type: "Repository", properties: { RepositoryName: "ProfileRepository", Description: "Profil veri erişimi", EntityReference: "profiles", IsCached: true, CustomQueries: [] } },
      ],
      edges: [
        { sourceTempId: "t_svc", targetTempId: "t_cache", edgeType: "CACHES_IN" },
        { sourceTempId: "t_svc", targetTempId: "t_repo", edgeType: "CALLS" },
      ],
    },
  },
  // … kalan 10 pattern aynı yapıda (yukarıdaki listeyi tamamla)
];
```

> **Not:** Edge `edgeType` değerleri mevcut `EdgeKindSchema`'ya uymalı (CALLS/WRITES/QUERIES/USES/CACHES_IN/PUBLISHES/SUBSCRIBES/ROUTES_TO/HAS/RETURNS/EXTENDS/THROWS/DEPENDS_ON/READS_CONFIG vb). Node properties enriched v4 şemalarına uymalı — emin değilsen `GET /api/v1/node-types/:id` şemasına bak.

- [ ] **Step 2: Seed runner (idempotent)**

`src/patterns/seed/seed.ts`:

```ts
import { Neo4jService } from "../../neo4j/neo4j.service";
import { ProjectsRepository } from "../../projects/projects.repository";
import { PatternsRepository } from "../patterns.repository";
import { PatternsService } from "../patterns.service";
import { EmbeddingsService } from "../../embeddings/embeddings.service";
import { CANONICAL_PATTERNS } from "./canonical-patterns";
import { env } from "../../config/env";

async function main(): Promise<void> {
  const neo4j = new Neo4jService({ uri: env.NEO4J_URI, user: env.NEO4J_USER, password: env.NEO4J_PASSWORD });
  await neo4j.onModuleInit();
  const repo = new PatternsRepository(neo4j);
  const svc = new PatternsService(repo, new ProjectsRepository(neo4j), new EmbeddingsService());

  let created = 0, skipped = 0;
  for (const p of CANONICAL_PATTERNS) {
    if (await repo.findByName(p.name)) { skipped++; continue; }
    await svc.create(p, "seed");
    created++;
  }
  await neo4j.onModuleDestroy();
  console.log(`✓ Pattern seed: ${created} eklendi, ${skipped} atlandı (mevcut).`);
}

main().catch((e) => { console.error("✗ Seed failed:", e); process.exit(1); });
```

- [ ] **Step 3: package.json script**

```json
"seed:patterns": "tsx --env-file=.env src/patterns/seed/seed.ts"
```

- [ ] **Step 4: Seed çalıştır (Neo4j + vektör index + Bedrock açık)**

Run: `pnpm migrate:patterns-index && pnpm seed:patterns`
Expected: `✓ Pattern seed: 12 eklendi, 0 atlandı.` (ikinci çalıştırmada hepsi atlanır → idempotent)

Doğrula: `curl -s http://localhost:4000/api/v1/patterns | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']),'pattern')"`

- [ ] **Step 5: Commit**

```bash
git add src/patterns/seed/ package.json
git commit -m "feat(patterns): seed — 12 kanonik mimari pattern (enriched v4)"
```

---

### Task 10: AI retrieval entegrasyonu + prompt enjeksiyonu

**Files:**
- Modify: `src/ai/prompts/system-prompt.ts`, `src/ai/ai.service.ts`, `src/ai/ai.module.ts`
- Test: `src/ai/prompts/system-prompt.spec.ts` (yeni)

- [ ] **Step 1: buildSystemPrompt'a patterns parametresi**

`src/ai/prompts/system-prompt.ts` — `buildSystemPrompt` imzasını genişlet:

```ts
import type { PatternSearchHit } from "../../patterns/patterns.repository";

export function buildSystemPrompt(graph: ProjectGraph, patterns: PatternSearchHit[] = []): string {
  // … mevcut nodeSummary/edgeSummary …

  const patternBlock = patterns.length === 0 ? "" : `

## İLGİLİ REFERANS DESENLER (retrieval)
Aşağıdaki kanıtlanmış mimari desenler isteğine yakın. Uygunsa bunlara benzeterek üret (birebir kopyalama; uyarlayıp gerekeni ekle):
${patterns.map((h) => {
  const g = h.pattern.graph;
  const nodeTypes = g.nodes.map((n) => n.type).join(", ");
  const edgeKinds = g.edges.map((e) => e.edgeType).join(", ");
  return `- **${h.pattern.name}** (benzerlik ${h.score.toFixed(2)}): ${h.pattern.description}\n  Yapı: ${g.nodes.length} node [${nodeTypes}], edge'ler [${edgeKinds || "yok"}]`;
}).join("\n")}`;

  return `${BASE_PROMPT}
${patternBlock}

## MEVCUT KANVAS DURUMU (current_graph)
…`; // mevcut current_graph bölümü patternBlock'tan SONRA gelir
}
```

(Mevcut `return` template'ini koru; sadece `${patternBlock}` satırını BASE_PROMPT ile current_graph arasına ekle.)

- [ ] **Step 2: Failing test**

`src/ai/prompts/system-prompt.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

const emptyGraph = { project: {} as any, nodes: [], edges: [], counts: { nodes: 0, edges: 0 } };

describe("buildSystemPrompt patterns", () => {
  it("pattern yoksa REFERANS DESENLER bölümü yok", () => {
    expect(buildSystemPrompt(emptyGraph as any)).not.toContain("REFERANS DESENLER");
  });
  it("pattern varsa isim + skor + yapı enjekte eder", () => {
    const hits = [{ score: 0.88, pattern: { name: "Katmanlı CRUD", description: "açıklama", graph: { nodes: [{ tempId: "t", type: "Controller", properties: {} }], edges: [] } } }];
    const p = buildSystemPrompt(emptyGraph as any, hits as any);
    expect(p).toContain("REFERANS DESENLER");
    expect(p).toContain("Katmanlı CRUD");
    expect(p).toContain("0.88");
    expect(p).toContain("Controller");
  });
});
```

- [ ] **Step 3: Test fail → Step 1'i uygula → pass**

Run: `pnpm vitest run src/ai/prompts/system-prompt.spec.ts`
Expected: PASS (2 test).

- [ ] **Step 4: ai.service retrieval enjeksiyonu**

`src/ai/ai.service.ts` — `PatternsService` enjekte et, `chat` içinde current_graph yüklendikten sonra:

```ts
// constructor'a ekle: private readonly patterns: PatternsService,
// chat() içinde, buildSystemPrompt çağrısından ÖNCE:
let patternHits: PatternSearchHit[] = [];
try {
  patternHits = await this.patterns.search(body.message, env.EMBED_TOP_K, env.EMBED_MIN_SCORE);
} catch (e) {
  this.logger.warn(`Pattern retrieval atlandı: ${(e as Error).message}`);
}
const systemPrompt = buildSystemPrompt({ project, nodes, edges, counts: { nodes: nodes.length, edges: edges.length } }, patternHits);
```

(import: `PatternsService`, `PatternSearchHit`, `env`. Mevcut `buildSystemPrompt` çağrısını bununla değiştir.)

- [ ] **Step 5: ai.module.ts'e PatternsModule ekle**

`src/ai/ai.module.ts` `imports`'a `PatternsModule` ekle (PatternsService inject edilebilsin).

- [ ] **Step 6: Test + build + commit**

Run: `pnpm vitest run src/ai && pnpm build`
Expected: PASS + build temiz.

```bash
git add src/ai/
git commit -m "feat(ai): GraphRAG — retrieval edilen pattern'leri system prompt'a enjekte et"
```

---

### Task 11: E2E — fake embedder + vektör index round-trip

**Files:**
- Create: `test/patterns.e2e-spec.ts`
- Referans: `test/nodes.e2e-spec.ts` (Test.createTestingModule + overrideProvider deseni)

- [ ] **Step 1: Fake embedder + e2e**

`test/patterns.e2e-spec.ts` — gerçek embedding API'ye bağlanmadan vektör index Cypher'ını doğrular.
Deterministik fake embedder: metni `EMBED_DIM` boyutlu sabit vektöre map'ler.

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AppModule } from "../src/app.module";
import { EMBEDDINGS } from "../src/embeddings/embeddings.types";
import { Neo4jService } from "../src/neo4j/neo4j.service";
import { env } from "../src/config/env";

// Deterministik fake: char-code toplamını dim boyutuna yayar, normalize eder.
function fakeVec(text: string): number[] {
  const dim = env.EMBED_DIM;
  const v = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) v[i % dim] += text.charCodeAt(i);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
const fakeEmbeddings = {
  isConfigured: () => true,
  embed: async (t: string) => fakeVec(t),
  embedBatch: async (ts: string[]) => ts.map(fakeVec),
};

describe("Patterns E2E", () => {
  let app: INestApplication;
  let neo4j: Neo4jService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDINGS).useValue(fakeEmbeddings)
      .compile();
    app = mod.createNestApplication();
    await app.init();
    neo4j = app.get(Neo4jService);
    // vektör index (idempotent)
    await neo4j.run(
      `CREATE VECTOR INDEX pattern_embedding IF NOT EXISTS FOR (p:Pattern) ON (p.embedding)
       OPTIONS { indexConfig: { \`vector.dimensions\`: $dim, \`vector.similarity_function\`: 'cosine' } }`,
      { dim: env.EMBED_DIM },
    );
    await neo4j.run(`MATCH (p:Pattern) DELETE p`); // temiz başlangıç
  });

  afterAll(async () => {
    await neo4j.run(`MATCH (p:Pattern) DELETE p`);
    await app.close();
  });

  const base = "/api/v1";
  const graph = { nodes: [{ tempId: "t_ctrl", type: "Controller", properties: { ControllerName: "X", Description: "d", BaseRoute: "/x", Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false }] } }], edges: [] };

  it("create → list → search round-trip", async () => {
    const create = await request(app.getHttpServer()).post(`${base}/patterns`)
      .send({ name: "Auth akışı", description: "JWT login authentication", tags: ["auth"], graph }).expect(201);
    expect(create.body.data.name).toBe("Auth akışı");

    await request(app.getHttpServer()).get(`${base}/patterns`).expect(200)
      .then((r) => expect(r.body.data.length).toBeGreaterThanOrEqual(1));

    // vektör index'in indekslemesi için kısa bekleme (Neo4j eventual)
    await new Promise((r) => setTimeout(r, 1500));
    const search = await request(app.getHttpServer()).post(`${base}/patterns/search`)
      .send({ query: "JWT login authentication", k: 5, minScore: 0 }).expect(200);
    expect(search.body.data.length).toBeGreaterThanOrEqual(1);
    expect(search.body.data[0].pattern.name).toBe("Auth akışı");
    expect(search.body.data[0].score).toBeGreaterThan(0);
  });

  it("getById olmayan → 404", async () => {
    await request(app.getHttpServer()).get(`${base}/patterns/00000000-0000-0000-0000-000000000000`).expect(404);
  });
});
```

- [ ] **Step 2: E2E çalıştır**

Run: `pnpm test:e2e`
Expected: 2 patterns e2e + mevcut 9 nodes e2e = PASS. (Testcontainers Neo4j 5-community vektör index destekler.)

> Eğer vektör index Testcontainers imajında yoksa: `docker-compose.yml`'deki `neo4j:5-community` zaten 5.x; e2e Testcontainers de `neo4j:5-community` kullanmalı (`test/` setup'ını kontrol et, gerekirse imaj tag'ini eşitle).

- [ ] **Step 3: Commit**

```bash
git add test/patterns.e2e-spec.ts
git commit -m "test(patterns): e2e — fake embedder + vektör index search round-trip"
```

---

### Task 12: Canlı doğrulama + push

**Files:** yok (doğrulama).

- [ ] **Step 1: Tam test paketi**

Run: `pnpm test`
Expected: tüm unit PASS (env.spec dahil).

Run: `pnpm test:e2e`
Expected: tüm e2e PASS.

- [ ] **Step 2: Server + gerçek Bedrock embeddings ile canlı**

```bash
pnpm build
pnpm migrate:patterns-index
pnpm seed:patterns           # gerçek Bedrock ile ~12 pattern embed
set -a; source .env; set +a
PORT=4000 node dist/main.js &
# 1) semantik arama:
curl -s -X POST localhost:4000/api/v1/patterns/search -H 'Content-Type: application/json' \
  -d '{"query":"kullanıcı CRUD API katmanlı"}' | python3 -m json.tool
# 2) agent retrieval: proje oluştur + chat; system prompt'a pattern enjekte mi?
```

Expected:
- Search, "Katmanlı CRUD" pattern'ini yüksek skorla döner.
- AI chat isteğinde ilgili pattern enjekte edilir; agent benzer yapı üretir (loglardan/çıktıdan doğrula).

- [ ] **Step 3: Memory + push**

Memory dosyası `project_solarch_backend_phase1.md`'ye Phase 4 özeti ekle (pattern lib + vector index + embeddings + retrieval; embedding model+dim Task 1 sonucu; gotchas).

```bash
git push origin main
```

---

## Faz Çıkış Kriterleri (Spec ile)

- [ ] Embedding endpoint + model + dim doğrulandı (Task 1) → env (Task 2)
- [ ] EmbeddingsService provider-abstracted, degrade ediyor (Task 3)
- [ ] Pattern Zod şeması = apply formatı (Task 4)
- [ ] Vektör index migration, env EMBED_DIM (Task 5)
- [ ] Repository native vektör arama (Task 6)
- [ ] Service: embed+store, search (degrade), promote (Task 7)
- [ ] CRUD + search + promote endpoint'leri (Task 8)
- [ ] ~12 kanonik pattern seed, idempotent (Task 9)
- [ ] Retrieval system prompt'a otomatik enjekte (Task 10)
- [ ] E2E fake embedder + vektör index (Task 11)
- [ ] Canlı: gerçek Bedrock embed + agent enjeksiyon (Task 12)

## Notlar

- **Task 1 İLK yapılmalı** — embedding boyutu vektör index'i (Task 5) ve fake embedder'ı (Task 11) belirler. Mantle embeddings sunmuyorsa local'e (Xenova, dim=384) düş; tüm dim referansları env.EMBED_DIM üzerinden olduğu için kod değişmez, sadece env default'u + Task 3 factory branch'i.
- `graphJson` = `GraphService.apply` girdi formatı → ileride "pattern'i doğrudan apply et" bedavaya gelir (Phase 5).
- Retrieval bir *enhancement*: embedding/index/sonuç yoksa agent normal çalışır (degrade, asla hata fırlatmaz — sadece create explicit 503).
- Neo4j vektör index **eventual** indeksler; e2e'de kısa bekleme gerekebilir (Task 11 Step 1).
