import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ZodValidationPipe as ZodPipe } from "nestjs-zod";
import express from "express";
import request from "supertest";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { AppModule } from "../src/app.module";
import { Neo4jService } from "../src/neo4j/neo4j.service";
import { EMBEDDINGS } from "../src/embeddings/embeddings.types";
import { PatternsService } from "../src/patterns/patterns.service";
import { env } from "../src/config/env";
import { SchemaErrorFilter } from "../src/common/filters/schema-error.filter";
import { NotFoundFilter } from "../src/common/filters/not-found.filter";
import { ConflictFilter } from "../src/common/filters/conflict.filter";
import { InternalFilter } from "../src/common/filters/internal.filter";
import { bypassAuth } from "./test-auth";

// Deterministik fake embedder — gerçek model indirmeden vektör index'i test eder.
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

/* Patterns kütüphanesi YALNIZ-OKUMA + seed-scoped (BOLA fix). Yazma uçları
 * (create/delete/promote) kaldırıldı; seed'leme service ile yapılır. Bu e2e:
 * (1) seed pattern okuma round-trip, (2) GÜVENLİK: 'promoted' kaynaklı pattern
 * hiçbir okuma yolundan (list/search) dönmez. */
describe("Patterns E2E (yalnız-okuma, seed-scoped)", () => {
  let container: StartedNeo4jContainer;
  let app: INestApplication;
  let neo4j: Neo4jService;
  let service: PatternsService;
  const base = "/api/v1";

  const graph = {
    nodes: [{ tempId: "t_ctrl", type: "Controller", properties: { ControllerName: "X", Description: "d", BaseRoute: "/x", Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false }] } }],
    edges: [],
  };

  beforeAll(async () => {
    container = await new Neo4jContainer("neo4j:5-community").withApoc().start();
    neo4j = new Neo4jService({ uri: container.getBoltUri(), user: container.getUsername(), password: container.getPassword() });
    await neo4j.onModuleInit();
    await neo4j.run(
      `CREATE VECTOR INDEX pattern_embedding IF NOT EXISTS
       FOR (p:Pattern) ON (p.embedding)
       OPTIONS { indexConfig: { \`vector.dimensions\`: ${env.EMBED_DIM}, \`vector.similarity_function\`: 'cosine' } }`,
    );

    const moduleRef = await bypassAuth(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(Neo4jService).useValue(neo4j)
        .overrideProvider(EMBEDDINGS).useValue(fakeEmbeddings),
    ).compile();

    service = moduleRef.get(PatternsService);
    app = moduleRef.createNestApplication();
    app.use(express.json());
    app.useGlobalPipes(new ZodPipe());
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new InternalFilter(), new ConflictFilter(), new NotFoundFilter(), new SchemaErrorFilter());
    await app.init();
    await neo4j.run(`MATCH (p:Pattern) DELETE p`);
  }, 180_000);

  afterAll(async () => {
    await neo4j.run(`MATCH (p:Pattern) DELETE p`);
    await app.close();
    await neo4j.onModuleDestroy();
    await container.stop();
  });

  it("seed pattern → list + getById + search round-trip", async () => {
    const seeded = await service.create({ name: "Auth akışı", description: "JWT login authentication", tags: ["auth"], graph } as any, "seed");
    expect(seeded.name).toBe("Auth akışı");

    const list = await request(app.getHttpServer()).get(`${base}/patterns`).expect(200);
    expect(list.body.data.some((p: { name: string }) => p.name === "Auth akışı")).toBe(true);

    const one = await request(app.getHttpServer()).get(`${base}/patterns/${seeded.id}`).expect(200);
    expect(one.body.data.name).toBe("Auth akışı");

    await new Promise((r) => setTimeout(r, 1500)); // vektör index eventual
    const search = await request(app.getHttpServer())
      .post(`${base}/patterns/search`).send({ query: "JWT login authentication", k: 5, minScore: 0 }).expect(200);
    expect(search.body.data.length).toBeGreaterThanOrEqual(1);
    expect(search.body.data[0].pattern.name).toBe("Auth akışı");
  });

  it("getById olmayan → 404", async () => {
    await request(app.getHttpServer()).get(`${base}/patterns/00000000-0000-0000-0000-000000000000`).expect(404);
  });

  it("GÜVENLİK: 'promoted' pattern okuma yollarından (list/getById/search) DÖNMEZ", async () => {
    const desc = "GIZLI promoted kiracı mimarisi sensitive";
    const id = "11111111-2222-4333-8444-555555555555";
    await neo4j.run(
      `CREATE (p:Pattern { id:$id, name:'Gizli Promoted', description:$desc, tags:[], graphJson:'{"nodes":[],"edges":[]}', source:'promoted', createdAt: datetime(), embedding:$emb })`,
      { id, desc, emb: fakeVec(desc) },
    );
    await new Promise((r) => setTimeout(r, 1500));

    const list = await request(app.getHttpServer()).get(`${base}/patterns`).expect(200);
    expect(list.body.data.some((p: { name: string }) => p.name === "Gizli Promoted")).toBe(false);

    await request(app.getHttpServer()).get(`${base}/patterns/${id}`).expect(404);

    const search = await request(app.getHttpServer())
      .post(`${base}/patterns/search`).send({ query: desc, k: 10, minScore: 0 }).expect(200);
    expect(search.body.data.some((h: { pattern: { name: string } }) => h.pattern.name === "Gizli Promoted")).toBe(false);
  });
});
