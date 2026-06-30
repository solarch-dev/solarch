# Node Properties Enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 21 node tipinin `properties` Zod şemalarını codegen-ready derinliğe (tam DB/kod modeli) çıkarmak; her yeni alan required, mevcut DB node'ları migration ile dönüştürülür, UI fieldHints + AI prompt güncellenir.

**Architecture:** Fazlı — Faz A (Veri ailesi: Table/DTO/Model/Enum/View) bu planda tam TDD; Faz B (İş/Erişim) ve Faz C (Altyapı/diğer) yapısal görev başlıkları (kendi tur). Her node: schema enrich → spec güncelle → testler yeşil → fieldHints → commit. Faz sonunda migration + AI prompt + canlı AI doğrulama.

**Tech Stack:** TypeScript, NestJS 11, Zod 3, neo4j-driver, Vitest 2, Testcontainers, nestjs-zod, LangChain (DeepSeek/Bedrock).

**Spec:** [`docs/specs/2026-05-22-node-enrichment-design.md`](../specs/2026-05-22-node-enrichment-design.md)

**Çalışma dizini:** `~/Masaüstü/Arsiv/solarch-backend/` — tüm path'ler ve git komutları buradan.

---

## File Structure

```
src/nodes/schemas/
  version.ts                  ← YENİ: GRAPH_SCHEMA_VERSION
  table.schema.ts             ← enrich (composite PK/FK, FK actions, check, zengin index)
  dto.schema.ts               ← enrich (validation rules, nested/enum ref)
  model.schema.ts             ← enrich (relations, method signatures)
  enum.schema.ts              ← enrich (key-value, backing type)
  view.schema.ts              ← enrich (columns, refresh strategy)
  *.schema.spec.ts            ← her biri yeni alanlar için güncellenir
  index.ts                    ← değişmez (export'lar aynı)
src/nodes/dto/create-node.dto.ts   ← Veri ailesi properties shape güncel (otomatik — shape'ten türüyor)
src/node-types/registry.ts         ← Veri ailesi fieldHints
src/node-types/node-types.service.ts ← getById response'una fieldHints
src/ai/prompts/system-prompt.ts    ← Veri ailesi şema rehberi güncel
src/neo4j/migrations/data/001-enrich-faz-a.ts  ← YENİ: mevcut node properties dönüşümü
package.json                       ← migrate:data script
test/nodes.e2e-spec.ts             ← Veri ailesi fixtures güncel
```

**Decomposition:** Her node schema dosyası tek sorumluluk (kendi kind'ı). fieldHints registry'de toplu. Migration ayrı script. Her dosya <200 satır hedef.

---

## FAZ A — Veri Ailesi

### Task 1: GRAPH_SCHEMA_VERSION

**Files:**
- Create: `src/nodes/schemas/version.ts`
- Test: `src/nodes/schemas/version.spec.ts`

- [ ] **Step 1: Failing test yaz**

```ts
// src/nodes/schemas/version.spec.ts
import { describe, it, expect } from "vitest";
import { GRAPH_SCHEMA_VERSION } from "./version";

describe("GRAPH_SCHEMA_VERSION", () => {
  it("pozitif integer", () => {
    expect(Number.isInteger(GRAPH_SCHEMA_VERSION)).toBe(true);
    expect(GRAPH_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Test fail**

Run: `pnpm test src/nodes/schemas/version.spec.ts`
Expected: "Cannot find module './version'"

- [ ] **Step 3: version.ts yaz**

```ts
// src/nodes/schemas/version.ts
/** Node properties şema sürümü. Enrichment fazlarında bump edilir.
 *  v1 = Phase 1 temel şemalar. v2 = Faz A (Veri ailesi codegen-ready). */
export const GRAPH_SCHEMA_VERSION = 2;
```

- [ ] **Step 4: Test pass**

Run: `pnpm test src/nodes/schemas/version.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/nodes/schemas/version.ts src/nodes/schemas/version.spec.ts
git commit -m "feat(schemas): GRAPH_SCHEMA_VERSION=2 — enrichment versioning"
```

---

### Task 2: Table schema enrichment

**Files:**
- Modify: `src/nodes/schemas/table.schema.ts`
- Modify: `src/nodes/schemas/table.schema.spec.ts`

- [ ] **Step 1: table.schema.ts'i tam DB modeline çıkar**

`src/nodes/schemas/table.schema.ts` içeriğini şu hale getir:

```ts
import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const DATA_TYPES = ["INT", "BIGINT", "VARCHAR", "TEXT", "BOOLEAN", "DATETIME", "DATE", "UUID", "FLOAT", "DECIMAL", "JSON", "ENUM"] as const;
const FK_ACTION = ["CASCADE", "RESTRICT", "SET_NULL", "NO_ACTION"] as const;

const ColumnSchema = z.object({
  Name: z.string().min(1).describe("Kolon adı"),
  DataType: z.enum(DATA_TYPES).describe("SQL veri tipi"),
  Length: z.number().int().positive().optional().describe("VARCHAR(n) uzunluğu"),
  Precision: z.number().int().positive().optional().describe("DECIMAL(p,s) precision"),
  Scale: z.number().int().nonnegative().optional().describe("DECIMAL(p,s) scale"),
  IsPrimaryKey: z.boolean().describe("Tek-kolon PK"),
  IsNotNull: z.boolean().describe("NOT NULL"),
  IsUnique: z.boolean().describe("UNIQUE"),
  AutoIncrement: z.boolean().describe("AUTO_INCREMENT / SERIAL"),
  DefaultValue: z.string().optional().describe("Varsayılan değer ifadesi"),
  Comment: z.string().optional().describe("Kolon yorumu"),
  EnumRef: z.string().optional().describe("DataType=ENUM ise → Enum node Name"),
  IsGenerated: z.boolean().optional().describe("GENERATED kolon"),
  GeneratedExpression: z.string().optional().describe("Generated kolon ifadesi"),
}).strict();

const ForeignKeySchema = z.object({
  Name: z.string().optional(),
  Columns: z.array(z.string().min(1)).min(1),
  ReferencesTable: z.string().min(1).describe("Hedef Table Name"),
  ReferencesColumns: z.array(z.string().min(1)).min(1),
  OnDelete: z.enum(FK_ACTION).default("NO_ACTION"),
  OnUpdate: z.enum(FK_ACTION).default("NO_ACTION"),
}).strict();

const IndexSchema = z.object({
  IndexName: z.string().min(1),
  Columns: z.array(z.string().min(1)).min(1),
  Type: z.enum(["BTree", "Hash", "GIN", "GiST"]).default("BTree"),
  IsUnique: z.boolean().default(false),
  IsPartial: z.boolean().optional(),
  WhereClause: z.string().optional(),
}).strict();

export const TableNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Table"),
  properties: z.object({
    TableName: z.string().min(1),
    Description: z.string().min(1),
    Columns: z.array(ColumnSchema).min(1),
    PrimaryKey: z.object({ Columns: z.array(z.string().min(1)).min(1) }).optional().describe("Composite PK"),
    ForeignKeys: z.array(ForeignKeySchema).default([]),
    UniqueConstraints: z.array(z.object({ Name: z.string().optional(), Columns: z.array(z.string().min(1)).min(1) })).default([]),
    CheckConstraints: z.array(z.object({ Name: z.string().optional(), Expression: z.string().min(1) })).default([]),
    Indexes: z.array(IndexSchema).default([]),
  }).strict(),
}).strict();

