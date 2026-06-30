# Solarch Backend — Node Types & API (Phase 1) Tasarımı

**Tarih:** 2026-05-21
**Durum:** Brainstorm tamamlandı, kullanıcı onayı alındı
**Repo:** `solarch_backend` (ayrı git repo — `Solarch/` core'dan bağımsız)
**Önceki MVP:** `Solarch/web/` (geride bırakılıyor, referans değil)
**Tek doğruluk kaynağı:** `Solarch/plans/` dokümanları

## 1. Vizyon ve Phase 1 Kapsamı

### Genel vizyon
Solarch, doğal dil / sketch ile çizilen mimariyi Rules Engine + AI ile katı şema standartlarına oturtup deterministik scaffold + cerrahi AI ile NestJS/FastAPI kod üreten bir "architecture-to-code" platformu. Backend'in nihai görevleri: node/edge persistence, Rules Engine, AI batch apply (transaction + suggestion loop), kod üretim motoru, GraphRAG.

### Phase 1 kapsamı (bu spec)
**Sadece Node CRUD + şema doğrulama.** Aşağıdaki katmanlar Phase 1'de yok:

- Edge işlemleri (Phase 2)
- Rules Engine (whitelist/blacklist/koşullu — Phase 2)
- AI batch apply (`/graph/apply`) (Phase 3)
- LangGraph agent (Phase 3)
- Vector / GraphRAG (Phase 4)
- Kod üretim motoru (Phase 5)
- Auth, rate limit, multi-tenancy (sonraki)

### Phase 1 node taksonomisi
Sadece **Veri ailesi** (5 tip): `Table`, `DTO`, `Model`, `Enum`, `View`.

## 2. Mimari Kararlar (Stack)

| Karar | Seçim | Gerekçe |
|---|---|---|
| Dil | TypeScript | Tek-dil ekosistemi tercihi |
| Framework | NestJS | Modüler yapı + DI + decorator disiplini |
| Validation | Zod | Discriminated union + JSON Schema export + tip çıkarımı |
| DB | Neo4j 5 (community) | Plans/Veritabanı Stratejisi nihai hedefi — graph traversal Phase 2+ Rules Engine için bedava |
| DB driver | `neo4j-driver` (resmi, raw Cypher) | Plans/Fraktal Graf Backend Mantığı Cypher pattern'leri veriyor; OGM soyutlaması Phase 1'de overhead |
| Paket yöneticisi | pnpm | Modern, hızlı |
| Test runner | Vitest (NestJS Jest yerine) | Hızlı, modern, ESM-friendly |
| E2E DB | Testcontainers | Geçici Neo4j container |
| Container | Docker Compose | Lokal Neo4j |

## 3. Repo Organizasyonu

`solarch_backend` ayrı bir git repo. Solarch core repo'sundan bağımsız:

```
solarch_backend/
├── src/
│   ├── main.ts                          bootstrap (CORS, global pipes/filters)
│   ├── app.module.ts                    root module
│   ├── config/
│   │   ├── env.ts                       Zod ile env validation (fail-fast)
│   │   └── neo4j.config.ts              URI/user/pass
│   ├── neo4j/
│   │   ├── neo4j.module.ts              @Global() module, driver singleton
│   │   ├── neo4j.service.ts             session/transaction wrapper
│   │   ├── migrations/
│   │   │   └── 001_constraints.cypher   id unique + project index
│   │   └── cypher.ts                    küçük query builder helpers
│   ├── nodes/
│   │   ├── nodes.module.ts
│   │   ├── nodes.controller.ts          REST endpoint'leri
│   │   ├── nodes.service.ts             business logic
│   │   ├── nodes.repository.ts          Cypher sorgular
│   │   ├── schemas/
│   │   │   ├── base.schema.ts           BaseNodeSchema (DEĞİŞMEZ KURAL)
│   │   │   ├── table.schema.ts
│   │   │   ├── dto.schema.ts
│   │   │   ├── model.schema.ts
│   │   │   ├── enum.schema.ts
│   │   │   ├── view.schema.ts           (PLACEHOLDER — plans'ta detay yok)
│   │   │   └── index.ts                 NodeSchema = discriminatedUnion
│   │   └── dto/
│   │       ├── create-node.dto.ts
│   │       ├── update-node.dto.ts
│   │       └── node-response.dto.ts
│   └── common/
│       ├── pipes/zod-validation.pipe.ts
│       ├── filters/
│       │   ├── schema-error.filter.ts   ZodError → ERR_SCHEMA_INVALID envelope
│       │   ├── not-found.filter.ts      → 404 envelope
│       │   └── conflict.filter.ts       → 409 envelope
│       └── envelope.ts                  { success, data | error } helper
├── test/
│   └── nodes.e2e-spec.ts                Testcontainers + Neo4j round-trip
├── docker-compose.yml                   Neo4j 5 + APOC
├── .env.example
├── .gitignore
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
├── package.json
├── pnpm-lock.yaml
├── vitest.config.ts
└── README.md
```

## 4. Base Node Schema (DEĞİŞMEZ KURAL)

Her yeni node tipi bu base'i miras alır. Yeni tip ekleyen geliştirici **sadece** `type` literal'ı ve `properties` shape'ini tanımlar.

```ts
// src/nodes/schemas/base.schema.ts
import { z } from "zod";

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const BaseNodeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  position: PositionSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

**Kural:** Bu beş alan **request payload'da gelir** (kullanıcı kararı):
- `id`, `createdAt`, `updatedAt` **opsiyonel** — verilirse aynen kabul edilir (AI batch / import senaryolarında deterministik replay), yoksa server üretir.
- `projectId`, `position` **zorunlu** — request'te mutlaka olmalı.

## 5. Veri Ailesi Node Şemaları

Hepsi `Solarch/plans/Solarch Node Şemaları (Node Schemas).md` "1. Veri ve Şema Katmanı" bölümünden birebir alınmış. View hariç (plans'ta detay yok — placeholder).

### 5.1 Table

```ts
export const TableNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Table"),
  properties: z.object({
    TableName: z.string().min(1),
    Description: z.string().min(1),
    Columns: z.array(z.object({
      Name: z.string().min(1),
      DataType: z.enum(["INT", "VARCHAR", "TEXT", "BOOLEAN", "DATETIME", "UUID", "FLOAT", "JSON"]),
      Length: z.number().int().positive().optional(),
      IsPrimaryKey: z.boolean(),
      IsForeignKey: z.boolean(),
      References: z.string().optional(),
      IsNotNull: z.boolean(),
      IsUnique: z.boolean(),
      AutoIncrement: z.boolean(),
      DefaultValue: z.string().optional(),
    })).min(1),
    Indexes: z.array(z.object({
      IndexName: z.string().min(1),
      Columns: z.array(z.string()).min(1),
      Type: z.enum(["B-Tree", "Hash"]),
    })).default([]),
  }).strict(),
}).strict();
```

### 5.2 DTO

```ts
export const DTONodeSchema = BaseNodeSchema.extend({
  type: z.literal("DTO"),
  properties: z.object({
    Name: z.string().min(1),
    Description: z.string().min(1),
    Fields: z.array(z.object({
      Name: z.string().min(1),
      DataType: z.string().min(1),
      IsRequired: z.boolean(),
      ValidationRule: z.string().optional(),
      IsArray: z.boolean(),
    })).min(1),
  }).strict(),
}).strict();
```

### 5.3 Model / Entity

```ts
export const ModelNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Model"),
  properties: z.object({
    ClassName: z.string().min(1),
    Description: z.string().min(1),
    Properties: z.array(z.object({
      Name: z.string().min(1),
      Type: z.string().min(1),
    })).min(1),
    Methods: z.array(z.object({
      MethodName: z.string().min(1),
      ReturnType: z.string().min(1),
    })).default([]),
  }).strict(),
}).strict();
```

### 5.4 Enum

```ts
export const EnumNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Enum"),
  properties: z.object({
    Name: z.string().min(1),
    Description: z.string().min(1),
    Values: z.array(z.string().min(1)).min(1),
  }).strict(),
}).strict();
```

### 5.5 View (PLACEHOLDER — plans'ta detay yok)

```ts
export const ViewNodeSchema = BaseNodeSchema.extend({
  type: z.literal("View"),
  properties: z.object({
    ViewName: z.string().min(1),
    Description: z.string().min(1),
    Definition: z.string().min(1),         // SQL/aggregate metni
    SourceTables: z.array(z.string()).min(1),
    Materialized: z.boolean(),
  }).strict(),
}).strict();
```

Plans güncellendiğinde bu şema üzerine yazılır.

### 5.6 Description disiplini

`Description` alanı **tüm 5 tipte zorunlu** (kullanıcı kararı). Plans'ta yalnız Table'da explicit listeli ama disiplin için tüme uygulanır.

### 5.7 Discriminated Union

```ts
// src/nodes/schemas/index.ts
export const NodeSchema = z.discriminatedUnion("type", [
  TableNodeSchema,
  DTONodeSchema,
  ModelNodeSchema,
  EnumNodeSchema,
  ViewNodeSchema,
]);

