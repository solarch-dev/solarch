import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ZodValidationPipe as ZodPipe } from "nestjs-zod";
import express from "express";
import request from "supertest";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { AppModule } from "../src/app.module";
import { Neo4jService } from "../src/neo4j/neo4j.service";
import { SchemaErrorFilter } from "../src/common/filters/schema-error.filter";
import { NotFoundFilter } from "../src/common/filters/not-found.filter";
import { ConflictFilter } from "../src/common/filters/conflict.filter";
import { InternalFilter } from "../src/common/filters/internal.filter";
import { bypassAuth } from "./test-auth";

const projectId = "550e8400-e29b-41d4-a716-4466554400ed";

describe("Edges E2E (apoc.merge dedup)", () => {
  let container: StartedNeo4jContainer;
  let app: INestApplication;
  let neo4j: Neo4jService;

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
    await neo4j.run(
      `CREATE (p:Project {id: $id, name: 'E2E Edges', description: 'test', status: 'draft', createdAt: datetime(), updatedAt: datetime()})`,
      { id: projectId },
    );

    const moduleRef = await bypassAuth(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(Neo4jService)
        .useValue(neo4j),
    ).compile();

    app = moduleRef.createNestApplication();
    app.use(express.json());
    app.useGlobalPipes(new ZodPipe());
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new InternalFilter(), new ConflictFilter(), new NotFoundFilter(), new SchemaErrorFilter());
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await neo4j.onModuleDestroy();
    await container.stop();
  });

  beforeEach(async () => {
    await neo4j.run("MATCH (n:Node) DETACH DELETE n");
  });

  async function createNode(payload: object): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/nodes`)
      .send(payload)
      .expect(201);
    return res.body.data.id;
  }

  const modelPayload = {
    type: "Model", projectId, position: { x: 0, y: 0 },
    properties: { ClassName: "User", Description: "m", Properties: [{ Name: "status", Type: "OrderStatus" }], Methods: [] },
  };
  const enumPayload = {
    type: "Enum", projectId, position: { x: 0, y: 0 },
    properties: { Name: "OrderStatus", Description: "e", BackingType: "string", Values: [{ Key: "PENDING" }] },
  };

  it("Model -USES-> Enum: create (apoc.merge) + round-trip", async () => {
    const src = await createNode(modelPayload);
    const tgt = await createNode(enumPayload);

    const created = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/edges`)
      .send({ projectId, sourceNodeId: src, targetNodeId: tgt, kind: "USES", properties: { IsAsync: false } })
      .expect(201);
    expect(created.body.success).toBe(true);
    const edgeId = created.body.data.id;
    expect(edgeId).toMatch(/^[0-9a-f-]{36}$/);

    const got = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/edges/${edgeId}`)
      .expect(200);
    expect(got.body.data.kind).toBe("USES");
    expect(got.body.data.sourceNodeId).toBe(src);
    expect(got.body.data.targetNodeId).toBe(tgt);
  });

  it("aynı (source,target,kind) ikinci kez → 409, çift edge oluşmaz", async () => {
    const src = await createNode(modelPayload);
    const tgt = await createNode(enumPayload);
    const body = { projectId, sourceNodeId: src, targetNodeId: tgt, kind: "USES", properties: { IsAsync: false } };

    await request(app.getHttpServer()).post(`/api/v1/projects/${projectId}/edges`).send(body).expect(201);
    const dup = await request(app.getHttpServer()).post(`/api/v1/projects/${projectId}/edges`).send(body).expect(409);
    expect(dup.body.error.code).toBe("ERR_EDGE_DUPLICATE");

    const list = await request(app.getHttpServer()).get(`/api/v1/projects/${projectId}/edges`).expect(200);
    expect(list.body.data.total).toBe(1); // MERGE → tek edge

    // DB seviyesinde de tek ilişki olduğunu doğrula
    const rels = await neo4j.run("MATCH ()-[r:USES]->() RETURN count(r) AS c");
    expect(Number(rels.records[0].get("c"))).toBe(1);
  });

  it("self-loop → 400 ERR_EDGE_SELF_LOOP", async () => {
    const src = await createNode(modelPayload);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/edges`)
      .send({ projectId, sourceNodeId: src, targetNodeId: src, kind: "USES", properties: { IsAsync: false } })
      .expect(400);
    expect(res.body.error.code).toBe("ERR_EDGE_SELF_LOOP");
  });
});
