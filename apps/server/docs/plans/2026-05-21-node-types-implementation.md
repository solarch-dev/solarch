# Phase 1 — Node Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `solarch-backend` repo'suna NestJS + Zod + Neo4j stack'i kuran ve Phase 1 kapsamında 5 Veri ailesi node tipini (Table, DTO, Model, Enum, View) tam CRUD endpoint'leri ile sunulan production-grade bir backend implement et.

**Architecture:** NestJS modüler yapı + Zod discriminated union ile property-level şema validasyonu + Neo4j (raw Cypher) ile persistence. Her node tipi `BaseNodeSchema`'yı extend eder; yeni tip ekleme üç adıma kodlanmıştır (schema dosyası + union'a kayıt + KIND_LABELS). Validation pipeline pipe → controller → service → repository → DB akışındadır; hata envelope'ları plans/API Spec'inden birebir.

**Tech Stack:**
- Node.js 22 LTS + TypeScript 5.x
- NestJS 11 (Express adapter)
- Zod 3.x
- neo4j-driver 5.x (raw Cypher, OGM yok)
- pnpm 10
- Vitest 2.x (Jest yerine — modern, ESM-friendly)
- supertest (HTTP e2e)
- Testcontainers 10.x (geçici Neo4j container)
- Docker Compose (lokal Neo4j 5-community + APOC)

**Spec:** [`docs/specs/2026-05-21-node-types-design.md`](../specs/2026-05-21-node-types-design.md)

**Çalışma dizini:** Tüm path'ler ve git komutları `~/Masaüstü/Arsiv/solarch-backend/` kökünden çalıştırılır.

---

## File Structure

```
solarch-backend/
├── package.json                                  Task 1
├── pnpm-lock.yaml                                Task 1 (otomatik)
├── tsconfig.json                                 Task 1
├── tsconfig.build.json                           Task 1
├── nest-cli.json                                 Task 1
├── vitest.config.ts                              Task 2
├── vitest.e2e.config.ts                          Task 20
├── docker-compose.yml                            Task 3
├── .env.example                                  Task 3
├── src/
│   ├── main.ts                                   Task 1
│   ├── app.module.ts                             Task 1
│   ├── config/
│   │   └── env.ts                                Task 4
│   ├── neo4j/
│   │   ├── neo4j.module.ts                       Task 5
│   │   ├── neo4j.service.ts                      Task 5
│   │   ├── neo4j.service.spec.ts                 Task 5
│   │   └── migrations/
│   │       ├── 001_constraints.cypher            Task 5
│   │       └── run.ts                            Task 5
│   ├── nodes/
│   │   ├── nodes.module.ts                       Task 17
│   │   ├── nodes.controller.ts                   Task 17
│   │   ├── nodes.service.ts                      Task 16
│   │   ├── nodes.service.spec.ts                 Task 16
│   │   ├── nodes.repository.ts                   Task 15
│   │   ├── nodes.repository.spec.ts              Task 15
│   │   ├── schemas/
│   │   │   ├── base.schema.ts                    Task 6
│   │   │   ├── base.schema.spec.ts               Task 6
│   │   │   ├── table.schema.ts                   Task 7
│   │   │   ├── table.schema.spec.ts              Task 7
│   │   │   ├── dto.schema.ts                     Task 8
│   │   │   ├── dto.schema.spec.ts                Task 8
│   │   │   ├── model.schema.ts                   Task 9
│   │   │   ├── model.schema.spec.ts              Task 9
│   │   │   ├── enum.schema.ts                    Task 10
│   │   │   ├── enum.schema.spec.ts               Task 10
│   │   │   ├── view.schema.ts                    Task 11
│   │   │   ├── view.schema.spec.ts               Task 11
│   │   │   └── index.ts                          Task 11
│   │   └── dto/
│   │       ├── create-node.dto.ts                Task 17
│   │       ├── update-node.dto.ts                Task 19
│   │       └── node-response.dto.ts              Task 17
│   ├── common/
│   │   ├── envelope.ts                           Task 12
│   │   ├── pipes/
│   │   │   ├── zod-validation.pipe.ts            Task 12
│   │   │   └── zod-validation.pipe.spec.ts       Task 12
│   │   └── filters/
│   │       ├── schema-error.filter.ts            Task 13
│   │       ├── schema-error.filter.spec.ts       Task 13
│   │       ├── not-found.filter.ts               Task 14
│   │       ├── conflict.filter.ts                Task 14
│   │       └── internal.filter.ts                Task 14
│   └── health/
│       ├── health.controller.ts                  Task 21
│       └── health.controller.spec.ts             Task 21
├── test/
│   └── nodes.e2e-spec.ts                         Task 20
└── README.md                                     Task 21 (update)
```

**Decomposition kararı:** Her dosya tek bir sorumluluk taşır. Schema dosyaları kind başına ayrı; pipe/filter'lar tek-amaçlı; repository sadece Cypher, service sadece business logic, controller sadece HTTP. Hiçbir dosya ~150 satırı aşmamalı.

---

# Sprint 1 — Boilerplate ve Altyapı

## Task 1: NestJS app skeleton + TypeScript config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `nest-cli.json`
- Create: `src/main.ts`
- Create: `src/app.module.ts`

- [ ] **Step 1: package.json yaz**

```json
{
  "name": "solarch-backend",
  "version": "0.1.0",
  "description": "Solarch architecture graph backend — Node CRUD + Rules Engine",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "lint": "eslint src --ext .ts",
    "neo4j:up": "docker compose up -d",
    "neo4j:down": "docker compose down",
    "neo4j:migrate": "tsx src/neo4j/migrations/run.ts"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "neo4j-driver": "^5.27.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/node": "^22.10.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "testcontainers": "^10.16.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  },
  "packageManager": "pnpm@10.0.0"
}
```

- [ ] **Step 2: tsconfig.json yaz**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: tsconfig.build.json yaz**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*.spec.ts"]
}
```

- [ ] **Step 4: nest-cli.json yaz**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 5: src/app.module.ts yaz**

```ts
import { Module } from "@nestjs/common";

@Module({})
export class AppModule {}
```

- [ ] **Step 6: src/main.ts yaz**

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
    credentials: false,
  });
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`solarch-backend listening on http://localhost:${port}`);
}

bootstrap();
```

- [ ] **Step 7: Bağımlılıkları kur**

Run: `pnpm install`
Expected: `node_modules/` oluşur, `pnpm-lock.yaml` üretilir, hata yok.

- [ ] **Step 8: Build sanity check**

Run: `pnpm build`
Expected: `dist/main.js` oluşur, hata yok.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json nest-cli.json src/main.ts src/app.module.ts
git commit -m "chore(scaffold): NestJS app skeleton + TypeScript config

Phase 1 boilerplate: NestJS 11 + TypeScript 5 + pnpm 10. Global prefix
'api/v1' ve env-driven CORS main.ts'te aktif. Henüz endpoint yok."
```

---

## Task 2: Vitest setup + sanity test

**Files:**
- Create: `vitest.config.ts`
- Create: `src/sanity.spec.ts` (silinecek)

- [ ] **Step 1: vitest.config.ts yaz**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "node",
    globals: false,
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 2: Failing sanity test yaz**

```ts
// src/sanity.spec.ts
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("vitest çalışıyor mu?", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Test çalıştır**

Run: `pnpm test`
Expected: 1 test passed, 0 failed.

- [ ] **Step 4: Sanity dosyasını sil**

```bash
rm src/sanity.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts
git commit -m "chore(test): vitest config — alias + 10s timeout"
```

---

## Task 3: Docker Compose Neo4j + .env.example

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: docker-compose.yml yaz**

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
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:7474"]
      interval: 5s
      timeout: 3s
      retries: 20
    restart: unless-stopped

volumes:
  solarch_neo4j_data:
```

- [ ] **Step 2: .env.example yaz**

```bash
NODE_ENV=development
PORT=4000

NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=solarch_dev_password

CORS_ORIGIN=http://localhost:3000
```

- [ ] **Step 3: Neo4j'yi ayağa kaldır**

Run: `pnpm neo4j:up`
Expected: `solarch-neo4j` container "Up (healthy)" durumunda.

- [ ] **Step 4: Browser'dan kontrol et**

Run: `curl -s http://localhost:7474/ | head -c 200`
Expected: JSON response içeren bir gövde (Neo4j HTTP browser).

- [ ] **Step 5: Container'ı durdur**

Run: `pnpm neo4j:down`
Expected: container "Stopped".

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore(infra): docker-compose Neo4j 5-community + APOC

Lokal Neo4j 7474 (browser) ve 7687 (bolt) portlarında. APOC plugin
otomatik yükleniyor. .env.example sample değerlerle hazır."
```

---

## Task 4: Config module — Zod ile env validation

**Files:**
- Create: `src/config/env.ts`
- Create: `src/config/env.spec.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Failing test yaz**

```ts
// src/config/env.spec.ts
import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("eksik NEO4J_URI'de fırlatır", () => {
    expect(() => parseEnv({ NEO4J_USER: "neo4j", NEO4J_PASSWORD: "x" })).toThrow();
  });

  it("geçerli env'i parse eder ve default'ları doldurur", () => {
    const env = parseEnv({
      NEO4J_URI: "bolt://localhost:7687",
      NEO4J_USER: "neo4j",
      NEO4J_PASSWORD: "x",
    });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.CORS_ORIGIN).toBe("http://localhost:3000");
  });

  it("PORT'u coerce eder (string → number)", () => {
    const env = parseEnv({
      NEO4J_URI: "bolt://localhost:7687",
      NEO4J_USER: "neo4j",
      NEO4J_PASSWORD: "x",
      PORT: "5000",
    });
    expect(env.PORT).toBe(5000);
  });

  it("geçersiz NEO4J_URI'yi reddeder", () => {
    expect(() => parseEnv({
      NEO4J_URI: "not-a-url",
      NEO4J_USER: "neo4j",
      NEO4J_PASSWORD: "x",
    })).toThrow();
  });
});
```

- [ ] **Step 2: Test fail eder**

Run: `pnpm test src/config/env.spec.ts`
Expected: "Cannot find module './env'" hatası.

- [ ] **Step 3: src/config/env.ts yaz**

```ts
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  NEO4J_URI: z.string().url(),
  NEO4J_USER: z.string().min(1),
  NEO4J_PASSWORD: z.string().min(1),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return EnvSchema.parse(source);
}

export const env = parseEnv(process.env);
```

- [ ] **Step 4: Test geçer**

Run: `pnpm test src/config/env.spec.ts`
Expected: 4 tests passed.

- [ ] **Step 5: main.ts'yi env modülünü kullanacak şekilde güncelle**

`src/main.ts` içeriğini şu hale getir:

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { env } from "./config/env";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.enableCors({ origin: env.CORS_ORIGIN, credentials: false });
  await app.listen(env.PORT);
  console.log(`solarch-backend listening on http://localhost:${env.PORT}`);
}

bootstrap();
```

- [ ] **Step 6: Build sanity**

Run: `pnpm build`
Expected: hata yok.

- [ ] **Step 7: Commit**

```bash
git add src/config/env.ts src/config/env.spec.ts src/main.ts
git commit -m "feat(config): Zod ile env validation — fail-fast boot

Eksik veya hatalı env değişkeniyle uygulama başlamaz. PORT/CORS_ORIGIN
default'ları var. main.ts artık env modülünü kullanıyor."
```

---

## Task 5: Neo4j module — driver singleton + migration runner

**Files:**
- Create: `src/neo4j/neo4j.service.ts`
- Create: `src/neo4j/neo4j.service.spec.ts`
- Create: `src/neo4j/neo4j.module.ts`
- Create: `src/neo4j/migrations/001_constraints.cypher`
- Create: `src/neo4j/migrations/run.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Failing test yaz (Testcontainers ile Neo4j)**

