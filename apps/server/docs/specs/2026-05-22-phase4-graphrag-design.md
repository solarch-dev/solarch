# Phase 4 — Pattern Library + GraphRAG Tasarımı

**Tarih:** 2026-05-22
**Durum:** Onaylandı (tasarım), implementasyon bekliyor
**Önceki:** Phase 3B (AI agent), Node Enrichment Faz A/B/C (21 node v4 codegen-ready)

## 1. Amaç

AI mimar agent'ının (Phase 3B: Kimi K2.5 generation + DeepSeek chat) üretim
isabetini artırmak. Bunu, kullanıcının isteğine en yakın **kanonik mimari
desenleri** (pattern) semantik olarak getirip system prompt'a enjekte ederek
yaparız. Agent "sıfırdan tahmin" yerine "kanıtlanmış bir desene benzeterek" üretir.

Bu, retrieval-augmented generation'ın (RAG) graf alanına uyarlanmış halidir:
corpus = yeniden kullanılabilir mimari alt-graflar.

## 2. Kapsam kararları (brainstorming çıktısı)

| Karar | Seçim | Gerekçe |
|-------|-------|---------|
| Corpus | Küratörlü **pattern/referans kütüphanesi** (alt-graf + açıklama + metadata) | Yeni kullanıcıda bile değer; agent'a "şuna benzet" zemini |
| Doluluk | **Seed + promote** | Hemen değer (seed) + organik büyüme (promote) |
| Vector store | **Neo4j native vector index** (5.13+ community) | Ekstra servis YOK; pattern'ler zaten graf dünyasında |
| Embedding sağlayıcı | **Bedrock** (bedrock-mantle, mevcut `BEDROCK_API_KEY`), provider-abstracted | LLM ile aynı abstraction, yeni anahtar yok |
| Agent entegrasyonu | **Otomatik enjeksiyon** (LLM turundan önce top-K) | Deterministik, ekstra tur yok, mevcut ReAct loop'a minimal dokunur |

## 3. Veri modeli

`:Pattern` node — proje node'larından izole (ayrı label, `:Node` değil):

```
:Pattern {
  id: string (uuid),
  name: string,
  description: string,           // semantik aramanın embed kaynağı (+ name + tags)
  tags: string[],
  graphJson: string,             // serialized { nodes: [...], edges: [...] } alt-graf
  embedding: float[],            // description+name+tags vektörü
  source: "seed" | "promoted",
  createdAt: string (ISO)
}
```

Vektör index (migration ile):
```cypher
CREATE VECTOR INDEX pattern_embedding IF NOT EXISTS
FOR (p:Pattern) ON (p.embedding)
OPTIONS { indexConfig: {
  `vector.dimensions`: $dim,        // env EMBED_DIM (Titan v2 = 1024)
  `vector.similarity_function`: 'cosine'
} }
```

`graphJson`, GraphService.apply'ın kabul ettiği `{nodes, edges}` (tempId tabanlı)
biçiminde tutulur — agent'a aynen verilebilir, gerekirse doğrudan apply edilebilir.

## 4. Modüller

### `src/embeddings/` — embedding provider abstraction
- `embeddings.factory.ts` — `llm.factory.ts` ikizi. `getEmbedder()` →
  bedrock-mantle'a (OpenAI-uyumlu) bağlı `OpenAIEmbeddings` (mevcut
  `BEDROCK_API_KEY` + `BEDROCK_BASE_URL`). Env: `EMBED_MODEL`, `EMBED_DIM`.
- `embeddings.service.ts` — `embed(text: string): Promise<number[]>`,
  `embedBatch(texts): Promise<number[][]>`. Sağlayıcı yoksa (`isConfigured()=false`)
  çağıranlar graceful davranır.

### `src/patterns/` — pattern kütüphanesi
- `schemas/pattern.schema.ts` — Zod: `PatternSchema`, `CreatePatternSchema`
  (id/embedding/createdAt server üretir), `SearchPatternSchema`.
- `patterns.repository.ts` — Cypher CRUD + `search(vector, k, minScore)`
  (`db.index.vector.queryNodes('pattern_embedding', k, $vec)` + skor filtresi).
- `patterns.service.ts` — create (embed + store), list, getById, delete,
  search (embed query + repo.search), promoteFromProject.
- `patterns.controller.ts` — aşağıdaki endpoint'ler.
- `patterns.module.ts` — EmbeddingsModule + Neo4jModule + ProjectsModule (promote için) import eder.

### Entegrasyon noktaları
- `src/ai/ai.service.ts` — chat akışında retrieval + enjeksiyon (Bölüm 6).
- `src/ai/prompts/system-prompt.ts` — `buildSystemPrompt(graph, patterns?)` —
  yeni opsiyonel `patterns` parametresi + "İLGİLİ REFERANS DESENLER" bölümü.
- `src/neo4j/migrations/` — vektör index migration.
- Seed script: `scripts` veya `src/patterns/seed/` + `pnpm seed:patterns`.

## 5. API

