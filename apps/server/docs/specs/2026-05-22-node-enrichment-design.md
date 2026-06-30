# Node Properties Enrichment — Tasarım (Codegen-Ready Derinlik)

**Tarih:** 2026-05-22
**Durum:** Brainstorm tamamlandı, kullanıcı onayı alındı
**Repo:** solarch-backend
**Önceki:** Phase 1-3B tamamlandı (21 node tipi + 16 edge + Rules + Batch + AI agent)

## 1. Amaç

21 node tipinin `properties` şemalarını **codegen-ready** derinliğe çıkarmak. Tek hedef üç ihtiyacı birden karşılar:

- **Codegen (Phase 5):** Bu şemalardan gerçek kod üretilebilir — DB DDL (CREATE TABLE + constraints + indexes), ORM entity, DTO class, controller scaffold.
- **AI üretimi:** AI agent daha gerçekçi/eksiksiz mimari üretir (zengin ama net alanlar).
- **UI inspector:** Frontend node düzenleme paneli her alanı tip/badge/hint ile gösterir.

Codegen en yüksek bar olduğu için onu karşılayan şema AI + UI'ı da kapsar.

## 2. Genel Yaklaşım (Kararlar)

| Karar | İçerik |
|---|---|
| **Derinlik** | Tam DB/kod modeli (composite key, FK actions, check constraints, method signatures, validation rules) |
| **Zorunluluk** | Yeni alanlar **required** (production-grade; yarım node yok). Mevcut DB node'ları migration ile doldurulur. |
| **Cross-reference** | Property'lerde **isim string referansı** (örn kolon `EnumRef: "OrderStatus"`). Node id değil. Edge'lerden bağımsız — codegen resolve eder. Edge'ler ayrı kalır (görsel + Rules Engine). |
| **Migration** | `GRAPH_SCHEMA_VERSION` eklenir + her faz bump. tsx migration script: mevcut node `properties` JSON'larını parse → yeni zorunlu alanları default ile doldur → re-serialize. |
| **UI metadata** | Zod `.describe()` her alanda → `zodV3ToOpenAPI` ile JSON Schema'da görünür. `node-types/:id` type/required/enum/description döner. Badge (PK/FK vb.) için `node-types/registry.ts`'te `fieldHints`. |
| **AI prompt** | Her faz sonunda `src/ai/prompts/system-prompt.ts` node şema rehberi güncellenir (yoksa AI eski şema üretip `ERR_SCHEMA_INVALID` alır). |
| **Strateji** | Spec tüm 21 node'u kapsar. Implement fazlı: **Faz A** Veri ailesi → **Faz B** İş/Erişim → **Faz C** Altyapı/İstemci/Güvenlik/Konfig/Yapı. |

### Cross-reference enum'ları
Tüm `*Ref` alanları o referansın hedef node `*Name`'ine eşittir (proje içi benzersiz). Codegen ve gelecekteki bir `resolveRefs` katmanı bunları gerçek node id'lerine çözer. Phase 1.5'te referans **doğrulaması yapılmaz** (esneklik); Phase 2 (Rules) sonrası opsiyonel ref-validation eklenebilir.

## 3. Faz A — Veri Ailesi (codegen çekirdeği)

