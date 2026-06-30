import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ZodValidationPipe as ZodPipe } from "nestjs-zod";
import request from "supertest";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { AppModule } from "../src/app.module";
import { Neo4jService } from "../src/neo4j/neo4j.service";
import { SchemaErrorFilter } from "../src/common/filters/schema-error.filter";
import { NotFoundFilter } from "../src/common/filters/not-found.filter";
import { ConflictFilter } from "../src/common/filters/conflict.filter";
import { InternalFilter } from "../src/common/filters/internal.filter";
import { bypassAuth, TEST_AUTH } from "./test-auth";

/* ────────────────────────────────────────────────────────────────────────
* codegen.e2e-spec.ts — POST /projects/:id/codegen end-to-end.
 *
 *   - POST /projects/:id/codegen -> 200 + data.{ target, files[], summary }.
 *
 * Fixture: Controller -CALLS-> Service -CALLS-> Repository -WRITES-> Table
* + DTO + Enum. Nodes are seeded with the real API (passed through Zod verification),
* codegen pulls from DB and produces it.
 * ──────────────────────────────────────────────────────────────────────── */

const projectId = "550e8400-e29b-41d4-a716-446655440099";
const base = "/api/v1";

describe("Codegen E2E (POST /projects/:id/codegen)", () => {
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
    await neo4j.run("CREATE CONSTRAINT project_id_unique IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE");
    await neo4j.run("CREATE INDEX node_project_idx IF NOT EXISTS FOR (n:Node) ON (n.projectId)");

    const moduleRef = await bypassAuth(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(Neo4jService)
        .useValue(neo4j),
    ).compile();

    app = moduleRef.createNestApplication();
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
    await app?.close();
    await neo4j?.onModuleDestroy();
    await container?.stop();
  });

  beforeEach(async () => {
    await neo4j.run("MATCH (n) DETACH DELETE n");
    await neo4j.run(
      `CREATE (p:Project {id: $id, name: 'Codegen E2E', description: 'test', status: 'draft',
        ownerId: $uid, orgId: null, createdAt: datetime(), updatedAt: datetime()})`,
      { id: projectId, uid: TEST_AUTH.userId },
    );
  });

/** Creates the node from the real API (passes Zod validation), returns the id. */
  async function createNode(payload: object): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`${base}/projects/${projectId}/nodes`)
      .send(payload)
      .expect(201);
    return res.body.data.id;
  }

  async function createEdge(sourceNodeId: string, targetNodeId: string, kind: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`${base}/projects/${projectId}/edges`)
      .send({ projectId, sourceNodeId, targetNodeId, kind, properties: { IsAsync: false } })
      .expect(201);
  }

  /** Controller -CALLS-> Service -CALLS-> Repository -WRITES-> Table + DTO + Enum. */
  async function seedGraph(): Promise<void> {
    const table = await createNode({
      type: "Table",
      projectId,
      position: { x: 0, y: 0 },
      properties: {
        TableName: "users",
        Description: "u",
        Columns: [
          { Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false },
          { Name: "email", DataType: "VARCHAR", Length: 255, IsPrimaryKey: false, IsNotNull: true, IsUnique: true, AutoIncrement: false },
        ],
      },
    });
    await createNode({
      type: "Enum",
      projectId,
      position: { x: 0, y: 0 },
      properties: { Name: "UserRole", Description: "e", BackingType: "string", Values: [{ Key: "ADMIN" }, { Key: "MEMBER" }] },
    });
    const dto = await createNode({
      type: "DTO",
      projectId,
      position: { x: 0, y: 0 },
      properties: {
        Name: "CreateUserDto",
        Description: "d",
        Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "Email" }] }],
      },
    });
    const repo = await createNode({
      type: "Repository",
      projectId,
      position: { x: 0, y: 0 },
      properties: {
        RepositoryName: "UserRepository",
        Description: "r",
        EntityReference: "users",
        CustomQueries: [{ QueryName: "findByEmail", QueryType: "findOne", Parameters: [{ Name: "email", Type: "string" }], ReturnType: "User" }],
      },
    });
    const service = await createNode({
      type: "Service",
      projectId,
      position: { x: 0, y: 0 },
      properties: {
        ServiceName: "UsersService",
        Description: "s",
        IsTransactionScoped: true,
        Methods: [
          {
            MethodName: "create",
            Parameters: [{ Name: "dto", Type: "CreateUserDto", DtoRef: "CreateUserDto" }],
            ReturnType: "void",
            IsAsync: true,
          },
        ],
        Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }],
      },
    });
    const controller = await createNode({
      type: "Controller",
      projectId,
      position: { x: 0, y: 0 },
      properties: {
        ControllerName: "UsersController",
        Description: "c",
        BaseRoute: "users",
        Version: "v1",
        Endpoints: [
          {
            HttpMethod: "POST",
            Route: "/",
            RequestDTORef: "CreateUserDto",
            RequiresAuth: true,
            StatusCodes: [{ Code: 201 }],
          },
        ],
      },
    });