export type Node = z.infer<typeof NodeSchema>;
export type NodeKind = Node["type"];

export const KIND_LABELS: Record<NodeKind, string> = {
  Table: "Table",
  DTO: "DTO",
  Model: "Model",
  Enum: "Enum",
  View: "View",
};
```

## 6. "Yeni Node Tipi Ekleme" Kuralı (Codified)

Yeni bir kind eklemek için **üç şart**:

1. **`schemas/<kind>.schema.ts`** dosyası oluştur → `BaseNodeSchema.extend({ type: z.literal("Foo"), properties: z.object({...}).strict() }).strict()`.
2. **`schemas/index.ts`**'teki `NodeSchema` discriminated union'una eklenir + `KIND_LABELS` haritası güncellenir.
3. **Test:** `schemas/<kind>.schema.spec.ts` dosyasında valid + invalid payload örnekleri.

Bu disiplinin sonuçları:
- Union'a girmeyen tip controller'a **compile-time'da** giremez (TS).
- ValidationPipe runtime'da reddeder (Zod).
- Tüm node'lar zorunlu base alanlara sahiptir (id, projectId, position, timestamps).

## 7. API Kontratları

### 7.1 Endpoint yüzeyi

| Method | Path | Amaç |
|---|---|---|
| POST | `/api/v1/projects/:projectId/nodes` | Yeni node oluştur |
| GET | `/api/v1/projects/:projectId/nodes` | Listele (opsiyonel `?type=Table` filter) |
| GET | `/api/v1/projects/:projectId/nodes/:nodeId` | Tekil node |
| PATCH | `/api/v1/projects/:projectId/nodes/:nodeId` | Kısmi güncelleme |
| DELETE | `/api/v1/projects/:projectId/nodes/:nodeId` | Sil (idempotent) |

Plans/API Spesifikasyonları 1.1 sadece POST tanımlıyor; CRUD'u tamamlamak için Phase 1'e ek (plans'ı **genişletiyoruz, çelişmiyoruz**).

### 7.2 Request envelope (POST)

```jsonc
// POST /api/v1/projects/prj_xxx/nodes
{
  "id": "nd_8f7a9c2b",                   // opsiyonel
  "type": "Table",
  "projectId": "prj_xxx",                // URL ile match zorunlu
  "position": { "x": 150, "y": 300 },
  "createdAt": "2026-05-21T10:30:00Z",   // opsiyonel
  "updatedAt": "2026-05-21T10:30:00Z",   // opsiyonel
  "properties": {
    "TableName": "users",
    "Description": "User entities",
    "Columns": [...],
    "Indexes": []
  }
}
```

### 7.3 Response envelope (her endpoint için tutarlı)

**Başarı:**
```jsonc
{ "success": true, "data": { /* tam node objesi */ } }
```

**Hata:**
```jsonc
{
  "success": false,
  "error": {
    "code": "ERR_SCHEMA_INVALID",
    "message": "Gönderilen özellikler 'Table' şeması ile uyuşmuyor.",
    "details": [{ "field": "properties.Columns[0].DataType", "issue": "..." }]
  }
}
```

`details` alanı sadece `ERR_SCHEMA_INVALID`'de var. Plans/API Spec birebir.

### 7.4 HTTP status → error code haritası

| Status | Code | Senaryo |
|---|---|---|
| 201 | — | POST başarılı |
| 200 | — | GET / PATCH başarılı |
| 204 | — | DELETE başarılı (idempotent) |
| 400 | `ERR_SCHEMA_INVALID` | Zod validation fail (plans 1.1) |
| 400 | `ERR_PROJECT_MISMATCH` | URL projectId ≠ body projectId |
| 400 | `ERR_KIND_IMMUTABLE` | PATCH `type` değiştirmeye çalıştı |
| 404 | `ERR_NODE_NOT_FOUND` | GET/PATCH/DELETE'de node yok |
| 409 | `ERR_ID_CONFLICT` | Client id verdi, zaten kullanılıyor |
| 409 | `ERR_NAME_DUPLICATE` | `*Name` proje içinde unique constraint ihlali |
| 500 | `ERR_INTERNAL` | Beklenmeyen — DB bağlantısı vs. |

### 7.5 PATCH semantiği — field-level replace

PATCH body'sinde top-level alanlar **opsiyonel**:

```jsonc
PATCH /api/v1/projects/prj_xxx/nodes/nd_8f7a9c2b
{
  "position": { "x": 200, "y": 400 }        // sadece position update — drag senaryosu
}
```

veya

```jsonc
{
  "properties": { /* tam yeni properties */ } // properties tamamen replace
}
```

**Kurallar:**
- Verilen field tam objesiyle **replace** edilir (deep merge yok).
- Verilmeyen field dokunulmaz.
- `type` immutable — değiştirmeye çalışırsa 400 `ERR_KIND_IMMUTABLE`.
- `id`, `projectId`, `createdAt` immutable.
- `updatedAt` server tarafından otomatik güncellenir.

Bu **JSON Merge Patch**'in basitleştirilmiş hali. Phase 1'de en az bug, en öngörülebilir.

### 7.6 Cross-cutting

- **Auth:** Phase 1'de yok (lokal geliştirme).
- **CORS:** `CORS_ORIGIN` env'iyle whitelist (varsayılan `http://localhost:3000`).
- **Content-Type:** `application/json` zorunlu.
- **Rate limit:** Phase 1'de yok.
- **Pagination:** Phase 1'de yok (tüm node'lar dönülür); ileride `?limit&offset` eklenir.