```ts
// src/neo4j/neo4j.service.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { Neo4jService } from "./neo4j.service";

describe("Neo4jService", () => {
  let container: StartedNeo4jContainer;
  let service: Neo4jService;

  beforeAll(async () => {
    container = await new Neo4jContainer("neo4j:5-community").withApoc().start();
    service = new Neo4jService({
      uri: container.getBoltUri(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await service.onModuleInit();
  }, 120_000);

  afterAll(async () => {
    await service.onModuleDestroy();
    await container.stop();
  });

  it("ping çalışır (1 dönderir)", async () => {
    const result = await service.run("RETURN 1 AS n");
    expect(result.records[0].get("n").toNumber()).toBe(1);
  });

  it("transaction içinde write yapar", async () => {
    await service.write(async (tx) => {
      await tx.run("CREATE (n:Test {id: 't1'})");
    });
    const result = await service.run("MATCH (n:Test {id: 't1'}) RETURN n.id AS id");
    expect(result.records[0].get("id")).toBe("t1");
  });
});
```

- [ ] **Step 2: @testcontainers/neo4j'yi devDep olarak ekle**

Run: `pnpm add -D @testcontainers/neo4j`
Expected: package.json güncellenir, lock dosya güncellenir.

- [ ] **Step 3: Test fail eder**

Run: `pnpm test src/neo4j/neo4j.service.spec.ts`
Expected: "Cannot find module './neo4j.service'" hatası.

- [ ] **Step 4: src/neo4j/neo4j.service.ts yaz**

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import neo4j, { Driver, Session, Transaction, QueryResult } from "neo4j-driver";

export interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
}

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private driver!: Driver;

  constructor(private readonly config: Neo4jConfig) {}

  async onModuleInit(): Promise<void> {
    this.driver = neo4j.driver(
      this.config.uri,
      neo4j.auth.basic(this.config.user, this.config.password),
      { disableLosslessIntegers: true },
    );
    await this.driver.verifyConnectivity();
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver?.close();
  }

  async run(cypher: string, params?: Record<string, unknown>): Promise<QueryResult> {
    const session: Session = this.driver.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async write<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const session: Session = this.driver.session();
    try {
      return await session.executeWrite(work);
    } finally {
      await session.close();
    }
  }

  async read<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const session: Session = this.driver.session();
    try {
      return await session.executeRead(work);
    } finally {
      await session.close();
    }
  }
}
```

- [ ] **Step 5: src/neo4j/neo4j.module.ts yaz**

```ts
import { Global, Module } from "@nestjs/common";
import { Neo4jService } from "./neo4j.service";
import { env } from "../config/env";

@Global()
@Module({
  providers: [
    {
      provide: Neo4jService,
      useFactory: () => new Neo4jService({
        uri: env.NEO4J_URI,
        user: env.NEO4J_USER,
        password: env.NEO4J_PASSWORD,
      }),
    },
  ],
  exports: [Neo4jService],
})
export class Neo4jModule {}
```

- [ ] **Step 6: src/app.module.ts güncelle**

```ts
import { Module } from "@nestjs/common";
import { Neo4jModule } from "./neo4j/neo4j.module";

@Module({
  imports: [Neo4jModule],
})
export class AppModule {}
```

- [ ] **Step 7: Migration cypher dosyasını yaz**

```cypher
-- src/neo4j/migrations/001_constraints.cypher
CREATE CONSTRAINT node_id_unique IF NOT EXISTS
  FOR (n:Node) REQUIRE n.id IS UNIQUE;

CREATE INDEX node_project_idx IF NOT EXISTS
  FOR (n:Node) ON (n.projectId);
```

- [ ] **Step 8: Migration runner script yaz**

```ts
// src/neo4j/migrations/run.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Neo4jService } from "../neo4j.service";
import { env } from "../../config/env";

async function main() {
  const service = new Neo4jService({
    uri: env.NEO4J_URI,
    user: env.NEO4J_USER,
    password: env.NEO4J_PASSWORD,
  });
  await service.onModuleInit();

  const dir = join(__dirname);
  const files = readdirSync(dir).filter((f) => f.endsWith(".cypher")).sort();

  for (const file of files) {
    const cypher = readFileSync(join(dir, file), "utf-8");
    const statements = cypher.split(/;\s*$/m).map((s) => s.trim()).filter((s) => s && !s.startsWith("--"));
    for (const stmt of statements) {
      console.log(`[${file}] ${stmt.slice(0, 80)}...`);
      await service.run(stmt);
    }
  }

  await service.onModuleDestroy();
  console.log("✓ Migrations complete.");
}

main().catch((err) => {
  console.error("✗ Migration failed:", err);
  process.exit(1);
});
```

- [ ] **Step 9: Test geçer**

Run: `pnpm test src/neo4j/neo4j.service.spec.ts`
Expected: 2 tests passed (Testcontainers ilk run'da Docker image indirir, ~2 dakika).

- [ ] **Step 10: Build sanity**

Run: `pnpm build`
Expected: hata yok.

- [ ] **Step 11: Migration manual run**

Run: `pnpm neo4j:up && sleep 15 && cp .env.example .env && pnpm neo4j:migrate`
Expected: `✓ Migrations complete.` ve 2 statement uygulandı.

- [ ] **Step 12: Container'ı durdur**

Run: `pnpm neo4j:down`

- [ ] **Step 13: Commit**

```bash
git add src/neo4j/ src/app.module.ts package.json pnpm-lock.yaml
git commit -m "feat(neo4j): driver singleton + migration runner

Neo4jModule global olarak driver'ı sağlar (verifyConnectivity boot'ta).
run/read/write transaction wrapper'ları; session lifecycle güvenli.
Migration 001 node_id unique constraint + project index kurar.
Testcontainers ile e2e doğrulandı."
```

---

# Sprint 2 — Node Şemaları

## Task 6: BaseNodeSchema + Position

**Files:**
- Create: `src/nodes/schemas/base.schema.ts`
- Create: `src/nodes/schemas/base.schema.spec.ts`

- [ ] **Step 1: Failing test yaz**

```ts
// src/nodes/schemas/base.schema.spec.ts
import { describe, it, expect } from "vitest";
import { BaseNodeSchema, PositionSchema } from "./base.schema";

describe("PositionSchema", () => {
  it("geçerli position'ı parse eder", () => {
    const result = PositionSchema.parse({ x: 150, y: 300 });
    expect(result).toEqual({ x: 150, y: 300 });
  });

  it("x veya y eksikse fırlatır", () => {
    expect(() => PositionSchema.parse({ x: 150 })).toThrow();
  });

  it("x veya y number değilse fırlatır", () => {
    expect(() => PositionSchema.parse({ x: "150", y: 300 })).toThrow();
  });
});

describe("BaseNodeSchema", () => {
  const valid = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    projectId: "550e8400-e29b-41d4-a716-446655440001",
    position: { x: 0, y: 0 },
    createdAt: "2026-05-21T10:30:00.000Z",
    updatedAt: "2026-05-21T10:30:00.000Z",
  };

  it("geçerli base node'u parse eder", () => {
    expect(() => BaseNodeSchema.parse(valid)).not.toThrow();
  });

  it("id UUID değilse fırlatır", () => {
    expect(() => BaseNodeSchema.parse({ ...valid, id: "abc" })).toThrow();
  });

  it("createdAt ISO datetime değilse fırlatır", () => {
    expect(() => BaseNodeSchema.parse({ ...valid, createdAt: "yesterday" })).toThrow();
  });

  it("projectId UUID değilse fırlatır", () => {
    expect(() => BaseNodeSchema.parse({ ...valid, projectId: "p1" })).toThrow();
  });
});
```

- [ ] **Step 2: Test fail eder**

Run: `pnpm test src/nodes/schemas/base.schema.spec.ts`
Expected: "Cannot find module './base.schema'" hatası.

- [ ] **Step 3: base.schema.ts yaz**

```ts
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

export type BaseNode = z.infer<typeof BaseNodeSchema>;
export type Position = z.infer<typeof PositionSchema>;
```

- [ ] **Step 4: Test geçer**

Run: `pnpm test src/nodes/schemas/base.schema.spec.ts`
Expected: 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/nodes/schemas/base.schema.ts src/nodes/schemas/base.schema.spec.ts
git commit -m "feat(schemas): BaseNodeSchema — yeni tip için zorunlu base alanlar

id (UUID), projectId (UUID), position (x,y), createdAt/updatedAt (ISO).
Her node tipi bu base'i extend edecek."
```

---

## Task 7: Table node schema

**Files:**
- Create: `src/nodes/schemas/table.schema.ts`
- Create: `src/nodes/schemas/table.schema.spec.ts`

- [ ] **Step 1: Failing test yaz**

```ts
// src/nodes/schemas/table.schema.spec.ts
import { describe, it, expect } from "vitest";
import { TableNodeSchema } from "./table.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  TableName: "users",
  Description: "Kayıtlı kullanıcılar",
  Columns: [
    {
      Name: "id",
      DataType: "UUID",
      IsPrimaryKey: true,
      IsForeignKey: false,
      IsNotNull: true,
      IsUnique: true,
      AutoIncrement: false,
    },
  ],
  Indexes: [],
};

describe("TableNodeSchema", () => {
  it("geçerli Table node'u parse eder", () => {
    const node = TableNodeSchema.parse({ ...validBase, type: "Table", properties: validProperties });
    expect(node.type).toBe("Table");
    expect(node.properties.TableName).toBe("users");
  });

  it("Description eksikse fırlatır", () => {
    const { Description, ...rest } = validProperties;
    expect(() => TableNodeSchema.parse({ ...validBase, type: "Table", properties: rest })).toThrow();
  });

  it("Columns boşsa fırlatır", () => {
    expect(() => TableNodeSchema.parse({
      ...validBase, type: "Table",
      properties: { ...validProperties, Columns: [] },
    })).toThrow();
  });

  it("Bilinmeyen DataType reddeder", () => {
    expect(() => TableNodeSchema.parse({
      ...validBase, type: "Table",
      properties: { ...validProperties, Columns: [{ ...validProperties.Columns[0], DataType: "FOOBAR" }] },
    })).toThrow();
  });

  it("Properties içinde bilinmeyen alanı reddeder (strict)", () => {
    expect(() => TableNodeSchema.parse({
      ...validBase, type: "Table",
      properties: { ...validProperties, ExtraField: "x" },
    })).toThrow();
  });

  it("type literal değilse reddeder", () => {
    expect(() => TableNodeSchema.parse({ ...validBase, type: "Foo", properties: validProperties })).toThrow();
  });

  it("Indexes default boş array olur (verilmezse)", () => {
    const { Indexes, ...partialProps } = validProperties;
    const node = TableNodeSchema.parse({ ...validBase, type: "Table", properties: partialProps });
    expect(node.properties.Indexes).toEqual([]);
  });
});
```

- [ ] **Step 2: Test fail eder**

Run: `pnpm test src/nodes/schemas/table.schema.spec.ts`
Expected: "Cannot find module './table.schema'" hatası.

- [ ] **Step 3: table.schema.ts yaz**

```ts
import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const ColumnSchema = z.object({
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
}).strict();

const IndexSchema = z.object({
  IndexName: z.string().min(1),
  Columns: z.array(z.string()).min(1),
  Type: z.enum(["B-Tree", "Hash"]),
}).strict();

export const TableNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Table"),
  properties: z.object({
    TableName: z.string().min(1),
    Description: z.string().min(1),
    Columns: z.array(ColumnSchema).min(1),
    Indexes: z.array(IndexSchema).default([]),
  }).strict(),
}).strict();

export type TableNode = z.infer<typeof TableNodeSchema>;
```

