# solarch-backend

Solarch'ın mimari graf backend'i — **kural-güdümlü ve AI-augmented**. Node + Edge CRUD, Rules Engine, GraphRAG ve doğal-dil mimari üretimi tek serviste birleşir. Frontend'ten bağımsız geliştirilir; sözleşme `/api/v1/*` üzerinden tipli (Zod + OpenAPI/Scalar) yürür.

## Stack

- **NestJS 11** — modüler yapı, DI, global ZodValidationPipe, 4 ExceptionFilter, `ok()` envelope
- **Neo4j 5** (community) — graf veritabanı + **native vector index** (ekstra DB yok)
- **Zod 4 + nestjs-zod** — discriminated union, runtime + tip + OpenAPI üç başlı şema
- **@langchain/deepseek** — `ChatDeepSeek` v4-flash, `response_format: json_object`
- **@xenova/transformers** — lokal MiniLM-L12-v2 (Türkçe dahil 50+ dil, 384-d)
- **TypeScript 6 · pnpm 10 · Vitest 2 · Testcontainers** — SWC vitest, ManagedTransaction
- **Scalar** — `/docs` üzerinden interaktif API explorer (Swagger değil)

## Modüller

| Modül | Sorumluluk |
|---|---|
| `auth` | Clerk JWT + misafir bileti + **API anahtarı** (`slk_…`, SHA-256 hash'li) — üç kimlik yolu tek guard'da |
| `projects` | Project CRUD + `getGraph(projectId)` + **`graphRevision`** sayacı |
| `tabs` | Çoklu sekme / context — **tek-ev + referans** modeli (`homeTabId` + `REFERENCES {x,y}`) |
| `nodes` | 21 node tipi CRUD, Zod discriminated union, kind başına şema, `version` + `expectedVersion` optimistic locking |
| `edges` | 16 edge kind CRUD + paylaşımlı `properties` şeması |
| `graph` | Batch `apply()` — AI, UI ve **CLI push**'tan gelen mutasyonları atomik commit; mevcut node'lara edge bağlayabilen upsert + `baseRevision` çatışma kontrolü |
| `rules` | Rules Engine: 32 whitelist · 7 blacklist (ERR_001..007) · 3 conditional |
| `node-types` / `edge-types` | Katalog endpoint'leri + `fieldHints` (UI inspector için) |
| `patterns` | Kanonik desen kütüphanesi (12 seed) — GraphRAG kaynağı |
| `embeddings` | Lokal MiniLM, Neo4j vector index — cosine similarity |
| `ai` | Doğal dilden mimari üretim — GraphRAG → structured output → self-correction |

## Veri modeli (özet)

```
(:Project)─HAS─→(:Tab)
(:Project)─HAS─→(:Node)─owns─(:Tab via homeTabId)
(:Tab)─REFERENCES {x,y}─→(:Node)         # import / kısayol
(:Node)─[EDGE_KIND {projectId,...}]─→(:Node)
(:Project)─HAS─→(:Pattern {embedding[]})  # global kütüphane
```

**Tek-ev + referans:** Her node tek bir tab'da yaşar (`positionX/Y` orada). Başka tab'lara `(:Tab)-[:REFERENCES {x,y}]->(:Node)` ile **import** edilir — kopya değil, tek kaynak. Rules Engine sekmeden bağımsız mantıksal graf üzerinde çalışır.

## Eşzamanlılık: iki katmanlı çatışma koruması

| Katman | Mekanizma | Çatışmada |
|---|---|---|
| **Graf revizyonu** | `Project.graphRevision` — her yapısal mutasyonda +1 (node/edge create-update-delete, `graph/apply`). Pozisyon/tab layout kaydetme bump **etmez**. | `graph/apply` + `baseRevision` eskiyse hiçbir şey yazılmadan `409 ERR_GRAPH_REVISION_CONFLICT` + `currentRevision` |
| **Node versiyonu** | `Node.version` — her başarılı PATCH +1; istemci `expectedVersion` gönderir. | `409 ERR_VERSION_CONFLICT` + `currentVersion` |

`GET /projects/:id/graph` yanıtı `graphRevision` döner; CLI push delta'yı bu
revizyona göre hesaplar ve 409'da otomatik re-pull + tek retry yapar. Tasarım
detayı: [`docs/specs/2026-06-12-graph-revision-and-cli-push.md`](docs/specs/2026-06-12-graph-revision-and-cli-push.md).

## Kimlik doğrulama (üç yol, tek guard)

`ClerkAuthGuard` sırayla dener:

1. **Clerk JWT** (web uygulaması — `Authorization: Bearer <jwt>`)
2. **Misafir bileti** (`X-Guest-Token` header'ı veya `solarch_guest_token` çerezi — HMAC imzalı, 30 gün TTL)
3. **API anahtarı** (CLI/MCP — `Authorization: Bearer slk_…`; Neo4j'de yalnız SHA-256 hash saklanır, anahtar bir kez gösterilir)

Anahtar yönetimi: `POST/GET/DELETE /api/v1/api-keys` (Clerk oturumu gerekir, misafir açamaz; kullanıcı başına en çok 10 anahtar).

## AI akışı

Doğal dil → embed → Neo4j vector search (top-K pattern) → system prompt + RAG context → DeepSeek v4-flash (`json_object`) → Zod parse → `graph.apply()` → Rules Engine değerlendirir → ihlal varsa **self-correction loop** (max 5 deneme) → atomik commit.

Detay: [`docs/architecture/ai-flow.md`](docs/) + repo kök `SOLARCH-ARCHITECTURE.md` (üst dizin).

## API yüzeyi (öne çıkan)

| Method | Path | Açıklama |
|---|---|---|
| `GET` | `/api/v1/health` | Liveness |
| `GET/POST` | `/api/v1/projects` | Project CRUD |
| `GET` | `/api/v1/projects/:pid/graph` | Tüm graf + `graphRevision` |
| `PUT` | `/api/v1/projects/:pid/implementation` | İmplementasyon sayaçları (`implTotal`, `implFilled`, `implAi`) — CLI/eklenti raporu; yapısal mutasyon değil |
| `GET/POST/DELETE` | `/api/v1/projects/:pid/tabs[/:tabId]` | Tab CRUD |
| `GET` | `/api/v1/projects/:pid/tabs/:tabId/graph` | Tab-scoped graf (home + REFERENCES) |
| `POST` | `/api/v1/projects/:pid/tabs/:tabId/references` | Node'u tab'a import |
| `*` | `/api/v1/projects/:pid/nodes[/:nodeId]` | Node CRUD (21 tip) |
| `*` | `/api/v1/projects/:pid/edges[/:edgeId]` | Edge CRUD (16 kind) |
| `POST` | `/api/v1/projects/:pid/graph/apply` | Atomik batch mutate (AI + UI + CLI push) — tempId/cloudId karışık edge uçları, opsiyonel `baseRevision` |
| `POST/GET/DELETE` | `/api/v1/api-keys[/:keyId]` | API anahtarı yönetimi (CLI/MCP kimliği) |
| `POST` | `/api/v1/projects/:pid/projects/:id/repair` | Tek-round repair |
| `GET` | `/api/v1/node-types` · `/edge-types` · `/rules` | Katalog |
| `POST` | `/api/v1/projects/:pid/ai/chat` | Doğal dil mimari üretim |
| `GET` | `/docs` | Scalar UI |

## Geliştirme

```bash
# 1. Bağımlılıklar
pnpm install

# 2. Neo4j (Docker)
pnpm neo4j:up

# 3. Constraints + vector index migration
cp .env.example .env   # gerekli anahtarları doldur
pnpm neo4j:migrate

# 4. Dev server (watch + Scalar at /docs)
pnpm dev               # http://localhost:4000/api/v1

# 5. Testler
pnpm test              # unit
pnpm test:e2e          # e2e (Testcontainers — ilk run ~2dk)
```

## Çevre değişkenleri (özet)

| Anahtar | Default | Not |
|---|---|---|
| `PORT` | `4000` | |
| `NEO4J_URI` / `USER` / `PASSWORD` | — | zorunlu |
| `CORS_ORIGIN` | `http://localhost:3000` | frontend origin'i |
| `LLM_GENERATION_PROVIDER` | `deepseek` | `bedrock` da var |
| `DEEPSEEK_API_KEY` | — | yoksa `/ai/chat` 503 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | compose tier; v4-pro çok yavaş |
| `EMBED_PROVIDER` | `local` | `@xenova/transformers` (offline) |
| `EMBED_MODEL` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 384-d, çok dilli |
| `EMBED_TOP_K` / `MIN_SCORE` | `3` / `0.7` | GraphRAG eşikleri |

Tam liste: [`src/config/env.ts`](src/config/env.ts).

## Yol haritası

| Faz | Kapsam | Durum |
|---|---|---|
| 1 | Project + Node CRUD (Veri ailesi) | DONE |
| 1.5 | Diğer node aileleri (21 tip toplam) | DONE |
| 2 | Edge CRUD + Rules Engine (whitelist/blacklist/conditional) | DONE |
| 3 | Graph atomik apply + Tabs/Contexts (tek-ev + referans) | DONE |
| 3B | AI Service — GraphRAG + structured output + self-correction | DONE |
| 4 | Node enrichment — codegen-ready properties (Faz A/B/C) | DONE |
| 5 | Kod üretim motoru (AST scaffold + cerrahi AI) | DONE |
| 2.0-1 | API anahtarları (CLI/MCP kimliği) — SOLARCH 2.0 Faz 1 | DONE |
| 2.0-2 | Graf revizyonu + apply upsert + çatışma çözümleme — SOLARCH 2.0 Faz 2 | DONE |
| 2.0-3 | MCP sunucusu (`solarch-mcp`) — ajanlara bağlam + kural denetimli mutasyon — SOLARCH 2.0 Faz 3 | DONE |

## Yeni node tipi ekleme

Üç adım — kuralın kendisi ([spec](docs/specs/) Section 6):

1. `src/nodes/schemas/<kind>.schema.ts` — `BaseNodeSchema.extend({ type: z.literal("Foo"), properties: z.object({...}).strict() }).strict()`
2. `src/nodes/schemas/index.ts` — `NodeSchema` discriminated union'una ekle + `KIND_LABELS` haritasını güncelle
3. `src/nodes/schemas/<kind>.schema.spec.ts` — valid + invalid payload örnekleri

Union'a girmeyen tip TS compile + Zod runtime'da reddedilir.

## Lisans

Henüz lisanslanmadı.