## 8. Persistence — Neo4j Veri Modeli

### 8.1 Node yapısı

Her node iki label taşır: `:Node` (global) + `:<Kind>` (kind-spesifik).

```cypher
CREATE (n:Node:Table {
  id: "nd_8f7a9c2b",
  projectId: "prj_xxx",
  positionX: 150.0,
  positionY: 300.0,
  createdAt: datetime("2026-05-21T10:30:00Z"),
  updatedAt: datetime("2026-05-21T10:30:00Z"),
  properties: "{\"TableName\":\"users\",...}"   // JSON string
})
```

**Kararlar:**
- `properties` JSON string olarak tutulur. Gerekçe: Neo4j map type'ı array-of-object'i destekler ama indekslenemez ve `Columns[].IsPrimaryKey` gibi nested predicate query'leri Cypher'da çirkin. Phase 1'de properties üzerinden query yok (sadece read/write). Phase 2'de struct'a flatten ederiz.
- `position` x/y ayrı kolonlar — drag sırasında sadece bunlar update edilebilir.
- `:Node` ortak label sayesinde `id` global unique constraint tek tanımla halledilir.

### 8.2 Constraint'ler ve indeksler (bootstrap migration)

```cypher
-- 001_constraints.cypher
CREATE CONSTRAINT node_id_unique IF NOT EXISTS
  FOR (n:Node) REQUIRE n.id IS UNIQUE;

CREATE INDEX node_project_idx IF NOT EXISTS
  FOR (n:Node) ON (n.projectId);
```