export type TableNode = z.infer<typeof TableNodeSchema>;
```

> NOT: Önceki `Column.IsForeignKey`/`References` kaldırıldı; tüm FK'ler `ForeignKeys[]`'te. `Indexes[]` artık `IsUnique`/`Type` zorunlu default'lu.

- [ ] **Step 2: table.schema.spec.ts'i güncelle**

`src/nodes/schemas/table.schema.spec.ts` içeriğini şu hale getir:

```ts
import { describe, it, expect } from "vitest";
import { TableNodeSchema } from "./table.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-22T10:30:00.000Z",
  updatedAt: "2026-05-22T10:30:00.000Z",
};

const validProperties = {
  TableName: "users",
  Description: "Kullanıcılar",
  Columns: [
    { Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false },
    { Name: "email", DataType: "VARCHAR", Length: 255, IsPrimaryKey: false, IsNotNull: true, IsUnique: true, AutoIncrement: false },
    { Name: "status", DataType: "ENUM", EnumRef: "UserStatus", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
  ],
  ForeignKeys: [],
  Indexes: [],
};

describe("TableNodeSchema (enriched)", () => {
  it("geçerli Table'ı parse eder", () => {
    const n = TableNodeSchema.parse({ ...validBase, type: "Table", properties: validProperties });
    expect(n.properties.Columns).toHaveLength(3);
    expect(n.properties.ForeignKeys).toEqual([]);
  });

  it("composite PrimaryKey kabul eder", () => {
    const n = TableNodeSchema.parse({
      ...validBase, type: "Table",
      properties: { ...validProperties, PrimaryKey: { Columns: ["id", "email"] } },
    });
    expect(n.properties.PrimaryKey?.Columns).toEqual(["id", "email"]);
  });

  it("ForeignKey FK actions ile parse eder", () => {
    const n = TableNodeSchema.parse({
      ...validBase, type: "Table",
      properties: {
        ...validProperties,
        ForeignKeys: [{ Columns: ["org_id"], ReferencesTable: "orgs", ReferencesColumns: ["id"], OnDelete: "CASCADE", OnUpdate: "RESTRICT" }],
      },
    });
    expect(n.properties.ForeignKeys[0].OnDelete).toBe("CASCADE");
  });

  it("CheckConstraint + UniqueConstraint kabul eder", () => {
    const n = TableNodeSchema.parse({
      ...validBase, type: "Table",
      properties: {
        ...validProperties,
        CheckConstraints: [{ Name: "age_positive", Expression: "age > 0" }],
        UniqueConstraints: [{ Name: "uq_email", Columns: ["email"] }],
      },
    });
    expect(n.properties.CheckConstraints[0].Expression).toBe("age > 0");
  });

  it("zengin Index (GIN, partial) parse eder", () => {
    const n = TableNodeSchema.parse({
      ...validBase, type: "Table",
      properties: { ...validProperties, Indexes: [{ IndexName: "idx_email", Columns: ["email"], Type: "BTree", IsUnique: true, IsPartial: true, WhereClause: "deleted_at IS NULL" }] },
    });
    expect(n.properties.Indexes[0].IsUnique).toBe(true);
  });

  it("geçersiz DataType reddeder", () => {
    expect(() => TableNodeSchema.parse({
      ...validBase, type: "Table",
      properties: { ...validProperties, Columns: [{ Name: "x", DataType: "integer", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }] },
    })).toThrow();
  });

  it("geçersiz FK action reddeder", () => {
    expect(() => TableNodeSchema.parse({
      ...validBase, type: "Table",
      properties: { ...validProperties, ForeignKeys: [{ Columns: ["x"], ReferencesTable: "t", ReferencesColumns: ["id"], OnDelete: "DROP", OnUpdate: "NO_ACTION" }] },
    })).toThrow();
  });

  it("bilinmeyen alan reddeder (strict)", () => {
    expect(() => TableNodeSchema.parse({
      ...validBase, type: "Table",
      properties: { ...validProperties, Foo: "x" },
    })).toThrow();
  });
});
```

- [ ] **Step 3: Test çalıştır**

Run: `NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=x pnpm test src/nodes/schemas/table.schema.spec.ts`
Expected: PASS (8 tests)

- [ ] **Step 4: Build sanity**

Run: `pnpm build`
Expected: hata yok

- [ ] **Step 5: Commit**

```bash
git add src/nodes/schemas/table.schema.ts src/nodes/schemas/table.schema.spec.ts
git commit -m "feat(schemas): Table enrichment — composite PK/FK + FK actions + check + rich index"
```

---

### Task 3: DTO schema enrichment

**Files:**
- Modify: `src/nodes/schemas/dto.schema.ts`
- Modify: `src/nodes/schemas/dto.schema.spec.ts`

- [ ] **Step 1: dto.schema.ts'i enrich et**

```ts
import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const VALIDATION_RULES = ["Min", "Max", "MinLength", "MaxLength", "Email", "Url", "Regex", "Pattern", "Positive", "Negative"] as const;

const ValidationRuleSchema = z.object({
  Rule: z.enum(VALIDATION_RULES),
  Value: z.string().optional(),
}).strict();

const FieldSchema = z.object({
  Name: z.string().min(1),
  DataType: z.string().min(1),
  IsRequired: z.boolean(),
  IsArray: z.boolean(),
  ValidationRules: z.array(ValidationRuleSchema).default([]),
  DefaultValue: z.string().optional(),
  NestedDTORef: z.string().optional().describe("→ DTO node Name"),
  EnumRef: z.string().optional().describe("→ Enum node Name"),
  Description: z.string().optional(),
}).strict();

export const DTONodeSchema = BaseNodeSchema.extend({
  type: z.literal("DTO"),
  properties: z.object({
    Name: z.string().min(1),
    Description: z.string().min(1),
    Fields: z.array(FieldSchema).min(1),
  }).strict(),
}).strict();

export type DTONode = z.infer<typeof DTONodeSchema>;
```

- [ ] **Step 2: dto.schema.spec.ts'i güncelle**

```ts
import { describe, it, expect } from "vitest";
import { DTONodeSchema } from "./dto.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-22T10:30:00.000Z",
  updatedAt: "2026-05-22T10:30:00.000Z",
};