- [ ] **Step 4: Test geçer**

Run: `pnpm test src/nodes/schemas/table.schema.spec.ts`
Expected: 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/nodes/schemas/table.schema.ts src/nodes/schemas/table.schema.spec.ts
git commit -m "feat(schemas): Table node — Columns/Indexes ile plans birebir"
```

---

## Task 8: DTO node schema

**Files:**
- Create: `src/nodes/schemas/dto.schema.ts`
- Create: `src/nodes/schemas/dto.schema.spec.ts`

- [ ] **Step 1: Failing test yaz**

```ts
// src/nodes/schemas/dto.schema.spec.ts
import { describe, it, expect } from "vitest";
import { DTONodeSchema } from "./dto.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  Name: "CreateUserRequestDTO",
  Description: "Yeni kullanıcı kayıt isteği",
  Fields: [
    { Name: "email", DataType: "string", IsRequired: true, ValidationRule: "Email", IsArray: false },
    { Name: "age", DataType: "number", IsRequired: false, IsArray: false },
  ],
};

describe("DTONodeSchema", () => {
  it("geçerli DTO'yu parse eder", () => {
    const node = DTONodeSchema.parse({ ...validBase, type: "DTO", properties: validProperties });
    expect(node.properties.Fields).toHaveLength(2);
  });

  it("Description eksikse fırlatır", () => {
    const { Description, ...rest } = validProperties;
    expect(() => DTONodeSchema.parse({ ...validBase, type: "DTO", properties: rest })).toThrow();
  });

  it("Fields boşsa fırlatır", () => {
    expect(() => DTONodeSchema.parse({
      ...validBase, type: "DTO",
      properties: { ...validProperties, Fields: [] },
    })).toThrow();
  });

  it("Field içinde IsRequired boolean değilse fırlatır", () => {
    expect(() => DTONodeSchema.parse({
      ...validBase, type: "DTO",
      properties: { ...validProperties, Fields: [{ Name: "x", DataType: "string", IsRequired: "yes", IsArray: false }] },
    })).toThrow();
  });

  it("ValidationRule opsiyonel", () => {
    const node = DTONodeSchema.parse({ ...validBase, type: "DTO", properties: validProperties });
    expect(node.properties.Fields[1].ValidationRule).toBeUndefined();
  });
});
```

- [ ] **Step 2: Test fail eder**

Run: `pnpm test src/nodes/schemas/dto.schema.spec.ts`
Expected: "Cannot find module './dto.schema'" hatası.

- [ ] **Step 3: dto.schema.ts yaz**

```ts
import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const FieldSchema = z.object({
  Name: z.string().min(1),
  DataType: z.string().min(1),
  IsRequired: z.boolean(),
  ValidationRule: z.string().optional(),
  IsArray: z.boolean(),
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

- [ ] **Step 4: Test geçer**

Run: `pnpm test src/nodes/schemas/dto.schema.spec.ts`
Expected: 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/nodes/schemas/dto.schema.ts src/nodes/schemas/dto.schema.spec.ts
git commit -m "feat(schemas): DTO node — Fields ile validation rule destekli"
```

---

## Task 9: Model node schema

**Files:**
- Create: `src/nodes/schemas/model.schema.ts`
- Create: `src/nodes/schemas/model.schema.spec.ts`

- [ ] **Step 1: Failing test yaz**

```ts
// src/nodes/schemas/model.schema.spec.ts
import { describe, it, expect } from "vitest";
import { ModelNodeSchema } from "./model.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  ClassName: "User",
  Description: "Kullanıcı entity sınıfı",
  Properties: [
    { Name: "id", Type: "UUID" },
    { Name: "email", Type: "string" },
  ],
  Methods: [
    { MethodName: "fullName", ReturnType: "string" },
  ],
};

describe("ModelNodeSchema", () => {
  it("geçerli Model'i parse eder", () => {
    const node = ModelNodeSchema.parse({ ...validBase, type: "Model", properties: validProperties });
    expect(node.properties.ClassName).toBe("User");
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => ModelNodeSchema.parse({ ...validBase, type: "Model", properties: rest })).toThrow();
  });

  it("Properties boşsa fırlatır", () => {
    expect(() => ModelNodeSchema.parse({
      ...validBase, type: "Model",
      properties: { ...validProperties, Properties: [] },
    })).toThrow();
  });

  it("Methods default boş array", () => {
    const { Methods, ...partial } = validProperties;
    const node = ModelNodeSchema.parse({ ...validBase, type: "Model", properties: partial });
    expect(node.properties.Methods).toEqual([]);
  });
});
```

- [ ] **Step 2: Test fail eder**

Run: `pnpm test src/nodes/schemas/model.schema.spec.ts`
Expected: "Cannot find module './model.schema'" hatası.

- [ ] **Step 3: model.schema.ts yaz**

```ts
import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const PropertySchema = z.object({
  Name: z.string().min(1),
  Type: z.string().min(1),
}).strict();

const MethodSchema = z.object({
  MethodName: z.string().min(1),
  ReturnType: z.string().min(1),
}).strict();

export const ModelNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Model"),
  properties: z.object({
    ClassName: z.string().min(1),
    Description: z.string().min(1),
    Properties: z.array(PropertySchema).min(1),
    Methods: z.array(MethodSchema).default([]),
  }).strict(),
}).strict();

export type ModelNode = z.infer<typeof ModelNodeSchema>;
```

- [ ] **Step 4: Test geçer**

Run: `pnpm test src/nodes/schemas/model.schema.spec.ts`
Expected: 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/nodes/schemas/model.schema.ts src/nodes/schemas/model.schema.spec.ts
git commit -m "feat(schemas): Model node — Properties/Methods plans birebir"
```

---

## Task 10: Enum node schema

**Files:**
- Create: `src/nodes/schemas/enum.schema.ts`
- Create: `src/nodes/schemas/enum.schema.spec.ts`

- [ ] **Step 1: Failing test yaz**

```ts
// src/nodes/schemas/enum.schema.spec.ts
import { describe, it, expect } from "vitest";
import { EnumNodeSchema } from "./enum.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  Name: "OrderStatus",
  Description: "Sipariş durumu",
  Values: ["PENDING", "SHIPPED", "DELIVERED"],
};

describe("EnumNodeSchema", () => {
  it("geçerli Enum'u parse eder", () => {
    const node = EnumNodeSchema.parse({ ...validBase, type: "Enum", properties: validProperties });
    expect(node.properties.Values).toHaveLength(3);
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => EnumNodeSchema.parse({ ...validBase, type: "Enum", properties: rest })).toThrow();
  });

  it("Values boşsa fırlatır", () => {
    expect(() => EnumNodeSchema.parse({
      ...validBase, type: "Enum",
      properties: { ...validProperties, Values: [] },
    })).toThrow();
  });

  it("Values içinde boş string reddedilir", () => {
    expect(() => EnumNodeSchema.parse({
      ...validBase, type: "Enum",
      properties: { ...validProperties, Values: ["A", ""] },
    })).toThrow();
  });
});
```

- [ ] **Step 2: Test fail eder**

Run: `pnpm test src/nodes/schemas/enum.schema.spec.ts`
Expected: "Cannot find module './enum.schema'" hatası.

- [ ] **Step 3: enum.schema.ts yaz**

```ts
import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

export const EnumNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Enum"),
  properties: z.object({
    Name: z.string().min(1),
    Description: z.string().min(1),
    Values: z.array(z.string().min(1)).min(1),
  }).strict(),
}).strict();

export type EnumNode = z.infer<typeof EnumNodeSchema>;
```

- [ ] **Step 4: Test geçer**

Run: `pnpm test src/nodes/schemas/enum.schema.spec.ts`
Expected: 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/nodes/schemas/enum.schema.ts src/nodes/schemas/enum.schema.spec.ts
git commit -m "feat(schemas): Enum node — string Values array (plans key-value Phase 2)"
```

---

## Task 11: View node schema (placeholder) + NodeSchema union

**Files:**
- Create: `src/nodes/schemas/view.schema.ts`
- Create: `src/nodes/schemas/view.schema.spec.ts`
- Create: `src/nodes/schemas/index.ts`

- [ ] **Step 1: View test yaz**

```ts
// src/nodes/schemas/view.schema.spec.ts
import { describe, it, expect } from "vitest";
import { ViewNodeSchema } from "./view.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  ViewName: "active_users_view",
  Description: "Aktif kullanıcıları döner",
  Definition: "SELECT id, email FROM users WHERE active = true",
  SourceTables: ["users"],
  Materialized: false,
};

describe("ViewNodeSchema", () => {
  it("geçerli View'i parse eder", () => {
    const node = ViewNodeSchema.parse({ ...validBase, type: "View", properties: validProperties });
    expect(node.properties.SourceTables).toEqual(["users"]);
  });

  it("Definition boşsa fırlatır", () => {
    expect(() => ViewNodeSchema.parse({
      ...validBase, type: "View",
      properties: { ...validProperties, Definition: "" },
    })).toThrow();
  });

  it("SourceTables boşsa fırlatır", () => {
    expect(() => ViewNodeSchema.parse({
      ...validBase, type: "View",
      properties: { ...validProperties, SourceTables: [] },
    })).toThrow();
  });

  it("Materialized boolean değilse fırlatır", () => {
    expect(() => ViewNodeSchema.parse({
      ...validBase, type: "View",
      properties: { ...validProperties, Materialized: "no" },
    })).toThrow();
  });
});
```

- [ ] **Step 2: View test fail eder**

Run: `pnpm test src/nodes/schemas/view.schema.spec.ts`
Expected: "Cannot find module './view.schema'" hatası.

- [ ] **Step 3: view.schema.ts yaz**

```ts
import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

// PLACEHOLDER — plans/Node Schemas'ta detay yok; plans güncellenince üzerine yazılır.
export const ViewNodeSchema = BaseNodeSchema.extend({
  type: z.literal("View"),
  properties: z.object({
    ViewName: z.string().min(1),
    Description: z.string().min(1),
    Definition: z.string().min(1),
    SourceTables: z.array(z.string()).min(1),
    Materialized: z.boolean(),
  }).strict(),
}).strict();

export type ViewNode = z.infer<typeof ViewNodeSchema>;
```

- [ ] **Step 4: View test geçer**

Run: `pnpm test src/nodes/schemas/view.schema.spec.ts`
Expected: 4 tests passed.

- [ ] **Step 5: NodeSchema union için test yaz**

```ts
// src/nodes/schemas/index.spec.ts
import { describe, it, expect } from "vitest";
import { NodeSchema, KIND_LABELS, type Node, type NodeKind } from "./index";

const baseFields = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

describe("NodeSchema (union)", () => {
  it("Table tipini parse eder", () => {
    const node = NodeSchema.parse({
      ...baseFields, type: "Table",
      properties: {
        TableName: "u", Description: "d",
        Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsForeignKey: false, IsNotNull: true, IsUnique: true, AutoIncrement: false }],
        Indexes: [],
      },
    });
    expect(node.type).toBe("Table");
  });

  it("Bilinmeyen type'ı reddeder", () => {
    expect(() => NodeSchema.parse({ ...baseFields, type: "Foo", properties: {} })).toThrow();
  });

  it("KIND_LABELS 5 tipi içerir", () => {
    const labels: NodeKind[] = ["Table", "DTO", "Model", "Enum", "View"];
    for (const k of labels) {
      expect(KIND_LABELS[k]).toBe(k);
    }
  });
});
```

- [ ] **Step 6: index test fail eder**

Run: `pnpm test src/nodes/schemas/index.spec.ts`
Expected: "Cannot find module './index'" hatası.

- [ ] **Step 7: index.ts yaz**

```ts
import { z } from "zod";
import { TableNodeSchema } from "./table.schema";
import { DTONodeSchema } from "./dto.schema";
import { ModelNodeSchema } from "./model.schema";
import { EnumNodeSchema } from "./enum.schema";
import { ViewNodeSchema } from "./view.schema";