### Table
```ts
const ColumnSchema = z.object({
  Name: z.string().min(1),
  DataType: z.enum(["INT","BIGINT","VARCHAR","TEXT","BOOLEAN","DATETIME","DATE","UUID","FLOAT","DECIMAL","JSON","ENUM"]),
  Length: z.number().int().positive().optional(),     // VARCHAR(n)
  Precision: z.number().int().positive().optional(),  // DECIMAL(p,s)
  Scale: z.number().int().nonnegative().optional(),
  IsPrimaryKey: z.boolean(),
  IsNotNull: z.boolean(),
  IsUnique: z.boolean(),
  AutoIncrement: z.boolean(),
  DefaultValue: z.string().optional(),
  Comment: z.string().optional(),
  EnumRef: z.string().optional(),          // DataType=ENUM ise → Enum node Name
  IsGenerated: z.boolean().optional(),
  GeneratedExpression: z.string().optional(),
}).strict();

const ForeignKeySchema = z.object({
  Name: z.string().optional(),
  Columns: z.array(z.string()).min(1),
  ReferencesTable: z.string().min(1),
  ReferencesColumns: z.array(z.string()).min(1),
  OnDelete: z.enum(["CASCADE","RESTRICT","SET_NULL","NO_ACTION"]).default("NO_ACTION"),
  OnUpdate: z.enum(["CASCADE","RESTRICT","SET_NULL","NO_ACTION"]).default("NO_ACTION"),
}).strict();

const IndexSchema = z.object({
  IndexName: z.string().min(1),
  Columns: z.array(z.string()).min(1),
  Type: z.enum(["BTree","Hash","GIN","GiST"]).default("BTree"),
  IsUnique: z.boolean().default(false),
  IsPartial: z.boolean().optional(),
  WhereClause: z.string().optional(),
}).strict();

// properties:
{
  TableName: z.string().min(1),
  Description: z.string().min(1),
  Columns: z.array(ColumnSchema).min(1),
  PrimaryKey: z.object({ Columns: z.array(z.string()).min(1) }).optional(), // composite PK
  ForeignKeys: z.array(ForeignKeySchema).default([]),
  UniqueConstraints: z.array(z.object({ Name: z.string().optional(), Columns: z.array(z.string()).min(1) })).default([]),
  CheckConstraints: z.array(z.object({ Name: z.string().optional(), Expression: z.string().min(1) })).default([]),
  Indexes: z.array(IndexSchema).default([]),
}
```
Tek-kolon PK → `Column.IsPrimaryKey`; composite → `PrimaryKey.Columns`. Tek-kolon FK için `ForeignKeys[]` (inline `Column.IsForeignKey` kaldırılır, tüm FK'ler `ForeignKeys[]`'te toplanır — tutarlılık).

### DTO
```ts
const FieldSchema = z.object({
  Name: z.string().min(1),
  DataType: z.string().min(1),
  IsRequired: z.boolean(),
  IsArray: z.boolean(),
  ValidationRules: z.array(z.object({
    Rule: z.enum(["Min","Max","MinLength","MaxLength","Email","Url","Regex","Pattern","Positive","Negative"]),
    Value: z.string().optional(),
  })).default([]),
  DefaultValue: z.string().optional(),
  NestedDTORef: z.string().optional(),  // → DTO node Name
  EnumRef: z.string().optional(),       // → Enum node Name
  Description: z.string().optional(),
}).strict();
// properties: { Name, Description, Fields: array(FieldSchema).min(1) }
```

### Model / Entity
```ts
const PropertySchema = z.object({
  Name: z.string().min(1),
  Type: z.string().min(1),
  IsNullable: z.boolean().default(false),
  IsCollection: z.boolean().default(false),
  RelationType: z.enum(["OneToOne","OneToMany","ManyToOne","ManyToMany"]).optional(),
  RelatedModelRef: z.string().optional(),  // → Model node Name
}).strict();

const MethodSchema = z.object({
  MethodName: z.string().min(1),
  Visibility: z.enum(["public","private","protected"]).default("public"),
  Parameters: z.array(z.object({
    Name: z.string().min(1), Type: z.string().min(1),
    Optional: z.boolean().default(false), Default: z.string().optional(),
  })).default([]),
  ReturnType: z.string().min(1),
  IsAsync: z.boolean().default(false),
  IsStatic: z.boolean().default(false),
}).strict();
// properties: { ClassName, Description, TableRef? (→Table), Properties: min(1), Methods: default([]) }
```

### Enum
```ts
// properties:
{
  Name: z.string().min(1),
  Description: z.string().min(1),
  BackingType: z.enum(["string","int"]).default("string"),
  Values: z.array(z.object({
    Key: z.string().min(1),
    Value: z.string().optional(),       // backing value (yoksa Key)
    Description: z.string().optional(),
  })).min(1),
}
```
Plans "List of Strings/Key-Values" → key-value object'e yükseltilir. (Migration: eski `string[]` → `[{Key: s}]`.)