const validProperties = {
  Name: "CreateUserDTO",
  Description: "Kullanıcı kayıt",
  Fields: [
    { Name: "email", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "Email" }, { Rule: "MaxLength", Value: "255" }] },
    { Name: "address", DataType: "AddressDTO", IsRequired: false, IsArray: false, NestedDTORef: "AddressDTO" },
    { Name: "role", DataType: "string", IsRequired: true, IsArray: false, EnumRef: "UserRole" },
  ],
};

describe("DTONodeSchema (enriched)", () => {
  it("geçerli DTO + validation rules parse eder", () => {
    const n = DTONodeSchema.parse({ ...validBase, type: "DTO", properties: validProperties });
    expect(n.properties.Fields[0].ValidationRules).toHaveLength(2);
  });

  it("NestedDTORef + EnumRef kabul eder", () => {
    const n = DTONodeSchema.parse({ ...validBase, type: "DTO", properties: validProperties });
    expect(n.properties.Fields[1].NestedDTORef).toBe("AddressDTO");
    expect(n.properties.Fields[2].EnumRef).toBe("UserRole");
  });

  it("ValidationRules default boş array", () => {
    const n = DTONodeSchema.parse({
      ...validBase, type: "DTO",
      properties: { Name: "X", Description: "d", Fields: [{ Name: "a", DataType: "string", IsRequired: true, IsArray: false }] },
    });
    expect(n.properties.Fields[0].ValidationRules).toEqual([]);
  });

  it("geçersiz validation rule reddeder", () => {
    expect(() => DTONodeSchema.parse({
      ...validBase, type: "DTO",
      properties: { Name: "X", Description: "d", Fields: [{ Name: "a", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "Fancy" }] }] },
    })).toThrow();
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => DTONodeSchema.parse({ ...validBase, type: "DTO", properties: rest })).toThrow();
  });
});
```

- [ ] **Step 3: Test çalıştır**

Run: `NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=x pnpm test src/nodes/schemas/dto.schema.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 4: Commit**