export { BaseNodeSchema, PositionSchema, type BaseNode, type Position } from "./base.schema";
export { TableNodeSchema, type TableNode } from "./table.schema";
export { DTONodeSchema, type DTONode } from "./dto.schema";
export { ModelNodeSchema, type ModelNode } from "./model.schema";
export { EnumNodeSchema, type EnumNode } from "./enum.schema";
export { ViewNodeSchema, type ViewNode } from "./view.schema";

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

- [ ] **Step 8: index test geçer**

Run: `pnpm test src/nodes/schemas/index.spec.ts`
Expected: 3 tests passed.

- [ ] **Step 9: Tüm şema testlerini topluca çalıştır**

Run: `pnpm test src/nodes/schemas/`
Expected: tüm testler geçer (toplam ~27).

- [ ] **Step 10: Commit**

```bash
git add src/nodes/schemas/view.schema.ts src/nodes/schemas/view.schema.spec.ts src/nodes/schemas/index.ts src/nodes/schemas/index.spec.ts
git commit -m "feat(schemas): View placeholder + NodeSchema discriminated union

View plans'ta detay yok; ViewName/Description/Definition/SourceTables/
Materialized placeholder şeması — plans güncellenince üzerine yazılır.
NodeSchema 5 kind'ı birleştirir, KIND_LABELS Neo4j label whitelist'i."
```

---

# Sprint 3 — Common Katmanlar

## Task 12: Envelope helper + ZodValidationPipe

**Files:**
- Create: `src/common/envelope.ts`
- Create: `src/common/pipes/zod-validation.pipe.ts`
- Create: `src/common/pipes/zod-validation.pipe.spec.ts`

- [ ] **Step 1: Envelope helper yaz (test'siz — saf data type)**

```ts
// src/common/envelope.ts
export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface ErrorDetail {
  field: string;
  issue: string;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
}

export function ok<T>(data: T): SuccessEnvelope<T> {
  return { success: true, data };
}

export function err(code: string, message: string, details?: ErrorDetail[]): ErrorEnvelope {
  return { success: false, error: details ? { code, message, details } : { code, message } };
}
```

- [ ] **Step 2: ZodValidationPipe için failing test yaz**

```ts
// src/common/pipes/zod-validation.pipe.spec.ts
import { describe, it, expect } from "vitest";
import { z, ZodError } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe";

const Schema = z.object({ name: z.string(), age: z.number() }).strict();

describe("ZodValidationPipe", () => {
  it("geçerli body'i transform eder", () => {
    const pipe = new ZodValidationPipe(Schema);
    expect(pipe.transform({ name: "x", age: 1 })).toEqual({ name: "x", age: 1 });
  });

  it("invalid body'de ZodError fırlatır", () => {
    const pipe = new ZodValidationPipe(Schema);
    expect(() => pipe.transform({ name: "x" })).toThrow(ZodError);
  });

  it("bilinmeyen alanda ZodError fırlatır (strict)", () => {
    const pipe = new ZodValidationPipe(Schema);
    expect(() => pipe.transform({ name: "x", age: 1, extra: "y" })).toThrow(ZodError);
  });
});
```

- [ ] **Step 3: Test fail eder**

Run: `pnpm test src/common/pipes/zod-validation.pipe.spec.ts`
Expected: "Cannot find module './zod-validation.pipe'" hatası.

- [ ] **Step 4: zod-validation.pipe.ts yaz**

```ts
import { Injectable, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
```

- [ ] **Step 5: Test geçer**

Run: `pnpm test src/common/pipes/zod-validation.pipe.spec.ts`
Expected: 3 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/common/envelope.ts src/common/pipes/zod-validation.pipe.ts src/common/pipes/zod-validation.pipe.spec.ts
git commit -m "feat(common): envelope helper + ZodValidationPipe

ok()/err() response shape factory. ZodValidationPipe ZodError fırlatır;
SchemaErrorFilter sonraki task'ta envelope'a çevirecek."
```

---

## Task 13: SchemaErrorFilter — ERR_SCHEMA_INVALID envelope

**Files:**
- Create: `src/common/filters/schema-error.filter.ts`
- Create: `src/common/filters/schema-error.filter.spec.ts`

- [ ] **Step 1: Failing test yaz**

```ts
// src/common/filters/schema-error.filter.spec.ts
import { describe, it, expect, vi } from "vitest";
import { z, ZodError } from "zod";
import { SchemaErrorFilter } from "./schema-error.filter";

function makeHostMock() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    } as any,
    status,
    json,
  };
}

describe("SchemaErrorFilter", () => {
  it("ZodError'ı 400 + ERR_SCHEMA_INVALID envelope'una çevirir", () => {
    const filter = new SchemaErrorFilter();
    const { host, status, json } = makeHostMock();

    let zerr: ZodError;
    try {
      z.object({ name: z.string() }).parse({});
    } catch (e) {
      zerr = e as ZodError;
    }

    filter.catch(zerr!, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "ERR_SCHEMA_INVALID",
        message: "Gönderilen özellikler şema ile uyuşmuyor.",
        details: expect.any(Array),
      },
    });

    const arg = json.mock.calls[0][0];
    expect(arg.error.details).toHaveLength(1);
    expect(arg.error.details[0].field).toBe("name");
  });

  it("nested path'leri dotted string'e çevirir", () => {
    const filter = new SchemaErrorFilter();
    const { host, json } = makeHostMock();

    let zerr: ZodError;
    try {
      z.object({ properties: z.object({ Columns: z.array(z.object({ Name: z.string() })) }) })
        .parse({ properties: { Columns: [{}] } });
    } catch (e) {
      zerr = e as ZodError;
    }

    filter.catch(zerr!, host);
    const arg = json.mock.calls[0][0];
    expect(arg.error.details[0].field).toBe("properties.Columns.0.Name");
  });
});
```

- [ ] **Step 2: Test fail eder**

Run: `pnpm test src/common/filters/schema-error.filter.spec.ts`
Expected: "Cannot find module './schema-error.filter'" hatası.

- [ ] **Step 3: schema-error.filter.ts yaz**

```ts
import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { ZodError } from "zod";
import { err } from "../envelope";

@Catch(ZodError)
export class SchemaErrorFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const details = exception.issues.map((issue) => ({
      field: issue.path.join("."),
      issue: issue.message,
    }));
    response.status(400).json(
      err(
        "ERR_SCHEMA_INVALID",
        "Gönderilen özellikler şema ile uyuşmuyor.",
        details,
      ),
    );
  }
}
```

- [ ] **Step 4: Test geçer**

Run: `pnpm test src/common/filters/schema-error.filter.spec.ts`
Expected: 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/common/filters/schema-error.filter.ts src/common/filters/schema-error.filter.spec.ts
git commit -m "feat(common): SchemaErrorFilter — ZodError → ERR_SCHEMA_INVALID

Plans/API spec birebir envelope. issue.path dotted (properties.Columns.0.Name)."
```

---

## Task 14: NotFound + Conflict + Internal filters + global registration

**Files:**
- Create: `src/common/filters/not-found.filter.ts`
- Create: `src/common/filters/conflict.filter.ts`
- Create: `src/common/filters/internal.filter.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: not-found.filter.ts yaz**

```ts
import { ArgumentsHost, Catch, ExceptionFilter, NotFoundException } from "@nestjs/common";
import { err } from "../envelope";

@Catch(NotFoundException)
export class NotFoundFilter implements ExceptionFilter {
  catch(exception: NotFoundException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const res = exception.getResponse() as { code?: string; message?: string } | string;
    const code = typeof res === "object" && res.code ? res.code : "ERR_NODE_NOT_FOUND";
    const message = typeof res === "object" && res.message ? res.message : "Kayıt bulunamadı.";
    response.status(404).json(err(code, message));
  }
}
```

- [ ] **Step 2: conflict.filter.ts yaz**

```ts
import { ArgumentsHost, Catch, ConflictException, ExceptionFilter } from "@nestjs/common";
import { err } from "../envelope";

@Catch(ConflictException)
export class ConflictFilter implements ExceptionFilter {
  catch(exception: ConflictException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const res = exception.getResponse() as { code?: string; message?: string } | string;
    const code = typeof res === "object" && res.code ? res.code : "ERR_CONFLICT";
    const message = typeof res === "object" && res.message ? res.message : "Çatışma.";
    response.status(409).json(err(code, message));
  }
}
```

- [ ] **Step 3: internal.filter.ts yaz**

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { err } from "../envelope";

@Catch()
export class InternalFilter implements ExceptionFilter {
  private readonly logger = new Logger(InternalFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse() as { code?: string; message?: string } | string;
      const code = typeof res === "object" && res.code ? res.code : `ERR_HTTP_${status}`;
      const message = typeof res === "object" && res.message
        ? res.message
        : (typeof res === "string" ? res : exception.message);
      response.status(status).json(err(code, message));
      return;
    }

    this.logger.error("Beklenmeyen hata", exception instanceof Error ? exception.stack : exception);
    response.status(500).json(err("ERR_INTERNAL", "Beklenmeyen bir hata oluştu."));
  }
}
```

- [ ] **Step 4: main.ts'de global filter sırasını kur**

`src/main.ts` içeriğini şu hale getir:

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { env } from "./config/env";
import { SchemaErrorFilter } from "./common/filters/schema-error.filter";
import { NotFoundFilter } from "./common/filters/not-found.filter";
import { ConflictFilter } from "./common/filters/conflict.filter";
import { InternalFilter } from "./common/filters/internal.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.enableCors({ origin: env.CORS_ORIGIN, credentials: false });
  // En spesifik filter en sonda — NestJS ters sırada uygular.
  app.useGlobalFilters(
    new InternalFilter(),
    new ConflictFilter(),
    new NotFoundFilter(),
    new SchemaErrorFilter(),
  );
  await app.listen(env.PORT);
  console.log(`solarch-backend listening on http://localhost:${env.PORT}`);
}

bootstrap();
```

- [ ] **Step 5: Build sanity**

Run: `pnpm build`
Expected: hata yok.

- [ ] **Step 6: Tüm common testler geçiyor**

Run: `pnpm test src/common/`
Expected: tüm testler geçer.

- [ ] **Step 7: Commit**

```bash
git add src/common/filters/not-found.filter.ts src/common/filters/conflict.filter.ts src/common/filters/internal.filter.ts src/main.ts
git commit -m "feat(common): NotFound + Conflict + Internal filter — envelope tutarlı

NotFoundFilter ERR_NODE_NOT_FOUND default code; HttpException response
{code, message} ise ondan alır. InternalFilter catch-all 500 ERR_INTERNAL,
HttpException'ları kendi status/code'una geri yollar. Global sıra:
Schema → NotFound → Conflict → Internal (en spesifik en önce uygulanır)."
```

---

# Sprint 4 — Nodes Domain

## Task 15: NodesRepository — Cypher queries

**Files:**
- Create: `src/nodes/nodes.repository.ts`
- Create: `src/nodes/nodes.repository.spec.ts`

- [ ] **Step 1: Failing test yaz**

```ts
// src/nodes/nodes.repository.spec.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { Neo4jService } from "../neo4j/neo4j.service";
import { NodesRepository, type StoredNode } from "./nodes.repository";

const projectId = "550e8400-e29b-41d4-a716-446655440001";
const nodeFixture = (overrides: Partial<StoredNode> = {}): StoredNode => ({
  id: "550e8400-e29b-41d4-a716-446655440000",
  type: "Table",
  projectId,
  positionX: 100,
  positionY: 200,
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
  properties: { TableName: "users", Description: "u", Columns: [], Indexes: [] },
  ...overrides,
});