Kind bazlı filtreler için ek index gereksiz — kind zaten label olarak duruyor (`:Table`, `:DTO` vs.), Neo4j label match'i index-equivalent hızdadır.

### 8.3 Temel Cypher sorguları

**Create:**
```cypher
CREATE (n:Node:Table {id: $id, projectId: $projectId, positionX: $x, positionY: $y,
        createdAt: datetime($createdAt), updatedAt: datetime($updatedAt),
        properties: $properties})
RETURN n;
```

**Get by id:**
```cypher
MATCH (n:Node {id: $id, projectId: $projectId})
RETURN n, labels(n) AS labels;
```

**List by project (+ optional kind):**
```cypher
MATCH (n:Node {projectId: $projectId})
WHERE $kind IS NULL OR $kind IN labels(n)
RETURN n, labels(n) AS labels;
```

**Patch (field-level):**
```cypher
MATCH (n:Node {id: $id, projectId: $projectId})
SET n += $partial
RETURN n, labels(n) AS labels;
```

`$partial` Service tarafında hazırlanır:
- `body.position` verilirse → `{ positionX, positionY }` flatten
- `body.properties` verilirse → `{ properties: JSON.stringify(props) }`
- Her durumda `updatedAt: datetime(now)` eklenir

**Delete:**
```cypher
MATCH (n:Node {id: $id, projectId: $projectId})
DELETE n;
```