### View
```ts
// properties:
{
  ViewName: z.string().min(1),
  Description: z.string().min(1),
  Definition: z.string().min(1),         // SQL/aggregate
  SourceTables: z.array(z.string()).min(1),  // → Table Name'leri
  Materialized: z.boolean(),
  Columns: z.array(z.object({ Name: z.string().min(1), DataType: z.string().min(1) })).default([]),
  RefreshStrategy: z.enum(["onDemand","scheduled","onChange"]).optional(), // materialized
}
```

## 4. Faz B — İş Mantığı + Erişim

### Service
```
ServiceName, Description, IsTransactionScoped
Methods[]: MethodName, Visibility, Parameters[] ({Name,Type,Optional,Default?,DtoRef?}),
           ReturnType, ReturnDtoRef?, IsAsync, Throws[] (→Exception Name), Description?
Dependencies[]: { Kind: "Repository"|"Service"|"Cache"|"ExternalService", Ref: string }  // DI
```

### Worker
```
WorkerName, Description, Schedule (cron), TaskToExecute, TimeoutSeconds,
RetryPolicy: { MaxRetries, BackoffStrategy? (fixed/exponential), DelaySeconds? },
Concurrency? (int), IsEnabled (default true)
```

### EventHandler
```
HandlerName, Description, EventName, IsAsync, QueueRef? (→MessageQueue),
RetryPolicy? ({MaxRetries, DelaySeconds?}), DeadLetterQueue? (string)
```

### Orchestrator
```
OrchestratorName, Description, Pattern (Saga/CompensatingTransaction/StateMachine/ProcessManager)
Steps[]: { StepName, ServiceRef (→Service), Action, CompensationAction?, OnFailure (retry/compensate/abort) }
```

### Controller (mevcut + zenginleştirme)
```
ControllerName, Description, BaseRoute, Version?
Endpoints[]: HttpMethod, Route, RequestDTORef? (→DTO), ResponseDTORef? (→DTO),
             RequiresAuth, RequiredRoles[],
             PathParams[]? ({Name, Type}), QueryParams[]? ({Name, Type, Required}),
             StatusCodes[]? ({Code, Description}), MiddlewareRefs[]? (→Middleware),
             RateLimit? ({Requests, WindowSeconds}), Description?
```

### MessageQueue
```
QueueName, Description, Type (Queue/Topic), Provider, MessageFormat (→DTO),
DeliveryGuarantee? (at-least-once/exactly-once/at-most-once), MaxRetries?,
DeadLetterQueue?, RetentionSeconds?
```

### APIGateway
```
GatewayName, Description, Provider, AuthMode? (None/JWT/OAuth2/ApiKey), CorsEnabled?
Routes[]: { Path, TargetRef (→Controller/Service), Methods[], AuthRequired, RateLimit? }
```

## 5. Faz C — Altyapı + İstemci + Güvenlik + Konfig + Yapı

### Repository
```
RepositoryName, Description, EntityRef (→Model/Table), BaseClass?, IsCached (default false)
CustomQueries[]: { QueryName, QueryType (select/insert/update/delete/aggregate),
                   Parameters[]? ({Name, Type}), ReturnType? }
```

### Cache
```
CacheName, Description, KeyPattern, TTL_Seconds, Engine (Redis/Memcached/Memory),
EvictionPolicy? (LRU/LFU/FIFO/TTL), MaxSizeMB?, Serialization? (JSON/MsgPack/Binary)
```

### ExternalService
```
ServiceName, Description, BaseURL, AuthType, TimeoutSeconds,
Endpoints[]? : { Name, Method, Path, RequestFormat?, ResponseFormat? },
RetryPolicy? ({MaxRetries, BackoffStrategy?}), RateLimit?, CircuitBreaker? ({FailureThreshold, ResetSeconds})
```

### FrontendApp
```
AppName, Description, Framework, DeploymentType,
StateManagement? (Redux/Zustand/Context/MobX/None), StylingApproach? (Tailwind/CSSModules/StyledComponents/...),
Routes[]? : { Path, ComponentRef (→UIComponent) }
```

### UIComponent (mevcut + tipleme)
```
ComponentName, Description,
Props[]: { Name, Type, Required, Default? },
State[]: { Name, Type, Initial? },
Events[]? : { Name, PayloadType? },
ChildComponentRefs[]? (→UIComponent)
```