```bash
git add src/nodes/schemas/dto.schema.ts src/nodes/schemas/dto.schema.spec.ts
git commit -m "feat(schemas): DTO enrichment — validation rules + nested/enum ref"
```

---

### Task 4: Model schema enrichment

**Files:**
- Modify: `src/nodes/schemas/model.schema.ts`
- Modify: `src/nodes/schemas/model.schema.spec.ts`

- [ ] **Step 1: model.schema.ts'i enrich et**

```ts
import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const RELATION = ["OneToOne", "OneToMany", "ManyToOne", "ManyToMany"] as const;

const PropertySchema = z.object({
  Name: z.string().min(1),
  Type: z.string().min(1),
  IsNullable: z.boolean().default(false),
  IsCollection: z.boolean().default(false),
  RelationType: z.enum(RELATION).optional(),
  RelatedModelRef: z.string().optional().describe("→ Model node Name"),
}).strict();

const MethodSchema = z.object({
  MethodName: z.string().min(1),
  Visibility: z.enum(["public", "private", "protected"]).default("public"),
  Parameters: z.array(z.object({
    Name: z.string().min(1),
    Type: z.string().min(1),
    Optional: z.boolean().default(false),
    Default: z.string().optional(),
  })).default([]),
  ReturnType: z.string().min(1),
  IsAsync: z.boolean().default(false),
  IsStatic: z.boolean().default(false),
}).strict();

export const ModelNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Model"),
  properties: z.object({
    ClassName: z.string().min(1),
    Description: z.string().min(1),
    TableRef: z.string().optional().describe("→ Table node Name"),
    Properties: z.array(PropertySchema).min(1),
    Methods: z.array(MethodSchema).default([]),
  }).strict(),
}).strict();

export type ModelNode = z.infer<typeof ModelNodeSchema>;
```

- [ ] **Step 2: model.schema.spec.ts'i güncelle**

```ts
import { describe, it, expect } from "vitest";
import { ModelNodeSchema } from "./model.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-22T10:30:00.000Z",
  updatedAt: "2026-05-22T10:30:00.000Z",
};

const validProperties = {
  ClassName: "User",
  Description: "Kullanıcı entity",
  TableRef: "users",
  Properties: [
    { Name: "id", Type: "string", IsNullable: false, IsCollection: false },
    { Name: "orders", Type: "Order", IsNullable: false, IsCollection: true, RelationType: "OneToMany", RelatedModelRef: "Order" },
  ],
  Methods: [
    { MethodName: "fullName", Visibility: "public", Parameters: [], ReturnType: "string", IsAsync: false, IsStatic: false },
  ],
};

describe("ModelNodeSchema (enriched)", () => {
  it("geçerli Model + relation parse eder", () => {
    const n = ModelNodeSchema.parse({ ...validBase, type: "Model", properties: validProperties });
    expect(n.properties.Properties[1].RelationType).toBe("OneToMany");
    expect(n.properties.TableRef).toBe("users");
  });

  it("method signature (visibility/params/async) parse eder", () => {
    const n = ModelNodeSchema.parse({
      ...validBase, type: "Model",
      properties: { ...validProperties, Methods: [{ MethodName: "save", Visibility: "private", Parameters: [{ Name: "tx", Type: "Transaction", Optional: true }], ReturnType: "Promise<void>", IsAsync: true, IsStatic: false }] },
    });
    expect(n.properties.Methods[0].IsAsync).toBe(true);
    expect(n.properties.Methods[0].Parameters[0].Optional).toBe(true);
  });

  it("Properties default'lar (IsNullable/IsCollection false)", () => {
    const n = ModelNodeSchema.parse({
      ...validBase, type: "Model",
      properties: { ClassName: "X", Description: "d", Properties: [{ Name: "a", Type: "string" }] },
    });
    expect(n.properties.Properties[0].IsNullable).toBe(false);
    expect(n.properties.Methods).toEqual([]);
  });

  it("geçersiz RelationType reddeder", () => {
    expect(() => ModelNodeSchema.parse({
      ...validBase, type: "Model",
      properties: { ...validProperties, Properties: [{ Name: "a", Type: "X", RelationType: "HasMany" }] },
    })).toThrow();
  });
});
```

- [ ] **Step 3: Test + commit**

Run: `NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=x pnpm test src/nodes/schemas/model.schema.spec.ts`
Expected: PASS (4 tests)

```bash
git add src/nodes/schemas/model.schema.ts src/nodes/schemas/model.schema.spec.ts
git commit -m "feat(schemas): Model enrichment — relations + typed method signatures"
```

---

### Task 5: Enum schema enrichment (key-value)

**Files:**
- Modify: `src/nodes/schemas/enum.schema.ts`
- Modify: `src/nodes/schemas/enum.schema.spec.ts`