### 8.4 Unique-name kontrolü

`*Name` (TableName/Name/ClassName/ViewName) proje içinde unique. Phase 1'de **uygulama katmanında** kontrol edilir (`properties` JSON string olduğu için DB-level constraint yok). Service `create`/`patch`'te check + 409 `ERR_NAME_DUPLICATE`. Phase 2'de properties struct'a açıldığında DB constraint'e yükseltilir.

## 9. Validation Pipeline

```
Request body
  → ZodValidationPipe (parse via NodeSchema)
    → kind discriminator otomatik
    → .strict() bilinmeyen alanları reddeder
  → Controller method (typed payload)
  → Service (business logic)
  → Repository (Cypher exec)
  → Neo4j
```

### 9.1 ZodValidationPipe

```ts
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}
  transform(value: unknown) {
    return this.schema.parse(value); // throws ZodError on fail
  }
}
```

### 9.2 SchemaErrorFilter

`@Catch(ZodError)` global filter:

```ts
toEnvelope(err: ZodError) {
  return {
    success: false,
    error: {
      code: "ERR_SCHEMA_INVALID",
      message: "Gönderilen özellikler şema ile uyuşmuyor.",
      details: err.issues.map(i => ({
        field: i.path.join("."),
        issue: i.message,
      })),
    },
  };
}
```

Diğer filter'lar: `NotFoundExceptionFilter` → 404, `ConflictExceptionFilter` → 409, `InternalErrorFilter` → 500.

## 10. Configuration

### 10.1 `.env.example`

```bash
NODE_ENV=development
PORT=4000

NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=solarch_dev_password

CORS_ORIGIN=http://localhost:3000
```

### 10.2 `config/env.ts` — boot-time validation

```ts
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  NEO4J_URI: z.string().url(),
  NEO4J_USER: z.string().min(1),
  NEO4J_PASSWORD: z.string().min(1),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

export const env = EnvSchema.parse(process.env);
```

Eksik env varsa server up olmaz (fail-fast).

### 10.3 `docker-compose.yml`

```yaml
services:
  neo4j:
    image: neo4j:5-community
    container_name: solarch-neo4j
    ports:
      - "7474:7474"
      - "7687:7687"
    environment:
      NEO4J_AUTH: neo4j/solarch_dev_password
      NEO4J_PLUGINS: '["apoc"]'
    volumes:
      - solarch_neo4j_data:/data
    restart: unless-stopped

volumes:
  solarch_neo4j_data:
```

## 11. Test Stratejisi

### 11.1 Unit testler