### Middleware
```
MiddlewareName, Description, AppliesTo (Global/SpecificRoutes), ExecutionOrder,
MiddlewareType? (auth/logging/ratelimit/cors/compression/validation/custom),
Config? (record)
```

### EnvironmentVariable
```
Key, Description, DataType (String/Number/Boolean), IsSecret, Environment[] (Dev/Staging/Prod),
DefaultValue?, IsRequired (default true), ValidationPattern? (regex)
```

### Exception
```
ExceptionName, Description, HttpStatusCode, LogSeverity (Info/Warning/Error/Critical),
ErrorCode? (örn ERR_AUTH_001), ParentExceptionRef? (→Exception, extends), Message?
```

### Module (Bounded Context)
```
ModuleName, Description, StrictBoundaries,
ExposedServices[]? (→Service Name'leri — dışarı açık API),
Dependencies[]? (→Module Name'leri — DependsOn)
```

## 6. Altyapı Bileşenleri

### Migration
- `src/nodes/schemas/version.ts`: `export const GRAPH_SCHEMA_VERSION = N;` Her faz bump.
- `src/neo4j/migrations/run.ts` zaten cypher dosyalarını çalıştırıyor; node-level veri dönüşümü için ayrı `tsx` migration script (`migrations/data/00X-enrich-<faz>.ts`): tüm node'ları çek, `properties` JSON parse, eksik zorunlu alanları default ile doldur, re-serialize, geri yaz. Idempotent.
- Mevcut DB az veri → migration düşük riskli.

### UI Field Metadata
- Zod `.describe("...")` her alanda → `zodV3ToOpenAPI` JSON Schema `description`'a taşır.
- `node-types/registry.ts`'e opsiyonel `fieldHints: Record<string, { badge?: string; group?: string }>` (örn `IsPrimaryKey → badge:"PK"`, `IsForeignKey/FK → "FK"`). `node-types/:typeId` response'una `fieldHints` eklenir.

### AI Prompt
- `src/ai/prompts/system-prompt.ts` node şema rehberi her faz sonunda güncellenir. Çıkış kriteri: AI canlı testte ilgili fazın node'larını ≤3 denemede üretebilmeli.

### Test
- Her zenginleştirilen schema için `*.schema.spec.ts` valid + invalid (yeni zorunlu alanlar, enum'lar, nested).
- `nodes.service.spec` / `graph.service.spec` / e2e fixtures yeni şemaya güncellenir.
- `node-types.service.spec`: fieldHints + zengin schema.
- AI canlı doğrulama (faz sonunda).

## 7. Faz Çıkış Kriterleri

**Her faz için:**
1. İlgili node şemaları zenginleştirildi (required alanlar + .describe()).
2. `GRAPH_SCHEMA_VERSION` bump + migration script (mevcut node'lar dönüştürüldü).
3. `create-node.dto.ts` discriminated union güncel.
4. `node-types/registry.ts` fieldHints güncel.
5. `system-prompt.ts` node şema rehberi güncel.
6. Unit + service + e2e testleri yeşil.
7. AI canlı doğrulama: ilgili fazın node'ları AI ile ≤3 denemede üretilebiliyor.

**Faz A** = Table/DTO/Model/Enum/View. **Faz B** = Service/Worker/EventHandler/Orchestrator/Controller/MessageQueue/APIGateway. **Faz C** = Repository/Cache/ExternalService/FrontendApp/UIComponent/Middleware/EnvironmentVariable/Exception/Module.

## 8. Out of Scope

- Ref-validation (EnumRef gerçekten var mı) — Phase 1.5 esnek; sonra eklenebilir.
- Gerçek codegen (DDL/entity üretimi) — Phase 5; bu spec sadece şemayı codegen-ready yapar.
- Frontend inspector UI implementasyonu — backend metadata sağlar, UI ayrı.
- Edge properties enrichment — bu spec sadece node properties (edge ayrı iş).

## 9. Açık Notlar
- Cross-ref'ler isim string; codegen/resolve katmanı id'ye çevirir (gelecek).
- Composite PK + tek-kolon PK ikisi de desteklenir (tutarlılık için tek-kolon FK de `ForeignKeys[]`'e taşınır).
- Migration mevcut az veriyle düşük riskli; yine de idempotent + geri-okuma doğrulamalı.