describe("NodesRepository", () => {
  let container: StartedNeo4jContainer;
  let neo4j: Neo4jService;
  let repo: NodesRepository;

  beforeAll(async () => {
    container = await new Neo4jContainer("neo4j:5-community").withApoc().start();
    neo4j = new Neo4jService({
      uri: container.getBoltUri(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await neo4j.onModuleInit();
    await neo4j.run("CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE");
    await neo4j.run("CREATE INDEX node_project_idx IF NOT EXISTS FOR (n:Node) ON (n.projectId)");
    repo = new NodesRepository(neo4j);
  }, 120_000);

  afterAll(async () => {
    await neo4j.onModuleDestroy();
    await container.stop();
  });

  beforeEach(async () => {
    await neo4j.run("MATCH (n:Node) DETACH DELETE n");
  });

  it("create + getById ile node'u geri okur", async () => {
    await repo.create(nodeFixture());
    const got = await repo.getById(projectId, "550e8400-e29b-41d4-a716-446655440000");
    expect(got?.type).toBe("Table");
    expect(got?.properties).toEqual({ TableName: "users", Description: "u", Columns: [], Indexes: [] });
  });

  it("getById yoksa null döner", async () => {
    const got = await repo.getById(projectId, "00000000-0000-0000-0000-000000000000");
    expect(got).toBeNull();
  });

  it("list project'in tüm node'larını döner", async () => {
    await repo.create(nodeFixture({ id: "550e8400-e29b-41d4-a716-446655440002" }));
    await repo.create(nodeFixture({ id: "550e8400-e29b-41d4-a716-446655440003", type: "DTO", properties: { Name: "X", Description: "d", Fields: [] } }));
    const list = await repo.list(projectId);
    expect(list).toHaveLength(2);
  });

  it("list type filter çalışıyor", async () => {
    await repo.create(nodeFixture({ id: "550e8400-e29b-41d4-a716-446655440002" }));
    await repo.create(nodeFixture({ id: "550e8400-e29b-41d4-a716-446655440003", type: "DTO", properties: { Name: "X", Description: "d", Fields: [] } }));
    const list = await repo.list(projectId, "Table");
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe("Table");
  });

  it("update position ve properties replace eder", async () => {
    await repo.create(nodeFixture());
    await repo.update(projectId, "550e8400-e29b-41d4-a716-446655440000", {
      positionX: 999,
      positionY: 888,
      properties: { TableName: "renamed", Description: "x", Columns: [], Indexes: [] },
      updatedAt: "2026-05-21T11:00:00.000Z",
    });
    const got = await repo.getById(projectId, "550e8400-e29b-41d4-a716-446655440000");
    expect(got?.positionX).toBe(999);
    expect(got?.properties.TableName).toBe("renamed");
    expect(got?.updatedAt).toBe("2026-05-21T11:00:00.000Z");
  });

  it("delete silinen node'u getById null döndürür", async () => {
    await repo.create(nodeFixture());
    await repo.delete(projectId, "550e8400-e29b-41d4-a716-446655440000");
    const got = await repo.getById(projectId, "550e8400-e29b-41d4-a716-446655440000");
    expect(got).toBeNull();
  });

  it("findByName proje içi unique check için kullanılır", async () => {
    await repo.create(nodeFixture());
    const found = await repo.findByName(projectId, "users");
    expect(found?.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    const notFound = await repo.findByName(projectId, "ghost");
    expect(notFound).toBeNull();
  });
});
```

- [ ] **Step 2: Test fail eder**

Run: `pnpm test src/nodes/nodes.repository.spec.ts`
Expected: "Cannot find module './nodes.repository'" hatası.

- [ ] **Step 3: nodes.repository.ts yaz**

```ts
import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../neo4j/neo4j.service";
import type { NodeKind } from "./schemas";

export interface StoredNode {
  id: string;
  type: NodeKind;
  projectId: string;
  positionX: number;
  positionY: number;
  createdAt: string;
  updatedAt: string;
  properties: Record<string, unknown>;
}

export interface NodeUpdate {
  positionX?: number;
  positionY?: number;
  properties?: Record<string, unknown>;
  updatedAt: string;
}

const NAME_KEYS_BY_KIND: Record<NodeKind, string> = {
  Table: "TableName",
  DTO: "Name",
  Model: "ClassName",
  Enum: "Name",
  View: "ViewName",
};

@Injectable()
export class NodesRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async create(node: StoredNode): Promise<void> {
    const cypher = `
      CREATE (n:Node:${node.type} {
        id: $id, projectId: $projectId,
        positionX: $positionX, positionY: $positionY,
        createdAt: datetime($createdAt), updatedAt: datetime($updatedAt),
        properties: $properties
      })
    `;
    await this.neo4j.run(cypher, {
      id: node.id,
      projectId: node.projectId,
      positionX: node.positionX,
      positionY: node.positionY,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      properties: JSON.stringify(node.properties),
    });
  }

  async getById(projectId: string, id: string): Promise<StoredNode | null> {
    const result = await this.neo4j.run(
      `MATCH (n:Node {id: $id, projectId: $projectId}) RETURN n, labels(n) AS labels`,
      { id, projectId },
    );
    if (result.records.length === 0) return null;
    return toStoredNode(result.records[0].get("n"), result.records[0].get("labels"));
  }

  async list(projectId: string, kind?: NodeKind): Promise<StoredNode[]> {
    const cypher = kind
      ? `MATCH (n:Node:${kind} {projectId: $projectId}) RETURN n, labels(n) AS labels`
      : `MATCH (n:Node {projectId: $projectId}) RETURN n, labels(n) AS labels`;
    const result = await this.neo4j.run(cypher, { projectId });
    return result.records.map((r) => toStoredNode(r.get("n"), r.get("labels")));
  }

  async update(projectId: string, id: string, update: NodeUpdate): Promise<StoredNode | null> {
    const partial: Record<string, unknown> = { updatedAt: update.updatedAt };
    if (update.positionX !== undefined) partial.positionX = update.positionX;
    if (update.positionY !== undefined) partial.positionY = update.positionY;
    if (update.properties !== undefined) partial.properties = JSON.stringify(update.properties);

    const result = await this.neo4j.run(
      `MATCH (n:Node {id: $id, projectId: $projectId})
       SET n += $partial, n.updatedAt = datetime($updatedAt)
       RETURN n, labels(n) AS labels`,
      { id, projectId, partial, updatedAt: update.updatedAt },
    );
    if (result.records.length === 0) return null;
    return toStoredNode(result.records[0].get("n"), result.records[0].get("labels"));
  }

  async delete(projectId: string, id: string): Promise<boolean> {
    const result = await this.neo4j.run(
      `MATCH (n:Node {id: $id, projectId: $projectId})
       WITH n
       DETACH DELETE n
       RETURN 1 AS deleted`,
      { id, projectId },
    );
    return result.records.length > 0;
  }

  async findByName(projectId: string, name: string): Promise<StoredNode | null> {
    const result = await this.neo4j.run(
      `MATCH (n:Node {projectId: $projectId})
       WHERE apoc.convert.fromJsonMap(n.properties).TableName = $name
          OR apoc.convert.fromJsonMap(n.properties).Name = $name
          OR apoc.convert.fromJsonMap(n.properties).ClassName = $name
          OR apoc.convert.fromJsonMap(n.properties).ViewName = $name
       RETURN n, labels(n) AS labels LIMIT 1`,
      { projectId, name },
    );
    if (result.records.length === 0) return null;
    return toStoredNode(result.records[0].get("n"), result.records[0].get("labels"));
  }

  findNameKey(kind: NodeKind): string {
    return NAME_KEYS_BY_KIND[kind];
  }
}

function toStoredNode(n: any, labels: string[]): StoredNode {
  const props = n.properties;
  const kind = labels.find((l: string) => l !== "Node") as NodeKind;
  return {
    id: props.id,
    type: kind,
    projectId: props.projectId,
    positionX: Number(props.positionX),
    positionY: Number(props.positionY),
    createdAt: new Date(props.createdAt).toISOString(),
    updatedAt: new Date(props.updatedAt).toISOString(),
    properties: JSON.parse(props.properties),
  };
}
```

- [ ] **Step 4: Test geçer**

Run: `pnpm test src/nodes/nodes.repository.spec.ts`
Expected: 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/nodes/nodes.repository.ts src/nodes/nodes.repository.spec.ts
git commit -m "feat(nodes): NodesRepository — Cypher CRUD + findByName

properties JSON string (Neo4j map array-of-object index'lenmediği için).
findByName APOC fromJsonMap ile *Name varyantlarını arar — service
unique-name kontrolünü kullanacak. toStoredNode ISO datetime + JSON parse."
```

---

## Task 16: NodesService — business logic + unique-name + id/timestamp defaults

**Files:**
- Create: `src/nodes/nodes.service.ts`
- Create: `src/nodes/nodes.service.spec.ts`

- [ ] **Step 1: Failing test yaz**

```ts
// src/nodes/nodes.service.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictException, NotFoundException, BadRequestException } from "@nestjs/common";
import { NodesService } from "./nodes.service";
import type { StoredNode } from "./nodes.repository";

function makeRepo(initial: StoredNode[] = []) {
  const store = new Map<string, StoredNode>(initial.map((n) => [n.id, n]));
  return {
    create: vi.fn(async (n: StoredNode) => { store.set(n.id, n); }),
    getById: vi.fn(async (_p: string, id: string) => store.get(id) ?? null),
    list: vi.fn(async (p: string, k?: string) => Array.from(store.values()).filter((n) => n.projectId === p && (!k || n.type === k))),
    update: vi.fn(async (p: string, id: string, upd: any) => {
      const existing = store.get(id);
      if (!existing) return null;
      const next = { ...existing, ...upd };
      if (upd.properties) next.properties = upd.properties;
      store.set(id, next);
      return next;
    }),
    delete: vi.fn(async (_p: string, id: string) => store.delete(id)),
    findByName: vi.fn(async (p: string, name: string) => {
      for (const n of store.values()) {
        if (n.projectId !== p) continue;
        const props = n.properties as Record<string, unknown>;
        if (props.TableName === name || props.Name === name || props.ClassName === name || props.ViewName === name) return n;
      }
      return null;
    }),
    findNameKey: vi.fn((kind: string) => kind === "Table" ? "TableName" : kind === "Model" ? "ClassName" : kind === "View" ? "ViewName" : "Name"),
  };
}

const projectId = "550e8400-e29b-41d4-a716-446655440001";
const validTable = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  type: "Table" as const,
  projectId,
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
  properties: { TableName: "users", Description: "u", Columns: [{ Name: "id", DataType: "UUID" as const, IsPrimaryKey: true, IsForeignKey: false, IsNotNull: true, IsUnique: true, AutoIncrement: false }], Indexes: [] },
};

describe("NodesService.create", () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: NodesService;

  beforeEach(() => {
    repo = makeRepo();
    service = new NodesService(repo as any);
  });

  it("URL projectId ile body projectId uyuşmuyorsa BadRequestException fırlatır", async () => {
    await expect(service.create("other-project", validTable as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("id verilmediyse server üretir", async () => {
    const { id, ...noId } = validTable;
    const result = await service.create(projectId, noId as any);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("createdAt/updatedAt verilmediyse server üretir", async () => {
    const { createdAt, updatedAt, ...rest } = validTable;
    const result = await service.create(projectId, rest as any);
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();
  });

  it("aynı id zaten varsa ERR_ID_CONFLICT", async () => {
    repo = makeRepo([{ id: validTable.id, type: "Table", projectId, positionX: 0, positionY: 0, createdAt: "x", updatedAt: "x", properties: {} }]);
    service = new NodesService(repo as any);
    await expect(service.create(projectId, validTable as any))
      .rejects.toMatchObject({ response: { code: "ERR_ID_CONFLICT" } });
  });

  it("aynı isim varsa ERR_NAME_DUPLICATE", async () => {
    repo = makeRepo([{ id: "x", type: "Table", projectId, positionX: 0, positionY: 0, createdAt: "x", updatedAt: "x", properties: { TableName: "users" } }]);
    service = new NodesService(repo as any);
    const { id, ...noId } = validTable;
    await expect(service.create(projectId, noId as any))
      .rejects.toMatchObject({ response: { code: "ERR_NAME_DUPLICATE" } });
  });
});

describe("NodesService.update", () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: NodesService;

  beforeEach(() => {
    repo = makeRepo([{ ...validTable, positionX: 0, positionY: 0 } as any]);
    service = new NodesService(repo as any);
  });

  it("yok ise NotFoundException", async () => {
    await expect(service.update(projectId, "00000000-0000-0000-0000-000000000000", { position: { x: 1, y: 1 } }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("type değiştirmeye çalışırsa ERR_KIND_IMMUTABLE", async () => {
    await expect(service.update(projectId, validTable.id, { type: "DTO" } as any))
      .rejects.toMatchObject({ response: { code: "ERR_KIND_IMMUTABLE" } });
  });

  it("position update updatedAt'i de set eder", async () => {
    const result = await service.update(projectId, validTable.id, { position: { x: 99, y: 88 } });
    expect(result.position.x).toBe(99);
    expect(result.updatedAt).not.toBe(validTable.updatedAt);
  });
});

describe("NodesService.delete", () => {
  it("yok ise NotFoundException", async () => {
    const repo = makeRepo();
    const service = new NodesService(repo as any);
    await expect(service.delete(projectId, "00000000-0000-0000-0000-000000000000"))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("var ise siler", async () => {
    const repo = makeRepo([{ ...validTable, positionX: 0, positionY: 0 } as any]);
    const service = new NodesService(repo as any);
    await expect(service.delete(projectId, validTable.id)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Test fail eder**

Run: `pnpm test src/nodes/nodes.service.spec.ts`
Expected: "Cannot find module './nodes.service'" hatası.

- [ ] **Step 3: nodes.service.ts yaz**

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Node, NodeKind } from "./schemas";
import { NodesRepository, type StoredNode } from "./nodes.repository";

type CreateInput = Omit<Node, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export interface UpdateInput {
  position?: { x: number; y: number };
  properties?: Record<string, unknown>;
  type?: NodeKind; // varsa rejected
}

@Injectable()
export class NodesService {
  constructor(private readonly repo: NodesRepository) {}

  async create(urlProjectId: string, input: CreateInput): Promise<Node> {
    if (input.projectId !== urlProjectId) {
      throw new BadRequestException({
        code: "ERR_PROJECT_MISMATCH",
        message: "URL'deki projectId ile body'deki projectId uyuşmuyor.",
      });
    }

    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;

    if (input.id) {
      const existing = await this.repo.getById(urlProjectId, input.id);
      if (existing) {
        throw new ConflictException({
          code: "ERR_ID_CONFLICT",
          message: `id '${input.id}' zaten kullanılıyor.`,
        });
      }
    }

    const nameKey = this.repo.findNameKey(input.type);
    const name = (input.properties as Record<string, unknown>)[nameKey] as string | undefined;
    if (name) {
      const collision = await this.repo.findByName(urlProjectId, name);
      if (collision) {
        throw new ConflictException({
          code: "ERR_NAME_DUPLICATE",
          message: `'${name}' adı bu projede zaten kullanılıyor.`,
        });
      }
    }

    const stored: StoredNode = {
      id,
      type: input.type,
      projectId: urlProjectId,
      positionX: input.position.x,
      positionY: input.position.y,
      createdAt,
      updatedAt,
      properties: input.properties as Record<string, unknown>,
    };
    await this.repo.create(stored);
    return this.toNode(stored);
  }

  async getById(projectId: string, id: string): Promise<Node> {
    const stored = await this.repo.getById(projectId, id);
    if (!stored) {
      throw new NotFoundException({
        code: "ERR_NODE_NOT_FOUND",
        message: `Node '${id}' bulunamadı.`,
      });
    }
    return this.toNode(stored);
  }

  async list(projectId: string, kind?: NodeKind): Promise<Node[]> {
    const stored = await this.repo.list(projectId, kind);
    return stored.map((s) => this.toNode(s));
  }

  async update(projectId: string, id: string, input: UpdateInput): Promise<Node> {
    if (input.type !== undefined) {
      throw new BadRequestException({
        code: "ERR_KIND_IMMUTABLE",
        message: "Node tipi (type) değiştirilemez.",
      });
    }
    const existing = await this.repo.getById(projectId, id);
    if (!existing) {
      throw new NotFoundException({
        code: "ERR_NODE_NOT_FOUND",
        message: `Node '${id}' bulunamadı.`,
      });
    }

    // Unique-name kontrolü (properties replace ediliyorsa)
    if (input.properties) {
      const nameKey = this.repo.findNameKey(existing.type);
      const newName = input.properties[nameKey] as string | undefined;
      const oldName = (existing.properties as Record<string, unknown>)[nameKey] as string | undefined;
      if (newName && newName !== oldName) {
        const collision = await this.repo.findByName(projectId, newName);
        if (collision && collision.id !== id) {
          throw new ConflictException({
            code: "ERR_NAME_DUPLICATE",
            message: `'${newName}' adı bu projede zaten kullanılıyor.`,
          });
        }
      }
    }

    const updatedAt = new Date().toISOString();
    const updated = await this.repo.update(projectId, id, {
      positionX: input.position?.x,
      positionY: input.position?.y,
      properties: input.properties,
      updatedAt,
    });
    if (!updated) {
      throw new NotFoundException({
        code: "ERR_NODE_NOT_FOUND",
        message: `Node '${id}' bulunamadı.`,
      });
    }
    return this.toNode(updated);
  }

  async delete(projectId: string, id: string): Promise<void> {
    const deleted = await this.repo.delete(projectId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: "ERR_NODE_NOT_FOUND",
        message: `Node '${id}' bulunamadı.`,
      });
    }
  }

  private toNode(s: StoredNode): Node {
    return {
      id: s.id,
      type: s.type,
      projectId: s.projectId,
      position: { x: s.positionX, y: s.positionY },
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      properties: s.properties,
    } as Node;
  }
}
```

- [ ] **Step 4: Test geçer**

Run: `pnpm test src/nodes/nodes.service.spec.ts`
Expected: 9 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/nodes/nodes.service.ts src/nodes/nodes.service.spec.ts
git commit -m "feat(nodes): NodesService — id/timestamp defaults + unique-name + immutability

URL/body projectId mismatch → ERR_PROJECT_MISMATCH (400).
id varsa zaten kullanılıyor mu → ERR_ID_CONFLICT (409).
*Name proje içi unique → ERR_NAME_DUPLICATE (409).
PATCH type değiştirmeye çalışırsa → ERR_KIND_IMMUTABLE (400).
Yok ise → ERR_NODE_NOT_FOUND (404)."
```

---

## Task 17: NodesController — POST endpoint

**Files:**
- Create: `src/nodes/dto/create-node.dto.ts`
- Create: `src/nodes/dto/node-response.dto.ts`
- Create: `src/nodes/nodes.controller.ts`
- Create: `src/nodes/nodes.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: create-node.dto.ts yaz**

```ts
// src/nodes/dto/create-node.dto.ts
import { z } from "zod";
import { TableNodeSchema } from "../schemas/table.schema";
import { DTONodeSchema } from "../schemas/dto.schema";
import { ModelNodeSchema } from "../schemas/model.schema";
import { EnumNodeSchema } from "../schemas/enum.schema";
import { ViewNodeSchema } from "../schemas/view.schema";

const makeCreatable = <S extends z.ZodObject<any>>(schema: S) =>
  schema.partial({ id: true, createdAt: true, updatedAt: true });

export const CreateNodeSchema = z.discriminatedUnion("type", [
  makeCreatable(TableNodeSchema as any),
  makeCreatable(DTONodeSchema as any),
  makeCreatable(ModelNodeSchema as any),
  makeCreatable(EnumNodeSchema as any),
  makeCreatable(ViewNodeSchema as any),
]);

export type CreateNodeInput = z.infer<typeof CreateNodeSchema>;
```

- [ ] **Step 2: node-response.dto.ts yaz**

```ts
// src/nodes/dto/node-response.dto.ts
import type { Node } from "../schemas";
import type { SuccessEnvelope } from "../../common/envelope";

export type NodeResponse = SuccessEnvelope<Node>;
export type NodeListResponse = SuccessEnvelope<{ nodes: Node[]; total: number }>;
```

- [ ] **Step 3: Controller POST için failing e2e test yaz**

```ts
// src/nodes/nodes.controller.spec.ts (controller-level unit test; e2e ayrıca Task 20'de)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NodesController } from "./nodes.controller";
import { NodesService } from "./nodes.service";

const projectId = "550e8400-e29b-41d4-a716-446655440001";
const validTablePayload = {
  type: "Table",
  projectId,
  position: { x: 0, y: 0 },
  properties: {
    TableName: "users",
    Description: "u",
    Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsForeignKey: false, IsNotNull: true, IsUnique: true, AutoIncrement: false }],
    Indexes: [],
  },
};

describe("NodesController.create", () => {
  let service: { create: ReturnType<typeof vi.fn> };
  let controller: NodesController;

  beforeEach(() => {
    service = { create: vi.fn(async (_p, input) => ({ ...input, id: "x", createdAt: "t", updatedAt: "t" })) };
    controller = new NodesController(service as unknown as NodesService);
  });

  it("service.create'i URL projectId ile çağırır ve envelope döner", async () => {
    const result = await controller.create(projectId, validTablePayload as any);
    expect(service.create).toHaveBeenCalledWith(projectId, validTablePayload);
    expect(result.success).toBe(true);
    expect(result.data.id).toBe("x");
  });
});
```

- [ ] **Step 4: nodes.controller.ts yaz (POST sadece şimdilik)**

```ts
import { Body, Controller, HttpCode, Param, Post, UsePipes } from "@nestjs/common";
import { NodesService } from "./nodes.service";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CreateNodeSchema, type CreateNodeInput } from "./dto/create-node.dto";
import { ok } from "../common/envelope";
import type { NodeResponse } from "./dto/node-response.dto";

@Controller("projects/:projectId/nodes")
export class NodesController {
  constructor(private readonly service: NodesService) {}

  @Post()
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(CreateNodeSchema))
  async create(
    @Param("projectId") projectId: string,
    @Body() body: CreateNodeInput,
  ): Promise<NodeResponse> {
    const created = await this.service.create(projectId, body as any);
    return ok(created);
  }
}
```

- [ ] **Step 5: nodes.module.ts yaz**

```ts
import { Module } from "@nestjs/common";
import { NodesController } from "./nodes.controller";
import { NodesService } from "./nodes.service";
import { NodesRepository } from "./nodes.repository";

@Module({
  controllers: [NodesController],
  providers: [NodesService, NodesRepository],
})
export class NodesModule {}
```

- [ ] **Step 6: app.module.ts güncelle**

```ts
import { Module } from "@nestjs/common";
import { Neo4jModule } from "./neo4j/neo4j.module";
import { NodesModule } from "./nodes/nodes.module";

@Module({
  imports: [Neo4jModule, NodesModule],
})
export class AppModule {}
```

- [ ] **Step 7: Controller test geçer**

Run: `pnpm test src/nodes/nodes.controller.spec.ts`
Expected: 1 test passed.

- [ ] **Step 8: Build sanity**

Run: `pnpm build`
Expected: hata yok.

- [ ] **Step 9: Commit**

```bash
git add src/nodes/dto/ src/nodes/nodes.controller.ts src/nodes/nodes.module.ts src/nodes/nodes.controller.spec.ts src/app.module.ts
git commit -m "feat(nodes): POST /api/v1/projects/:id/nodes — create endpoint

CreateNodeSchema base alanları opsiyonel (id/createdAt/updatedAt), kind +
properties + projectId zorunlu. ZodValidationPipe shema'yı uygular,
SchemaErrorFilter hataları ERR_SCHEMA_INVALID envelope'una çevirir.
201 + success envelope plans/API Spec birebir."
```

---

## Task 18: GET single + GET list

**Files:**
- Modify: `src/nodes/nodes.controller.ts`

- [ ] **Step 1: Controller test'ine GET case'leri ekle**

`src/nodes/nodes.controller.spec.ts` dosyasının `describe` bloklarının yanına ekle:

```ts
describe("NodesController.getById", () => {
  it("service.getById'i çağırır ve envelope döner", async () => {
    const service = { getById: vi.fn(async () => ({ id: "x", type: "Table" })) };
    const controller = new NodesController(service as unknown as NodesService);
    const result = await controller.getById("p", "x");
    expect(service.getById).toHaveBeenCalledWith("p", "x");
    expect(result.success).toBe(true);
  });
});

describe("NodesController.list", () => {
  it("type filter ile çağırır", async () => {
    const service = { list: vi.fn(async () => [{ id: "x", type: "Table" }]) };
    const controller = new NodesController(service as unknown as NodesService);
    const result = await controller.list("p", "Table");
    expect(service.list).toHaveBeenCalledWith("p", "Table");
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
  });

  it("type filter olmadan çağırır", async () => {
    const service = { list: vi.fn(async () => []) };
    const controller = new NodesController(service as unknown as NodesService);
    const result = await controller.list("p", undefined);
    expect(service.list).toHaveBeenCalledWith("p", undefined);
    expect(result.data.total).toBe(0);
  });
});
```

- [ ] **Step 2: Test fail eder**

Run: `pnpm test src/nodes/nodes.controller.spec.ts`
Expected: "controller.getById is not a function" hatası.

- [ ] **Step 3: nodes.controller.ts'e GET method'larını ekle**

`src/nodes/nodes.controller.ts` içeriğini şu hale getir:

```ts
import { Body, Controller, Get, HttpCode, Param, Post, Query, UsePipes } from "@nestjs/common";
import { NodesService } from "./nodes.service";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CreateNodeSchema, type CreateNodeInput } from "./dto/create-node.dto";
import { ok } from "../common/envelope";
import type { NodeResponse, NodeListResponse } from "./dto/node-response.dto";
import type { NodeKind } from "./schemas";

const KIND_VALUES: NodeKind[] = ["Table", "DTO", "Model", "Enum", "View"];

@Controller("projects/:projectId/nodes")
export class NodesController {
  constructor(private readonly service: NodesService) {}

  @Post()
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(CreateNodeSchema))
  async create(
    @Param("projectId") projectId: string,
    @Body() body: CreateNodeInput,
  ): Promise<NodeResponse> {
    const created = await this.service.create(projectId, body as any);
    return ok(created);
  }

  @Get(":nodeId")
  async getById(
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
  ): Promise<NodeResponse> {
    const node = await this.service.getById(projectId, nodeId);
    return ok(node);
  }

  @Get()
  async list(
    @Param("projectId") projectId: string,
    @Query("type") type: string | undefined,
  ): Promise<NodeListResponse> {
    const kind = type && KIND_VALUES.includes(type as NodeKind) ? (type as NodeKind) : undefined;
    const nodes = await this.service.list(projectId, kind);
    return ok({ nodes, total: nodes.length });
  }
}
```

- [ ] **Step 4: Test geçer**

Run: `pnpm test src/nodes/nodes.controller.spec.ts`
Expected: 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/nodes/nodes.controller.ts src/nodes/nodes.controller.spec.ts
git commit -m "feat(nodes): GET /nodes/:id + GET /nodes?type — list with filter

GET tek node envelope döner; yok ise NotFoundFilter ERR_NODE_NOT_FOUND.
GET list opsiyonel ?type filter, KIND_VALUES whitelist (geçersiz tip
ignore edilir, tüm node'lar döner)."
```

---

## Task 19: PATCH + DELETE

**Files:**
- Create: `src/nodes/dto/update-node.dto.ts`
- Modify: `src/nodes/nodes.controller.ts`

- [ ] **Step 1: update-node.dto.ts yaz**

```ts
// src/nodes/dto/update-node.dto.ts
import { z } from "zod";
import { PositionSchema } from "../schemas/base.schema";

export const UpdateNodeSchema = z.object({
  position: PositionSchema.optional(),
  properties: z.record(z.unknown()).optional(),
  // type yasak — Zod tarafında bilinmeyen alan; ama açık reject için izleriz
  type: z.never().optional(),
}).strict();

export type UpdateNodeInput = z.infer<typeof UpdateNodeSchema>;
```

- [ ] **Step 2: Controller PATCH+DELETE test'leri ekle**

`src/nodes/nodes.controller.spec.ts`'e ekle:

```ts
describe("NodesController.update", () => {
  it("position update", async () => {
    const service = { update: vi.fn(async () => ({ id: "x", type: "Table" })) };
    const controller = new NodesController(service as unknown as NodesService);
    const result = await controller.update("p", "x", { position: { x: 1, y: 2 } } as any);
    expect(service.update).toHaveBeenCalledWith("p", "x", { position: { x: 1, y: 2 } });
    expect(result.success).toBe(true);
  });
});

describe("NodesController.delete", () => {
  it("service.delete'i çağırır", async () => {
    const service = { delete: vi.fn(async () => undefined) };
    const controller = new NodesController(service as unknown as NodesService);
    await controller.delete("p", "x");
    expect(service.delete).toHaveBeenCalledWith("p", "x");
  });
});
```

- [ ] **Step 3: Test fail eder**

Run: `pnpm test src/nodes/nodes.controller.spec.ts`
Expected: "controller.update is not a function" hatası.

- [ ] **Step 4: nodes.controller.ts'e PATCH+DELETE ekle**

`src/nodes/nodes.controller.ts` içeriğini şu hale getir:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UsePipes } from "@nestjs/common";
import { NodesService } from "./nodes.service";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CreateNodeSchema, type CreateNodeInput } from "./dto/create-node.dto";
import { UpdateNodeSchema, type UpdateNodeInput } from "./dto/update-node.dto";
import { ok } from "../common/envelope";
import type { NodeResponse, NodeListResponse } from "./dto/node-response.dto";
import type { NodeKind } from "./schemas";

const KIND_VALUES: NodeKind[] = ["Table", "DTO", "Model", "Enum", "View"];

@Controller("projects/:projectId/nodes")
export class NodesController {
  constructor(private readonly service: NodesService) {}

  @Post()
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(CreateNodeSchema))
  async create(
    @Param("projectId") projectId: string,
    @Body() body: CreateNodeInput,
  ): Promise<NodeResponse> {
    const created = await this.service.create(projectId, body as any);
    return ok(created);
  }

  @Get(":nodeId")
  async getById(
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
  ): Promise<NodeResponse> {
    const node = await this.service.getById(projectId, nodeId);
    return ok(node);
  }

  @Get()
  async list(
    @Param("projectId") projectId: string,
    @Query("type") type: string | undefined,
  ): Promise<NodeListResponse> {
    const kind = type && KIND_VALUES.includes(type as NodeKind) ? (type as NodeKind) : undefined;
    const nodes = await this.service.list(projectId, kind);
    return ok({ nodes, total: nodes.length });
  }

  @Patch(":nodeId")
  @UsePipes(new ZodValidationPipe(UpdateNodeSchema))
  async update(
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: UpdateNodeInput,
  ): Promise<NodeResponse> {
    const updated = await this.service.update(projectId, nodeId, body as any);
    return ok(updated);
  }

  @Delete(":nodeId")
  @HttpCode(204)
  async delete(
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
  ): Promise<void> {
    await this.service.delete(projectId, nodeId);
  }
}
```

- [ ] **Step 5: Test geçer**

Run: `pnpm test src/nodes/nodes.controller.spec.ts`
Expected: 5 tests passed (önceki 3 + yeni 2).

- [ ] **Step 6: Tüm src/ testleri geçiyor mu**

Run: `pnpm test`
Expected: tüm testler geçer.

- [ ] **Step 7: Commit**

```bash
git add src/nodes/dto/update-node.dto.ts src/nodes/nodes.controller.ts src/nodes/nodes.controller.spec.ts
git commit -m "feat(nodes): PATCH + DELETE endpoint'leri — field-level replace

PATCH body'sinde position ve/veya properties opsiyonel; type field'ı
z.never() ile reddedilir (ERR_KIND_IMMUTABLE service tarafında).
DELETE 204 idempotent."
```

---

# Sprint 5 — E2E ve Polish

## Task 20: E2E test — 5 kind tam CRUD round-trip + error paths

**Files:**
- Create: `vitest.e2e.config.ts`
- Create: `test/nodes.e2e-spec.ts`

- [ ] **Step 1: vitest.e2e.config.ts yaz**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["test/**/*.e2e-spec.ts"],
    environment: "node",
    globals: false,
    testTimeout: 180_000, // Testcontainers ilk image pull için
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 2: E2E test yaz**

```ts
// test/nodes.e2e-spec.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { NodesModule } from "../src/nodes/nodes.module";
import { Neo4jModule } from "../src/neo4j/neo4j.module";
import { Neo4jService } from "../src/neo4j/neo4j.service";
import { SchemaErrorFilter } from "../src/common/filters/schema-error.filter";
import { NotFoundFilter } from "../src/common/filters/not-found.filter";
import { ConflictFilter } from "../src/common/filters/conflict.filter";
import { InternalFilter } from "../src/common/filters/internal.filter";

const projectId = "550e8400-e29b-41d4-a716-446655440001";

describe("Nodes E2E", () => {
  let container: StartedNeo4jContainer;
  let app: INestApplication;
  let neo4j: Neo4jService;

  beforeAll(async () => {
    container = await new Neo4jContainer("neo4j:5-community").withApoc().start();

    // Env'i container'a göre set et
    process.env.NEO4J_URI = container.getBoltUri();
    process.env.NEO4J_USER = container.getUsername();
    process.env.NEO4J_PASSWORD = container.getPassword();
    process.env.PORT = "0";
    process.env.CORS_ORIGIN = "http://localhost:3000";

    const moduleRef = await Test.createTestingModule({
      imports: [Neo4jModule, NodesModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(
      new InternalFilter(),
      new ConflictFilter(),
      new NotFoundFilter(),
      new SchemaErrorFilter(),
    );
    await app.init();

    neo4j = app.get(Neo4jService);
    await neo4j.run("CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE");
    await neo4j.run("CREATE INDEX node_project_idx IF NOT EXISTS FOR (n:Node) ON (n.projectId)");
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  beforeEach(async () => {
    await neo4j.run("MATCH (n:Node) DETACH DELETE n");
  });

  const fixtures = {
    Table: {
      type: "Table" as const,
      projectId,
      position: { x: 0, y: 0 },
      properties: {
        TableName: "users",
        Description: "u",
        Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsForeignKey: false, IsNotNull: true, IsUnique: true, AutoIncrement: false }],
        Indexes: [],
      },
    },
    DTO: {
      type: "DTO" as const,
      projectId,
      position: { x: 0, y: 0 },
      properties: {
        Name: "CreateUserDTO",
        Description: "d",
        Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false }],
      },
    },
    Model: {
      type: "Model" as const,
      projectId,
      position: { x: 0, y: 0 },
      properties: {
        ClassName: "User",
        Description: "m",
        Properties: [{ Name: "id", Type: "UUID" }],
        Methods: [],
      },
    },
    Enum: {
      type: "Enum" as const,
      projectId,
      position: { x: 0, y: 0 },
      properties: { Name: "OrderStatus", Description: "e", Values: ["PENDING", "SHIPPED"] },
    },
    View: {
      type: "View" as const,
      projectId,
      position: { x: 0, y: 0 },
      properties: { ViewName: "active_users", Description: "v", Definition: "SELECT 1", SourceTables: ["users"], Materialized: false },
    },
  };

  for (const [kind, payload] of Object.entries(fixtures)) {
    it(`${kind}: full CRUD round-trip`, async () => {
      // POST
      const created = await request(app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/nodes`)
        .send(payload)
        .expect(201);
      expect(created.body.success).toBe(true);
      const id = created.body.data.id;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      // GET single
      const got = await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/nodes/${id}`)
        .expect(200);
      expect(got.body.data.type).toBe(kind);

      // GET list ?type=
      const listed = await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/nodes?type=${kind}`)
        .expect(200);
      expect(listed.body.data.total).toBe(1);

      // PATCH position
      const patched = await request(app.getHttpServer())
        .patch(`/api/v1/projects/${projectId}/nodes/${id}`)
        .send({ position: { x: 999, y: 888 } })
        .expect(200);
      expect(patched.body.data.position).toEqual({ x: 999, y: 888 });

      // DELETE
      await request(app.getHttpServer())
        .delete(`/api/v1/projects/${projectId}/nodes/${id}`)
        .expect(204);

      // GET → 404
      const notFound = await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/nodes/${id}`)
        .expect(404);
      expect(notFound.body.error.code).toBe("ERR_NODE_NOT_FOUND");
    });
  }

  it("ERR_SCHEMA_INVALID — Description eksik", async () => {
    const payload = JSON.parse(JSON.stringify(fixtures.Table));
    delete payload.properties.Description;
    const res = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/nodes`)
      .send(payload)
      .expect(400);
    expect(res.body.error.code).toBe("ERR_SCHEMA_INVALID");
    expect(res.body.error.details).toBeDefined();
  });

  it("ERR_PROJECT_MISMATCH — URL ile body uyuşmuyor", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/projects/different-project/nodes`)
      .send(fixtures.Table)
      .expect(400);
    expect(res.body.error.code).toBe("ERR_PROJECT_MISMATCH");
  });

  it("ERR_NAME_DUPLICATE — aynı TableName ikinci kez", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/nodes`)
      .send(fixtures.Table)
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/nodes`)
      .send(fixtures.Table)
      .expect(409);
    expect(res.body.error.code).toBe("ERR_NAME_DUPLICATE");
  });

  it("ERR_KIND_IMMUTABLE — PATCH type değiştirmeye çalışırsa", async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/nodes`)
      .send(fixtures.Table);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}/nodes/${created.body.data.id}`)
      .send({ type: "DTO" })
      .expect(400);
    expect(["ERR_KIND_IMMUTABLE", "ERR_SCHEMA_INVALID"]).toContain(res.body.error.code);
  });
});
```