// CRITICAL: Controller->Service only from CALLS edge.
    await createEdge(controller, service, "CALLS");
    await createEdge(service, repo, "CALLS");
    await createEdge(repo, table, "WRITES");
  }

  it("POST codegen -> 200 + data.{ target, files[], summary }", async () => {
    await seedGraph();

    const res = await request(app.getHttpServer())
      .post(`${base}/projects/${projectId}/codegen`)
      .send({ target: "nestjs" })
      .expect(200);

    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.target).toBe("nestjs");
    expect(Array.isArray(data.files)).toBe(true);
    expect(data.files.length).toBeGreaterThan(0);

// Verify that core files have been generated (ARCHITECTURE-AWARE feature layout).
    const paths: string[] = data.files.map((f: { path: string }) => f.path);
// Idiomatic names: role suffix is ​​NOT repeated in filename + feature folder.
    expect(paths).toContain("src/users/users.controller.ts");
    expect(paths).toContain("src/users/users.service.ts");
    expect(paths).toContain("src/users/user.repository.ts");
    // Feature module SYNTHESIZED (even without Module node) -> DI complete.
    expect(paths).toContain("src/users/users.module.ts");
    expect(paths.some((p) => p.endsWith(".sql"))).toBe(true);
    expect(paths).toContain("package.json");
    expect(paths).toContain("src/app.module.ts");
// Per-node parent folder NONE (old disjoint structure like "src/users-controller/..." is gone).
    expect(paths.some((p) => /\/users-controller\//.test(p))).toBe(false);
    expect(paths.some((p) => /\/create-user-dto\//.test(p))).toBe(false);

// Summary filled correctly.
    expect(data.summary.nodeCount).toBe(6);
    expect(data.summary.fileCount).toBe(data.files.length);
    expect(data.summary.surgicalMarkerCount).toBeGreaterThan(0);

// Controller->Service DI came from CALLS edge.
    const controller = data.files.find(
      (f: { path: string }) => f.path === "src/users/users.controller.ts",
    );
    expect(controller.content).toContain("UsersService");

// app.module does NOT raw-register controller/provider — imports feature module -> boots.
    const appModule = data.files.find((f: { path: string }) => f.path === "src/app.module.ts");
    expect(appModule.content).toContain("UsersModule");
    expect(appModule.content).not.toContain("controllers:");

// Feature module providers have repository -> DI is full.
    const featureModule = data.files.find(
      (f: { path: string }) => f.path === "src/users/users.module.ts",
    );
    expect(featureModule.content).toContain("UserRepository");
    expect(featureModule.content).toContain("UsersService");
  });

it("no project -> 404 ERR_PROJECT_NOT_FOUND", async () => {
    const res = await request(app.getHttpServer())
      .post(`${base}/projects/11111111-1111-4111-8111-111111111111/codegen`)
      .send({ target: "nestjs" })
      .expect(404);
    expect(res.body.error.code).toBe("ERR_PROJECT_NOT_FOUND");
  });

  it("skippedKinds: EnvironmentVariable survives DB round-trip (config, not a code module)", async () => {
    await seedGraph();

    // EnvironmentVariable is not in EMITTER_REGISTRY — counted in skippedKinds, no stub file.
    // Config is represented once in scaffold .env.example (see codegen.service.spec.ts).
    await createNode({
      type: "EnvironmentVariable",
      projectId,
      position: { x: 0, y: 0 },
      properties: {
        Key: "DATABASE_URL",
        Description: "DB connection",
        DataType: "String",
        IsSecret: false,
        Environment: ["Prod"],
        IsRequired: true,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`${base}/projects/${projectId}/codegen`)
      .send({ target: "nestjs" })
      .expect(200);

    const data = res.body.data;
    expect(data.summary.skippedKinds).toEqual({ EnvironmentVariable: 1 });
    const paths: string[] = data.files.map((f: { path: string }) => f.path);
    expect(paths.some((p) => p.endsWith(".stub.ts"))).toBe(false);
    const envExample = data.files.find((f: { path: string }) => f.path === ".env.example");
    expect(envExample?.content).toContain("DATABASE_URL");
  });

  it("DETERMINISM: same graph generated twice -> byte-identical files", async () => {
    await seedGraph();

    const a = await request(app.getHttpServer())
      .post(`${base}/projects/${projectId}/codegen`).send({ target: "nestjs" }).expect(200);
    const b = await request(app.getHttpServer())
      .post(`${base}/projects/${projectId}/codegen`).send({ target: "nestjs" }).expect(200);

    expect(JSON.stringify(a.body.data.files)).toBe(JSON.stringify(b.body.data.files));
  });

  // ── VERSION STAMPING + STATUS ────────────────────────────────────────────
// GeneratedProject.summary.version carries the current Constructor version; successful
//generate stamps the project node; GET .../codegen/status CURRENT this stamp
// compares with (updateAvailable). Full DB round-trip (Controller->Repository->Neo4j).

/** Write manual stamp to Project node (old version simulation). */
  async function stampVersion(v: number): Promise<void> {
    await neo4j.run(
      `MATCH (p:Project {id:$id}) SET p.codegenVersion = toInteger($v)`,
      { id: projectId, v },
    );
  }

  it("summary.version carries current Constructor version", async () => {
    await seedGraph();
    const res = await request(app.getHttpServer())
      .post(`${base}/projects/${projectId}/codegen`).send({ target: "nestjs" }).expect(200);
    expect(typeof res.body.data.summary.version).toBe("number");
    expect(res.body.data.summary.version).toBeGreaterThanOrEqual(1);
  });

  it("never generated -> status generated null + updateAvailable false", async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/projects/${projectId}/codegen/status`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.generated).toBeNull();
    expect(res.body.data.updateAvailable).toBe(false);
    expect(typeof res.body.data.current).toBe("number");
  });

  it("after generate -> status generated = current + updateAvailable false (stamp persisted)", async () => {
    await seedGraph();
    const gen = await request(app.getHttpServer())
      .post(`${base}/projects/${projectId}/codegen`).send({ target: "nestjs" }).expect(200);
    const current = gen.body.data.summary.version;

    const res = await request(app.getHttpServer())
      .get(`${base}/projects/${projectId}/codegen/status`).expect(200);
    expect(res.body.data.current).toBe(current);
    expect(res.body.data.generated).toBe(current);
    expect(res.body.data.updateAvailable).toBe(false);
  });

  it("stale stamp (current-1) -> updateAvailable true", async () => {
    const cur = await request(app.getHttpServer())
      .get(`${base}/projects/${projectId}/codegen/status`).expect(200);
    await stampVersion(cur.body.data.current - 1);

    const res = await request(app.getHttpServer())
      .get(`${base}/projects/${projectId}/codegen/status`).expect(200);
    expect(res.body.data.generated).toBe(cur.body.data.current - 1);
    expect(res.body.data.updateAvailable).toBe(true);
  });

  it("status: no project -> 404 ERR_PROJECT_NOT_FOUND", async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/projects/11111111-1111-4111-8111-111111111111/codegen/status`)
      .expect(404);
    expect(res.body.error.code).toBe("ERR_PROJECT_NOT_FOUND");
  });
});