- [ ] **Step 1: enum.schema.ts'i enrich et**

```ts
import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

export const EnumNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Enum"),
  properties: z.object({
    Name: z.string().min(1),
    Description: z.string().min(1),
    BackingType: z.enum(["string", "int"]).default("string"),
    Values: z.array(z.object({
      Key: z.string().min(1),
      Value: z.string().optional().describe("backing değer (yoksa Key)"),
      Description: z.string().optional(),
    })).min(1),
  }).strict(),
}).strict();

export type EnumNode = z.infer<typeof EnumNodeSchema>;
```

- [ ] **Step 2: enum.schema.spec.ts'i güncelle**

```ts
import { describe, it, expect } from "vitest";
import { EnumNodeSchema } from "./enum.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-22T10:30:00.000Z",
  updatedAt: "2026-05-22T10:30:00.000Z",
};

const validProperties = {
  Name: "OrderStatus",
  Description: "Sipariş durumu",
  BackingType: "string" as const,
  Values: [
    { Key: "PENDING", Value: "pending", Description: "Beklemede" },
    { Key: "SHIPPED", Value: "shipped" },
    { Key: "DELIVERED" },
  ],
};

describe("EnumNodeSchema (enriched key-value)", () => {
  it("key-value + description parse eder", () => {
    const n = EnumNodeSchema.parse({ ...validBase, type: "Enum", properties: validProperties });
    expect(n.properties.Values).toHaveLength(3);
    expect(n.properties.Values[0].Value).toBe("pending");
  });

  it("BackingType default string", () => {
    const { BackingType, ...rest } = validProperties;
    const n = EnumNodeSchema.parse({ ...validBase, type: "Enum", properties: rest });
    expect(n.properties.BackingType).toBe("string");
  });

  it("int backing type kabul eder", () => {
    const n = EnumNodeSchema.parse({
      ...validBase, type: "Enum",
      properties: { ...validProperties, BackingType: "int", Values: [{ Key: "LOW", Value: "0" }, { Key: "HIGH", Value: "1" }] },
    });
    expect(n.properties.BackingType).toBe("int");
  });

  it("Values boşsa reddeder", () => {
    expect(() => EnumNodeSchema.parse({ ...validBase, type: "Enum", properties: { ...validProperties, Values: [] } })).toThrow();
  });

  it("Key boş string reddeder", () => {
    expect(() => EnumNodeSchema.parse({ ...validBase, type: "Enum", properties: { ...validProperties, Values: [{ Key: "" }] } })).toThrow();
  });
});
```

- [ ] **Step 3: Test + commit**

Run: `NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=x pnpm test src/nodes/schemas/enum.schema.spec.ts`
Expected: PASS (5 tests)

```bash
git add src/nodes/schemas/enum.schema.ts src/nodes/schemas/enum.schema.spec.ts
git commit -m "feat(schemas): Enum enrichment — key-value + backing type"
```

---

### Task 6: View schema enrichment

**Files:**
- Modify: `src/nodes/schemas/view.schema.ts`
- Modify: `src/nodes/schemas/view.schema.spec.ts`

- [ ] **Step 1: view.schema.ts'i enrich et**

```ts
import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

export const ViewNodeSchema = BaseNodeSchema.extend({
  type: z.literal("View"),
  properties: z.object({
    ViewName: z.string().min(1),
    Description: z.string().min(1),
    Definition: z.string().min(1).describe("SQL/aggregate tanımı"),
    SourceTables: z.array(z.string().min(1)).min(1).describe("→ Table Name'leri"),
    Materialized: z.boolean(),
    Columns: z.array(z.object({ Name: z.string().min(1), DataType: z.string().min(1) })).default([]),
    RefreshStrategy: z.enum(["onDemand", "scheduled", "onChange"]).optional().describe("materialized için"),
  }).strict(),
}).strict();

export type ViewNode = z.infer<typeof ViewNodeSchema>;
```

- [ ] **Step 2: view.schema.spec.ts'i güncelle**

```ts
import { describe, it, expect } from "vitest";
import { ViewNodeSchema } from "./view.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-22T10:30:00.000Z",
  updatedAt: "2026-05-22T10:30:00.000Z",
};

const validProperties = {
  ViewName: "active_users",
  Description: "Aktif kullanıcılar",
  Definition: "SELECT id, email FROM users WHERE active = true",
  SourceTables: ["users"],
  Materialized: true,
  Columns: [{ Name: "id", DataType: "UUID" }, { Name: "email", DataType: "VARCHAR" }],
  RefreshStrategy: "scheduled" as const,
};

describe("ViewNodeSchema (enriched)", () => {
  it("columns + refresh strategy parse eder", () => {
    const n = ViewNodeSchema.parse({ ...validBase, type: "View", properties: validProperties });
    expect(n.properties.Columns).toHaveLength(2);
    expect(n.properties.RefreshStrategy).toBe("scheduled");
  });

  it("Columns default boş array", () => {
    const { Columns, RefreshStrategy, ...rest } = validProperties;
    const n = ViewNodeSchema.parse({ ...validBase, type: "View", properties: rest });
    expect(n.properties.Columns).toEqual([]);
  });

  it("geçersiz RefreshStrategy reddeder", () => {
    expect(() => ViewNodeSchema.parse({ ...validBase, type: "View", properties: { ...validProperties, RefreshStrategy: "hourly" } })).toThrow();
  });

  it("SourceTables boşsa reddeder", () => {
    expect(() => ViewNodeSchema.parse({ ...validBase, type: "View", properties: { ...validProperties, SourceTables: [] } })).toThrow();
  });
});
```