- [ ] **Step 3: E2E test'i çalıştır**

Run: `pnpm test:e2e`
Expected: 9 tests passed (5 kind × CRUD + 4 error path). İlk run ~2-3 dakika (Docker image pull).

- [ ] **Step 4: Commit**

```bash
git add vitest.e2e.config.ts test/nodes.e2e-spec.ts
git commit -m "test(e2e): 5 kind CRUD round-trip + 4 error path

Testcontainers Neo4j + supertest. Her kind: POST 201 → GET 200 →
GET list ?type filter → PATCH 200 → DELETE 204 → GET 404. Error path'lar:
ERR_SCHEMA_INVALID, ERR_PROJECT_MISMATCH, ERR_NAME_DUPLICATE,
ERR_KIND_IMMUTABLE."
```

---

## Task 21: Health endpoint + README update

**Files:**
- Create: `src/health/health.controller.ts`
- Create: `src/health/health.controller.spec.ts`
- Modify: `src/app.module.ts`
- Modify: `README.md`

- [ ] **Step 1: Health test yaz**

```ts
// src/health/health.controller.spec.ts
import { describe, it, expect } from "vitest";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("status: ok döner", () => {
    const controller = new HealthController();
    const result = controller.check();
    expect(result.success).toBe(true);
    expect(result.data.status).toBe("ok");
    expect(typeof result.data.uptime).toBe("number");
  });
});
```

