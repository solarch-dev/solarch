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
import { ClerkAuthGuard } from "../src/auth/clerk-auth.guard";
import { SchemaErrorFilter } from "../src/common/filters/schema-error.filter";
import { NotFoundFilter } from "../src/common/filters/not-found.filter";
import { ConflictFilter } from "../src/common/filters/conflict.filter";
import { InternalFilter } from "../src/common/filters/internal.filter";
import { UnauthorizedFilter } from "../src/common/filters/unauthorized.filter";
import { ForbiddenFilter } from "../src/common/filters/forbidden.filter";
import { headerAuthGuardValue } from "./test-auth";

/** Kimlik doğrulama + çok-kiracılık (tenancy/BOLA) e2e.
 *  ClerkAuthGuard header-stub'ı ile (x-test-user) iki kullanıcı simüle edilir;
 *  ProjectAccessGuard GERÇEK çalışır — asıl BOLA korumasını sınar. */
describe("Auth + Tenancy E2E", () => {
  let container: StartedNeo4jContainer;
  let app: INestApplication;
  let neo4j: Neo4jService;
  const base = "/api/v1";
  const USER_A = "user_A";
  const USER_B = "user_B";

  beforeAll(async () => {
    container = await new Neo4jContainer("neo4j:5-community").withApoc().start();
    neo4j = new Neo4jService({
      uri: container.getBoltUri(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await neo4j.onModuleInit();
    await neo4j.run("CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE");
    await neo4j.run("CREATE CONSTRAINT project_id_unique IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE");
    await neo4j.run("CREATE CONSTRAINT tab_id_unique IF NOT EXISTS FOR (t:Tab) REQUIRE t.id IS UNIQUE");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Neo4jService)
      .useValue(neo4j)
      .overrideProvider(ClerkAuthGuard)
      .useValue(headerAuthGuardValue())
      .compile();

    app = moduleRef.createNestApplication();
    app.use(express.json());
    app.useGlobalPipes(new ZodPipe());
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(
      new InternalFilter(),
      new UnauthorizedFilter(),
      new ForbiddenFilter(),
      new ConflictFilter(),
      new NotFoundFilter(),
      new SchemaErrorFilter(),
    );
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await neo4j?.onModuleDestroy();
    await container?.stop();
  });

  beforeEach(async () => {
    await neo4j.run("MATCH (n) DETACH DELETE n");
  });

  const createProject = (user: string, name: string) =>
    request(app.getHttpServer())
      .post(`${base}/projects`)
      .set("x-test-user", user)
      .send({ name, description: "", status: "draft" });

  it("kimlik yoksa → 401 ERR_UNAUTHORIZED", async () => {
    const res = await request(app.getHttpServer()).get(`${base}/projects`).expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("ERR_UNAUTHORIZED");
  });

  it("create projeye ownerId damgalar", async () => {
    const res = await createProject(USER_A, "A'nın projesi").expect(201);
    expect(res.body.data.ownerId).toBe(USER_A);
    expect(res.body.data.orgId).toBeNull();
  });

  it("list yalnız çağıranın projelerini döner", async () => {
    await createProject(USER_A, "A1").expect(201);
    await createProject(USER_B, "B1").expect(201);

    const listA = await request(app.getHttpServer())
      .get(`${base}/projects`).set("x-test-user", USER_A).expect(200);
    const namesA = listA.body.data.projects.map((p: { name: string }) => p.name);
    expect(namesA).toContain("A1");
    expect(namesA).not.toContain("B1");
  });

  it("başka kullanıcı projeye erişemez → 403 ERR_PROJECT_FORBIDDEN", async () => {
    const created = await createProject(USER_A, "A2").expect(201);
    const projectId = created.body.data.id;

    // A erişebilir
    await request(app.getHttpServer())
      .get(`${base}/projects/${projectId}`).set("x-test-user", USER_A).expect(200);

    // B alt-kaynağa erişemez (ProjectAccessGuard)
    const denied = await request(app.getHttpServer())
      .get(`${base}/projects/${projectId}/nodes`).set("x-test-user", USER_B).expect(403);
    expect(denied.body.error.code).toBe("ERR_PROJECT_FORBIDDEN");

    // B tekil projeyi de göremez (service assertAccess)
    const deniedGet = await request(app.getHttpServer())
      .get(`${base}/projects/${projectId}`).set("x-test-user", USER_B).expect(403);
    expect(deniedGet.body.error.code).toBe("ERR_PROJECT_FORBIDDEN");
  });

  it("sahip kendi projesinin node listesine erişir → 200", async () => {
    const created = await createProject(USER_A, "A3").expect(201);
    const projectId = created.body.data.id;
    await request(app.getHttpServer())
      .get(`${base}/projects/${projectId}/nodes`).set("x-test-user", USER_A).expect(200);
  });
});