- [ ] **Step 3: Test + commit**

Run: `NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=x pnpm test src/nodes/schemas/view.schema.spec.ts`
Expected: PASS (4 tests)

```bash
git add src/nodes/schemas/view.schema.ts src/nodes/schemas/view.schema.spec.ts
git commit -m "feat(schemas): View enrichment — columns + refresh strategy"
```

---

### Task 7: Veri ailesi fieldHints (UI metadata)

**Files:**
- Modify: `src/node-types/registry.ts`
- Modify: `src/node-types/node-types.service.ts`
- Modify: `src/node-types/node-types.service.spec.ts`

- [ ] **Step 1: registry.ts'e fieldHints ekle**

`NodeTypeMetadata` interface'ine `fieldHints?: Record<string, { badge?: string; group?: string }>` ekle ve `make()` imzasını genişlet. Veri ailesi girişlerine hint ekle. Örnek (Table):

```ts
// registry.ts — NodeTypeMetadata'ya alan ekle:
export interface NodeTypeMetadata {
  id: NodeKind;
  family: NodeFamily;
  familyLabel: string;
  description: string;
  nameKey: string;
  schema: z.ZodTypeAny;
  fieldHints?: Record<string, { badge?: string; group?: string }>;
}
```

Table girişine `make(...)` sonrası elle `fieldHints` ata (make signature'ı bozmamak için registry objesinde post-assign veya make'e 7. param). En basit: NODE_TYPE_REGISTRY tanımından sonra:

```ts
NODE_TYPE_REGISTRY.Table.fieldHints = {
  "Columns.IsPrimaryKey": { badge: "PK", group: "constraints" },
  "Columns.IsNotNull": { badge: "NN", group: "constraints" },
  "Columns.IsUnique": { badge: "UQ", group: "constraints" },
  "Columns.AutoIncrement": { badge: "AI", group: "constraints" },
  "ForeignKeys": { badge: "FK", group: "constraints" },
  "Indexes": { badge: "IDX", group: "performance" },
};
NODE_TYPE_REGISTRY.DTO.fieldHints = { "Fields.ValidationRules": { badge: "VALID" } };
NODE_TYPE_REGISTRY.Enum.fieldHints = { "Values": { badge: "ENUM" } };
```

- [ ] **Step 2: node-types.service.ts getById'ye fieldHints ekle**

`NodeTypeDetail`'e `fieldHints?` alanı ekle ve `getById`'de döndür:

```ts
// node-types.service.ts getById içinde:
return {
  ...this.toSummary(meta),
  schema: zodV3ToOpenAPI(meta.schema as any),
  fieldHints: meta.fieldHints ?? {},
};
```
`NodeTypeDetail` interface'ine `fieldHints: Record<string, unknown>` ekle.

- [ ] **Step 3: node-types.service.spec.ts'e test ekle**

```ts
it("getById Table fieldHints döner (PK/FK badge)", () => {
  const d = service.getById("Table") as any;
  expect(d.fieldHints["Columns.IsPrimaryKey"].badge).toBe("PK");
  expect(d.fieldHints["ForeignKeys"].badge).toBe("FK");
});
```

- [ ] **Step 4: Test + build + commit**

Run: `NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=x pnpm test src/node-types/ && pnpm build`
Expected: PASS

```bash
git add src/node-types/
git commit -m "feat(node-types): Veri ailesi fieldHints — UI badge metadata (PK/FK/NN/...)"
```

---

### Task 8: AI system prompt — Veri ailesi şema rehberi güncel

**Files:**
- Modify: `src/ai/prompts/system-prompt.ts`

- [ ] **Step 1: Veri ailesi şema satırlarını güncelle**

`system-prompt.ts` içindeki `## NODE PROPERTIES ŞEMALARI` bölümünde Table/DTO/Model/Enum/View satırlarını zengin şemaya göre değiştir. Table örneği:

```
- **Table:** { TableName, Description, Columns: [{ Name, DataType, Length?, Precision?, Scale?, IsPrimaryKey, IsNotNull, IsUnique, AutoIncrement, DefaultValue?, EnumRef?, ... }], PrimaryKey?: {Columns[]}, ForeignKeys: [{ Columns[], ReferencesTable, ReferencesColumns[], OnDelete, OnUpdate }], UniqueConstraints: [], CheckConstraints: [], Indexes: [{ IndexName, Columns[], Type, IsUnique }] }
  - DataType enum: INT/BIGINT/VARCHAR/TEXT/BOOLEAN/DATETIME/DATE/UUID/FLOAT/DECIMAL/JSON/ENUM
  - Tek-kolon FK dahil TÜM foreign key'ler ForeignKeys[]'te (Column'da IsForeignKey YOK).
- **DTO:** { Name, Description, Fields: [{ Name, DataType, IsRequired, IsArray, ValidationRules: [{Rule,Value?}], NestedDTORef?, EnumRef? }] }
- **Model:** { ClassName, Description, TableRef?, Properties: [{ Name, Type, IsNullable, IsCollection, RelationType?, RelatedModelRef? }], Methods: [{ MethodName, Visibility, Parameters: [{Name,Type,Optional}], ReturnType, IsAsync }] }
- **Enum:** { Name, Description, BackingType, Values: [{ Key, Value?, Description? }] }
- **View:** { ViewName, Description, Definition, SourceTables[], Materialized, Columns: [{Name,DataType}], RefreshStrategy? }
```