- [ ] **Step 2: Test fail eder**

Run: `pnpm test src/health/health.controller.spec.ts`
Expected: "Cannot find module './health.controller'" hatası.

- [ ] **Step 3: health.controller.ts yaz**

```ts
import { Controller, Get } from "@nestjs/common";
import { ok } from "../common/envelope";

@Controller("health")
export class HealthController {
  @Get()
  check() {
    return ok({ status: "ok", uptime: process.uptime() });
  }
}
```

- [ ] **Step 4: app.module.ts güncelle**

```ts
import { Module } from "@nestjs/common";
import { Neo4jModule } from "./neo4j/neo4j.module";
import { NodesModule } from "./nodes/nodes.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [Neo4jModule, NodesModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 5: Test geçer**

Run: `pnpm test src/health/health.controller.spec.ts`
Expected: 1 test passed.

- [ ] **Step 6: README'yi son haliyle güncelle**

`README.md` içeriğini şu hale getir:

```markdown
# solarch-backend

Solarch'ın mimari graf backend'i. Solarch core (`Solarch/`) repo'sundan
**bağımsız** olarak geliştirilir. Sadece Node CRUD + şema doğrulamayla
başlar; Edge, Rules Engine, AI batch ve kod üretim motoru sonraki fazlara
bırakılmıştır.