| Endpoint | Body | Dönüş |
|----------|------|-------|
| `POST /patterns` | `{ name, description, tags?, graphJson }` | oluşturulan Pattern (embedding hariç özet) |
| `GET /patterns` | — | Pattern özet listesi |
| `GET /patterns/:id` | — | tek Pattern (graphJson dahil) |
| `DELETE /patterns/:id` | — | 204 |
| `POST /patterns/search` | `{ query, k?, minScore? }` | `[{ pattern, score }]` top-K |
| `POST /projects/:id/patterns/promote` | `{ name, description, tags?, nodeIds? }` | Pattern (nodeIds verilmezse tüm proje grafiği) |

`pnpm seed:patterns` — ~10-15 kanonik pattern (JWT auth akışı, katmanlı CRUD,
Saga ödeme, CQRS read model, cache-aside, event-driven handler, API gateway
routing, repository + custom query, DTO validation katmanı, exception hiyerarşisi).
Her pattern: name + description + graphJson (enriched v4 node şemalarıyla). Idempotent
(aynı isim varsa atla).

## 6. Retrieval akışı (otomatik enjeksiyon)

`AiService.chat(projectId, body)` içinde, `current_graph` yüklendikten sonra,
LLM turundan **önce**:

1. `embeddings.isConfigured()` ise → `vec = embed(body.message)`.
2. `patterns = patternsRepo.search(vec, k=3, minScore=0.7)`.
3. `systemPrompt = buildSystemPrompt(graph, patterns)`.
4. Prompt'a eklenen bölüm:
   ```
   ## İLGİLİ REFERANS DESENLER (retrieval)
   Aşağıdaki kanıtlanmış desenler isteğine yakın. Uygunsa bunlara benzeterek üret:
   - [pattern.name] (skor 0.xx): pattern.description
     Yapı: <graphJson node tipleri + edge'lerin kısa özeti>
   ```
5. Embedding sağlayıcı yok / index yok / sonuç boş → bölüm hiç eklenmez, agent
   normal çalışır.

Enjeksiyon **ilk turda** yapılır (kullanıcı mesajına göre). Self-correction
turlarında tekrar retrieval yapılmaz (mesaj değişmedi).

## 7. Hata yönetimi

- **Embedding sağlayıcı yok**: retrieval atlanır, agent pattern'siz çalışır
  (mevcut davranış). Loglanır, hata fırlatılmaz — retrieval bir *enhancement*.
- **bedrock-mantle `/embeddings` yoksa**: lokal embedder'a (Xenova/transformers.js,
  `EMBED_PROVIDER=local`) düşülür. **Bu uygulamanın İLK adımında doğrulanır**
  (embedding boyutunu → vektör index'i etkiler).
- **Vektör index yok**: `search` boş döner (migration çalıştırılmamış uyarısı log).
- **graphJson geçersiz**: pattern create sırasında `{nodes, edges}` şema doğrulaması
  (Zod) — geçersizse `ERR_PATTERN_INVALID_GRAPH`.
- **promote'ta boş/eksik nodeIds**: proje yoksa `ERR_PROJECT_NOT_FOUND`; nodeIds
  projede yoksa `ERR_PATTERN_NODE_NOT_FOUND`.

## 8. Test stratejisi

- **Unit**: PatternSchema (Zod kabul/red), patterns.service (mock repo + mock
  embedder), embeddings.factory (configured/not), buildSystemPrompt pattern
  enjeksiyonu (string içerik kontrolü), promoteFromProject (mock graph).
- **e2e** (Testcontainers Neo4j 5-community): deterministik **fake embedder**
  enjekte (sabit vektör fonksiyonu) → vektör index migration → `:Pattern` yaz →
  `POST /patterns/search` top-K + skor doğru → `promote` round-trip. Gerçek
  embedding API'ye bağlanmadan vector index Cypher'ı doğrulanır.
- **Canlı** (gerçek Bedrock): `seed:patterns` → bir pattern'e uyan istek → AI
  yanıtında o desenin enjekte edildiği + çıktıyı etkilediği doğrulanır.

## 9. Out of scope (sonraki fazlar)

- Pattern versiyonlama / güncelleme (sadece create+delete; update sonra).
- Otomatik promote tetikleyici (UX-driven; v1 manuel endpoint).
- Çok-kullanıcılı pattern izolasyonu / sahiplik (şu an global kütüphane).
- Embedding cache / re-embed batch job (pattern create'te tek seferlik embed yeter).
- Cross-encoder re-ranking (top-K cosine yeter; gerekirse sonra).
- Codegen entegrasyonu (Phase 5).

## 10. Açık notlar

- Embedding boyutu modele bağlı (Titan v2=1024, Cohere=1024, OpenAI-3-small=1536).
  `EMBED_DIM` env + vektör index aynı değeri kullanmalı. Model değişirse re-embed
  + index yeniden oluşturma gerekir (migration not'u).
- `graphJson` GraphService.apply girdi formatıyla aynı → ileride "pattern'i
  doğrudan uygula" özelliği bedavaya gelir.
- Provider abstraction sayesinde lokal/Bedrock/OpenAI arası geçiş tek factory'de.