- [ ] **Step 2: Build + commit**

Run: `pnpm build`

```bash
git add src/ai/prompts/system-prompt.ts
git commit -m "feat(ai): system prompt — Veri ailesi zengin şema rehberi"
```

---

### Task 9: Migration — Faz A node dönüşümü

**Files:**
- Create: `src/neo4j/migrations/data/001-enrich-faz-a.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Migration script yaz**

```ts
// src/neo4j/migrations/data/001-enrich-faz-a.ts
import { Neo4jService } from "../../neo4j.service";
import { env } from "../../../config/env";

/** Faz A: mevcut Veri ailesi node'larını zengin şemaya dönüştür.
 *  Idempotent — eksik zorunlu alanları default ile doldurur. */
async function main() {
  const svc = new Neo4jService({ uri: env.NEO4J_URI, user: env.NEO4J_USER, password: env.NEO4J_PASSWORD });
  await svc.onModuleInit();

  const kinds = ["Table", "DTO", "Model", "Enum", "View"];
  let migrated = 0;
  for (const kind of kinds) {
    const res = await svc.run(`MATCH (n:\`${kind}\`) RETURN n.id AS id, n.properties AS props`);
    for (const rec of res.records) {
      const id = rec.get("id");
      const props = JSON.parse(rec.get("props"));
      const next = enrich(kind, props);
      await svc.run(`MATCH (n {id: $id}) SET n.properties = $props`, { id, props: JSON.stringify(next) });
      migrated++;
    }
  }
  await svc.onModuleDestroy();
  console.log(`✓ Faz A migration: ${migrated} node dönüştürüldü.`);
}

function enrich(kind: string, p: any): any {
  if (kind === "Table") {
    return {
      ...p,
      ForeignKeys: p.ForeignKeys ?? [],
      UniqueConstraints: p.UniqueConstraints ?? [],
      CheckConstraints: p.CheckConstraints ?? [],
      Indexes: (p.Indexes ?? []).map((i: any) => ({ Type: "BTree", IsUnique: false, ...i })),
      Columns: (p.Columns ?? []).map((c: any) => {
        const { IsForeignKey, References, ...rest } = c; // eski alanları at
        return rest;
      }),
    };
  }
  if (kind === "DTO") {
    return { ...p, Fields: (p.Fields ?? []).map((f: any) => ({ ValidationRules: [], ...f })) };
  }
  if (kind === "Model") {
    return {
      ...p,
      Properties: (p.Properties ?? []).map((pr: any) => ({ IsNullable: false, IsCollection: false, ...pr })),
      Methods: (p.Methods ?? []).map((m: any) => ({ Visibility: "public", Parameters: [], IsAsync: false, IsStatic: false, ...m })),
    };
  }
  if (kind === "Enum") {
    return {
      ...p,
      BackingType: p.BackingType ?? "string",
      Values: (p.Values ?? []).map((v: any) => (typeof v === "string" ? { Key: v } : v)),
    };
  }
  if (kind === "View") {
    return { ...p, Columns: p.Columns ?? [] };
  }
  return p;
}