## Stack

- **NestJS 11** — modüler yapı, DI, decorator disiplini
- **Zod 3** — discriminated union + JSON Schema export
- **Neo4j 5** (community) — graph DB; ileride Rules Engine için bedava
  graph traversal
- **TypeScript 5** + **pnpm 10** + **Vitest 2** + **Testcontainers**

## Phase 1 — Node CRUD (bu repo'nun şu anki kapsamı)

Sadece **Veri ailesi** node tipleri:

- `Table`, `DTO`, `Model`, `Enum`, `View`

API yüzeyi (5 endpoint):

| Method | Path |
|---|---|
| POST | `/api/v1/projects/:projectId/nodes` |
| GET | `/api/v1/projects/:projectId/nodes` (`?type=Table` opsiyonel) |
| GET | `/api/v1/projects/:projectId/nodes/:nodeId` |
| PATCH | `/api/v1/projects/:projectId/nodes/:nodeId` |
| DELETE | `/api/v1/projects/:projectId/nodes/:nodeId` |
| GET | `/api/v1/health` |

Tam tasarım: [`docs/specs/2026-05-21-node-types-design.md`](docs/specs/2026-05-21-node-types-design.md)
Implementation planı: [`docs/plans/2026-05-21-node-types-implementation.md`](docs/plans/2026-05-21-node-types-implementation.md)

## Geliştirme

```bash
# 1. Bağımlılıklar
pnpm install

# 2. Neo4j'i ayağa kaldır
pnpm neo4j:up

# 3. Constraints + index
cp .env.example .env
pnpm neo4j:migrate

# 4. Dev server
pnpm dev          # http://localhost:4000/api/v1

# 5. Testler
pnpm test         # unit
pnpm test:e2e     # e2e (Testcontainers — ilk run ~2dk)
```

## Yol haritası

| Faz | Kapsam | Durum |
|---|---|---|
| 1 | Node CRUD + Veri ailesi (5 tip) | ✅ tamamlandı |
| 1.5 | Diğer node aileleri (İş/Erişim/Altyapı/İstemci/Güvenlik/Yapı) | ⏳ |
| 2 | Edge CRUD + Rules Engine (whitelist/blacklist) | ⏳ |
| 2.5 | Conditional rules (circular dep, encapsulation, type mismatch) | ⏳ |
| 3 | AI batch apply (`/graph/apply`) + LangGraph agent loop | ⏳ |
| 4 | Vector DB + GraphRAG ("Chat with Architecture") | ⏳ |
| 5 | Kod üretim motoru (AST scaffold + cerrahi AI) | ⏳ |

## Yeni Node Tipi Ekleme

Üç adım (kuralın kendisi — `docs/specs/...` Section 6):

1. `src/nodes/schemas/<kind>.schema.ts` — `BaseNodeSchema.extend({ type: z.literal("Foo"), properties: z.object({...}).strict() }).strict()`
2. `src/nodes/schemas/index.ts` — `NodeSchema` discriminated union'una eklenir + `KIND_LABELS` haritası güncellenir
3. `src/nodes/schemas/<kind>.schema.spec.ts` — valid + invalid payload örnekleri

Union'a girmeyen tip TS compile + Zod runtime'da reddedilir.

## Lisans

Henüz lisanslanmadı.
```

- [ ] **Step 7: Tüm test paketi yeşil mi**

Run: `pnpm test && pnpm test:e2e`
Expected: tüm testler geçer.

- [ ] **Step 8: Build sanity**

Run: `pnpm build`
Expected: hata yok.

- [ ] **Step 9: Commit**

```bash
git add src/health/ src/app.module.ts README.md
git commit -m "feat(health): GET /api/v1/health + README update

Health endpoint uptime ile basit envelope döner. README'de Phase 1 ✅,
geliştirme komutları, yeni node tipi ekleme adımları net olarak güncel."
```

- [ ] **Step 10: Push**

```bash
git push origin main
```
Expected: tüm yeni commit'ler origin/main'e gider.

---

## Phase 1 Çıkış Kriterleri Doğrulama

Spec Section 12 ile karşılaştır:

- [x] **1.** `solarch-backend` repo'su initialize edilmiş — Task 0 (zaten)
- [x] **2.** NestJS app boot ediyor, `/api/v1/health` 200 dönüyor — Task 1, 21
- [x] **3.** Docker Compose ile Neo4j ayağa kalkıyor — Task 3
- [x] **4.** Migration script `node_id_unique` + `node_project_idx` kuruyor — Task 5
- [x] **5.** 5 Veri ailesi node tipi için tam CRUD endpoint'leri çalışıyor — Task 6-11 (schemas) + 15-19 (CRUD)
- [x] **6.** Tüm endpoint'ler plans/API Spec response envelope formatına uyuyor — Task 12-14 (envelope/filters)
- [x] **7.** Unit + E2E testler geçiyor — Task 20
- [x] **8.** README + `.env.example` + `docker-compose.yml` mevcut — Task 21, 3

---

## Notlar

- **Test sırası önemli:** Sprint 5 (E2E) önce gelmeli ki sonradan ortaya çıkan envelope farklılıkları yakalanabilsin. Sprint 1-4 unit testlere güvenir; E2E mock'lanamayan integration regressionlar için.
- **APOC bağımlılığı:** `findByName` `apoc.convert.fromJsonMap` kullanıyor. Phase 2'de properties struct'a açıldığında APOC'a ihtiyaç kalkar.
- **Testcontainers ilk run:** İlk Neo4j image pull 1-2 dakika. CI'da image'ı cache'lemek isteriz (sonraki sprint).
- **Hot reload:** `pnpm dev` watch mode. `.env` değişirse yeniden başlat.
- **Lock dosyası:** `pnpm-lock.yaml` her commit'te commit edilmeli (deterministik install).