- `src/nodes/schemas/*.spec.ts` — her kind için **valid payload** + **invalid payload** (zorunlu alan eksik, bilinmeyen alan, yanlış tip).
- `src/common/pipes/zod-validation.pipe.spec.ts` — ZodError → fırlatılır.
- `src/common/filters/schema-error.filter.spec.ts` — envelope formatı.

### 11.2 E2E testler

`test/nodes.e2e-spec.ts`:
- Testcontainers ile geçici Neo4j container.
- Her 5 kind için tam CRUD round-trip (POST → GET → PATCH → DELETE).
- Error path'leri: ERR_SCHEMA_INVALID, ERR_NODE_NOT_FOUND, ERR_NAME_DUPLICATE, ERR_KIND_IMMUTABLE.

### 11.3 Komutlar

```jsonc
// package.json scripts
{
  "dev": "nest start --watch",
  "build": "nest build",
  "start": "node dist/main.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "vitest run --config vitest.e2e.config.ts",
  "lint": "eslint src --ext .ts",
  "neo4j:up": "docker compose up -d",
  "neo4j:down": "docker compose down",
  "neo4j:migrate": "tsx src/neo4j/migrations/run.ts"
}
```

## 12. Phase 1 Çıkış Kriterleri

1. `solarch_backend` repo'su initialize edilmiş (git, package.json, tsconfig).
2. NestJS app boot ediyor, `/api/v1/health` endpoint'i 200 dönüyor.
3. Docker Compose ile Neo4j ayağa kalkıyor.
4. Migration script `node_id_unique` constraint'ini ve `node_project_idx` indeksini kuruyor.
5. 5 Veri ailesi node tipi için (Table, DTO, Model, Enum, View) tam CRUD endpoint'leri çalışıyor.
6. Tüm endpoint'ler plans/API Spec'indeki response envelope formatına uyuyor.
7. Unit + E2E testler geçiyor (5 kind × CRUD + error path'leri).
8. README implementasyon notları + `.env.example` + `docker-compose.yml` mevcut.

## 13. Out of Scope (Phase 2+)

Aşağıdakiler bu spec'in kapsamında **değil**:

- **Phase 2**: Edge schemas + Edge CRUD + `/edges/validate` + Rules Engine (whitelist/blacklist).
- **Phase 2.5**: Conditional rules (döngüsel bağımlılık, encapsulation, tip uyumsuzluğu).
- **Phase 3**: AI batch apply (`/graph/apply`) + LangGraph agent loop + suggestion-driven self-correction.
- **Phase 4**: Vector DB + GraphRAG + "Chat with Architecture".
- **Phase 5**: Kod üretim motoru (AST scaffold + cerrahi AI + `.cursorrules` export).
- **Sonra**: Auth, multi-tenancy, rate limit, pagination, audit log.
- **Diğer node aileleri**: İş Mantığı (Service/Worker/EventHandler/Orchestrator), Erişim (Controller/APIGateway/MessageQueue), Altyapı (Repository/Cache/ExternalService), İstemci (FrontendApp/MobileApp/UIComponent), Güvenlik (Middleware/Exception/Auth), Yapı (Module/BoundedContext) — Phase 1.5 olarak şablon hazır olduktan sonra eklenir.

## 14. Açık Notlar

- **View placeholder**: Plans'ta detay yok. Phase 1 placeholder şeması (ViewName/Description/Definition/SourceTables/Materialized) plans güncellenince üzerine yazılır.
- **Solarch core repo ile entegrasyon**: `solarch_backend` ayrı repo. Solarch core (`web/`) sonradan bu backend'i `CORS_ORIGIN` aracılığıyla çağırabilir. Phase 1'de iki repo arası shared type paketi **yok**; her iki taraf kendi Zod şemalarını taşır. Phase 2'de `@solarch/contracts` adında bir npm paketi (veya monorepo'ya geçiş) değerlendirilir.
- **Mevcut `Solarch/web/migrate-to-mongo.ts`**: `solarch_backend` Neo4j'e geçtiği için bu migration kullanım dışı kalır. `web/` MVP olarak hayatta kalmaya devam edebilir ama yeni özellik almaz.
