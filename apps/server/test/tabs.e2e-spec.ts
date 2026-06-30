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
import { SchemaErrorFilter } from "../src/common/filters/schema-error.filter";
import { NotFoundFilter } from "../src/common/filters/not-found.filter";
import { ConflictFilter } from "../src/common/filters/conflict.filter";
import { InternalFilter } from "../src/common/filters/internal.filter";
import { bypassAuth } from "./test-auth";

describe("Tabs E2E", () => {
  let container: StartedNeo4jContainer;
  let app: INestApplication;
  let neo4j: Neo4jService;
  const base = "/api/v1";
  let projectId: string;
  let nodeId: string;

  beforeAll(async () => {
    container = await new Neo4jContainer("neo4j:5-community").withApoc().start();
    neo4j = new Neo4jService({
      uri: container.getBoltUri(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await neo4j.onModuleInit();
    await neo4j.run("CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE");
    await neo4j.run("CREATE CONSTRAINT tab_id_unique IF NOT EXISTS FOR (t:Tab) REQUIRE t.id IS UNIQUE");

    const moduleRef = await bypassAuth(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(Neo4jService).useValue(neo4j),
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

  it("proje açılınca Ana Mimari sekmesi oluşur", async () => {
    const p = await request(app.getHttpServer()).post(`${base}/projects`).send({ name: "Tab E2E" }).expect(201);
    projectId = p.body.data.id;
    const tabs = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs`).expect(200);
    expect(tabs.body.data).toHaveLength(1);
    expect(tabs.body.data[0].isDefault).toBe(true);
    expect(tabs.body.data[0].name).toBe("Main Architecture");
  });

  it("node default sekmeye ev sahibi olur, tab graph'ta owned görünür", async () => {
    const n = await request(app.getHttpServer()).post(`${base}/projects/${projectId}/nodes`).send({
      projectId, position: { x: 10, y: 20 }, type: "Service",
      properties: { ServiceName: "OrderSvc", Description: "d", IsTransactionScoped: false, Methods: [{ MethodName: "x", ReturnType: "void" }] },
    }).expect(201);
    nodeId = n.body.data.id;
    const tabs = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs`).expect(200);
    const defId = tabs.body.data[0].id;
    const g = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs/${defId}/graph`).expect(200);
    expect(g.body.data.nodes).toHaveLength(1);
    expect(g.body.data.nodes[0].isReference).toBe(false);
    expect(g.body.data.nodes[0].position).toEqual({ x: 10, y: 20 });
  });

  it("yeni sekme + node import (referans) round-trip", async () => {
    const t = await request(app.getHttpServer()).post(`${base}/projects/${projectId}/tabs`).send({ name: "Sipariş" }).expect(201);
    const tabId = t.body.data.id;
    await request(app.getHttpServer()).put(`${base}/projects/${projectId}/tabs/${tabId}/references/${nodeId}`).send({ x: 99, y: 88 }).expect(200);
    const g = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs/${tabId}/graph`).expect(200);
    expect(g.body.data.nodes).toHaveLength(1);
    expect(g.body.data.nodes[0].isReference).toBe(true);
    expect(g.body.data.nodes[0].position).toEqual({ x: 99, y: 88 });
    await request(app.getHttpServer()).delete(`${base}/projects/${projectId}/tabs/${tabId}/references/${nodeId}`).expect(204);
    const g2 = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs/${tabId}/graph`).expect(200);
    expect(g2.body.data.nodes).toHaveLength(0);
  });

  it("node kendi ev sekmesine referans edilemez (400)", async () => {
    const tabs = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs`).expect(200);
    const defId = tabs.body.data.find((t: any) => t.isDefault).id;
    await request(app.getHttpServer()).put(`${base}/projects/${projectId}/tabs/${defId}/references/${nodeId}`).send({ x: 1, y: 1 }).expect(400);
  });

  it("default sekme silinemez (400)", async () => {
    const tabs = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs`).expect(200);
    const defId = tabs.body.data.find((t: any) => t.isDefault).id;
    await request(app.getHttpServer()).delete(`${base}/projects/${projectId}/tabs/${defId}`).expect(400);
  });

  it("sekme silinince owned node Ana Mimari'ye taşınır, node kaybolmaz", async () => {
    const t = await request(app.getHttpServer()).post(`${base}/projects/${projectId}/tabs`).send({ name: "Geçici" }).expect(201);
    const tabId = t.body.data.id;
    const n = await request(app.getHttpServer()).post(`${base}/projects/${projectId}/nodes`).send({
      projectId, position: { x: 1, y: 1 }, homeTabId: tabId, type: "Cache",
      properties: { CacheName: "C", Description: "d", KeyPattern: "k", TTL_Seconds: 60, Engine: "Redis" },
    }).expect(201);
    await request(app.getHttpServer()).delete(`${base}/projects/${projectId}/tabs/${tabId}`).expect(204);
    await request(app.getHttpServer()).get(`${base}/projects/${projectId}/nodes/${n.body.data.id}`).expect(200);
  });
});
