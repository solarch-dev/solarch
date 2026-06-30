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

const projectId = "550e8400-e29b-41d4-a716-446655440001";

describe("Nodes E2E", () => {
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
    // Strict referential integrity — node create için project var olmalı
    await neo4j.run(
      `CREATE (p:Project {id: $id, name: 'E2E Test', description: 'test', status: 'draft', createdAt: datetime(), updatedAt: datetime()})`,
      { id: projectId },
    );

    const moduleRef = await bypassAuth(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(Neo4jService)
        .useValue(neo4j),
    ).compile();

    app = moduleRef.createNestApplication();
    app.use(express.json());
    app.useGlobalPipes(new ZodPipe());
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(
      new InternalFilter(),
      new ConflictFilter(),
      new NotFoundFilter(),
      new SchemaErrorFilter(),
    );
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

  const fixtures = {
    Table: {
      type: "Table" as const,
      projectId,
      position: { x: 0, y: 0 },
      properties: {
        TableName: "users",
        Description: "u",
        Columns: [
          { Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false },
          { Name: "org_id", DataType: "UUID", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
          { Name: "balance", DataType: "DECIMAL", Precision: 12, Scale: 2, IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
        ],
        ForeignKeys: [{ Columns: ["org_id"], ReferencesTable: "orgs", ReferencesColumns: ["id"], OnDelete: "CASCADE" }],
        CheckConstraints: [{ Name: "balance_nonneg", Expression: "balance >= 0" }],
        Indexes: [{ IndexName: "idx_org", Columns: ["org_id"], Type: "BTree", IsUnique: false }],
      },
    },
    DTO: {
      type: "DTO" as const,
      projectId,
      position: { x: 0, y: 0 },
      properties: {
        Name: "CreateUserDTO",
        Description: "d",
        Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "Email" }, { Rule: "MaxLength", Value: "255" }] }],
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
      properties: { Name: "OrderStatus", Description: "e", BackingType: "string", Values: [{ Key: "PENDING" }, { Key: "SHIPPED", Value: "shipped" }] },
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
      const created = await request(app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/nodes`)
        .send(payload)
        .expect(201);
      expect(created.body.success).toBe(true);
      const id = created.body.data.id;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const got = await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/nodes/${id}`)
        .expect(200);
      expect(got.body.data.type).toBe(kind);

      const listed = await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/nodes?type=${kind}`)
        .expect(200);
      expect(listed.body.data.total).toBe(1);

      const patched = await request(app.getHttpServer())
        .patch(`/api/v1/projects/${projectId}/nodes/${id}`)
        .send({ position: { x: 999, y: 888 } })
        .expect(200);
      expect(patched.body.data.position).toEqual({ x: 999, y: 888 });

      await request(app.getHttpServer())
        .delete(`/api/v1/projects/${projectId}/nodes/${id}`)
        .expect(204);

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
      .post(`/api/v1/projects/${"550e8400-e29b-41d4-a716-446655449999"}/nodes`)
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