main().catch((e) => { console.error("✗ Migration failed:", e); process.exit(1); });
```

- [ ] **Step 2: package.json'a script ekle**

`scripts`'e ekle:
```json
"migrate:data:faz-a": "tsx --env-file=.env src/neo4j/migrations/data/001-enrich-faz-a.ts"
```

- [ ] **Step 3: Migration'ı çalıştır (Neo4j açık)**

Run: `pnpm neo4j:up && sleep 12 && pnpm migrate:data:faz-a`
Expected: `✓ Faz A migration: N node dönüştürüldü.`

- [ ] **Step 4: Commit**

```bash
git add src/neo4j/migrations/data/001-enrich-faz-a.ts package.json
git commit -m "feat(migration): Faz A node dönüşümü — Veri ailesi zengin şema"
```

---

### Task 10: E2E fixtures + tam test paketi + canlı doğrulama

**Files:**
- Modify: `test/nodes.e2e-spec.ts` (Table/DTO/Model/Enum/View fixtures)

- [ ] **Step 1: e2e Table/DTO/Enum/View fixtures'ı zengin şemaya güncelle**

`test/nodes.e2e-spec.ts` `fixtures` objesinde Table'ı zengin şemaya uydur (ForeignKeys/Indexes default'lu, Column'dan IsForeignKey/References çıkar), DTO Fields'a ValidationRules ekle, Enum Values'u key-value yap, View'a Columns ekle. (Service/Controller fixtures Faz A'da değişmez.)

- [ ] **Step 2: Tüm unit + e2e testleri çalıştır**

Run: `NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=x pnpm test`
Expected: tüm unit testler PASS

Run: `pnpm test:e2e`
Expected: 9 e2e PASS

- [ ] **Step 3: Server başlat + canlı AI doğrulama (DeepSeek veya Kimi)**

```bash
set -a; source .env; set +a
LLM_GENERATION_PROVIDER=deepseek PORT=4000 node dist/main.js &
# proje oluştur + /ai/chat "users tablosu çiz: id (UUID PK), email (VARCHAR unique), status (ENUM UserStatus ref)"
```
Expected: AI ≤3 denemede zengin Table üretir (EnumRef + constraints), `applied` dolu.

- [ ] **Step 4: Build + commit + push**

```bash
pnpm build
git add test/nodes.e2e-spec.ts
git commit -m "test(faz-a): e2e fixtures zengin Veri ailesi şemasına güncellendi"
git push origin main
```

---

## FAZ B — İş Mantığı + Erişim (yapısal görevler)

Faz A pattern'iyle (schema enrich → spec güncelle → fieldHints → AI prompt → migration → test) her node için ayrı task. Spec Bölüm 4 tam alanları tanımlar.

- [ ] **Task B1: Service enrichment** — Methods[] (Visibility, Parameters typed, ReturnDtoRef, Throws[]), Dependencies[] (DI). Spec §4 Service.
- [ ] **Task B2: Orchestrator enrichment** — Steps[] (StepName, ServiceRef, CompensationAction, OnFailure). Spec §4.
- [ ] **Task B3: Worker enrichment** — RetryPolicy obj (MaxRetries, BackoffStrategy), Concurrency, IsEnabled.
- [ ] **Task B4: EventHandler enrichment** — QueueRef, RetryPolicy, DeadLetterQueue.
- [ ] **Task B5: Controller enrichment** — Endpoints[] +PathParams/QueryParams/StatusCodes/MiddlewareRefs/RateLimit.
- [ ] **Task B6: MessageQueue enrichment** — DeliveryGuarantee, DeadLetterQueue, RetentionSeconds.
- [ ] **Task B7: APIGateway enrichment** — Routes[] (Path, TargetRef, Methods, AuthRequired), AuthMode, CorsEnabled.
- [ ] **Task B8: Faz B altyapı** — GRAPH_SCHEMA_VERSION bump (3), fieldHints, system-prompt güncel, migration `002-enrich-faz-b.ts`, test + canlı AI doğrulama, commit+push.

---

## FAZ C — Altyapı + İstemci + Güvenlik + Konfig + Yapı (yapısal görevler)

Spec Bölüm 5 tam alanları tanımlar. Faz A pattern'iyle.

- [ ] **Task C1: Repository** — EntityRef, CustomQueries[] (QueryName, QueryType, Parameters, ReturnType), BaseClass, IsCached.
- [ ] **Task C2: Cache** — EvictionPolicy, MaxSizeMB, Serialization.
- [ ] **Task C3: ExternalService** — Endpoints[], RetryPolicy, RateLimit, CircuitBreaker.
- [ ] **Task C4: FrontendApp** — StateManagement, StylingApproach, Routes[].
- [ ] **Task C5: UIComponent** — Props/State typed, Events[], ChildComponentRefs[].
- [ ] **Task C6: Middleware** — MiddlewareType, Config.
- [ ] **Task C7: EnvironmentVariable** — DefaultValue, IsRequired, ValidationPattern.
- [ ] **Task C8: Exception** — ErrorCode, ParentExceptionRef.
- [ ] **Task C9: Module** — ExposedServices[], Dependencies[].
- [ ] **Task C10: Faz C altyapı** — GRAPH_SCHEMA_VERSION bump (4), fieldHints, system-prompt, migration `003-enrich-faz-c.ts`, test + canlı AI doğrulama, commit+push.

---

## Faz A Çıkış Kriterleri (Spec §7 ile)

- [x] Table/DTO/Model/Enum/View zengin (required + .describe()) — Task 2-6
- [x] GRAPH_SCHEMA_VERSION=2 + migration — Task 1, 9
- [x] create-node.dto.ts güncel (shape'ten otomatik türer — ek iş yok)
- [x] node-types fieldHints — Task 7
- [x] system-prompt güncel — Task 8
- [x] unit + service + e2e yeşil — Task 10
- [x] AI canlı doğrulama (zengin Table) — Task 10

## Notlar
- `create-node.dto.ts` properties'i `XxxNodeSchema.shape.properties`'ten türetir → schema enrich edilince otomatik güncel, ek değişiklik yok.
- `NodesRepository.findNameKey` değişmez (TableName/Name/ClassName/ViewName aynı).
- Migration idempotent (eksik alan varsa doldurur, varsa korur). Mevcut DB az veri.
- Faz B/C kendi turlarında Faz A pattern'iyle detaylanır; her biri ayrı plan veya bu planın devamı.
