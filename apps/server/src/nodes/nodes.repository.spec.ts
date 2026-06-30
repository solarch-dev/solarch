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
  homeTabId: "550e8400-e29b-41d4-a716-4466554400aa",
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
  version: 1,
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
  }, 180_000);

  afterAll(async () => {
    await neo4j.onModuleDestroy();
    await container.stop();
  });

  beforeEach(async () => {
    await neo4j.run("MATCH (n:Node) DETACH DELETE n");
  });

  it("create + getById reads node back", async () => {
    await repo.create(nodeFixture());
    const got = await repo.getById(projectId, "550e8400-e29b-41d4-a716-446655440000");
    expect(got?.type).toBe("Table");
    expect(got?.properties).toEqual({ TableName: "users", Description: "u", Columns: [], Indexes: [] });
  });

it("getById otherwise returns null", async () => {
    const got = await repo.getById(projectId, "00000000-0000-0000-0000-000000000000");
    expect(got).toBeNull();
  });

  it("list returns all nodes in project", async () => {
    await repo.create(nodeFixture({ id: "550e8400-e29b-41d4-a716-446655440002" }));
    await repo.create(nodeFixture({ id: "550e8400-e29b-41d4-a716-446655440003", type: "DTO", properties: { Name: "X", Description: "d", Fields: [] } }));
    const list = await repo.list(projectId);
    expect(list).toHaveLength(2);
  });

  it("list type filter works", async () => {
    await repo.create(nodeFixture({ id: "550e8400-e29b-41d4-a716-446655440002" }));
    await repo.create(nodeFixture({ id: "550e8400-e29b-41d4-a716-446655440003", type: "DTO", properties: { Name: "X", Description: "d", Fields: [] } }));
    const list = await repo.list(projectId, "Table");
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe("Table");
  });

  it("update replaces position and properties", async () => {
    await repo.create(nodeFixture());
    await repo.update(projectId, "550e8400-e29b-41d4-a716-446655440000", {
      positionX: 999,
      positionY: 888,
      properties: { TableName: "renamed", Description: "x", Columns: [], Indexes: [] },
      updatedAt: "2026-05-21T11:00:00.000Z",
    });
    const got = await repo.getById(projectId, "550e8400-e29b-41d4-a716-446655440000");
    expect(got?.positionX).toBe(999);
    expect((got?.properties as any).TableName).toBe("renamed");
    expect(got?.updatedAt).toBe("2026-05-21T11:00:00.000Z");
  });

  it("create starts with version=1", async () => {
    await repo.create(nodeFixture());
    const got = await repo.getById(projectId, "550e8400-e29b-41d4-a716-446655440000");
    expect(got?.version).toBe(1);
  });

  it("update increments version by +1 (no expectedVersion — backward compat)", async () => {
    await repo.create(nodeFixture());
    const updated = await repo.update(projectId, "550e8400-e29b-41d4-a716-446655440000", {
      positionX: 5, updatedAt: "2026-05-21T11:00:00.000Z",
    });
    expect(updated?.version).toBe(2);
  });

  it("update with correct expectedVersion succeeds and increments version", async () => {
    await repo.create(nodeFixture());
    const updated = await repo.update(projectId, "550e8400-e29b-41d4-a716-446655440000", {
      positionX: 5, updatedAt: "2026-05-21T11:00:00.000Z", expectedVersion: 1,
    });
    expect(updated?.version).toBe(2);
  });

  it("stale expectedVersion -> null (atomic guard prevents lost update)", async () => {
    await repo.create(nodeFixture());
    // first update bumps version to 2
    await repo.update(projectId, "550e8400-e29b-41d4-a716-446655440000", {
      positionX: 5, updatedAt: "2026-05-21T11:00:00.000Z", expectedVersion: 1,
    });
    // second update still expects version=1 -> rejected (0 rows)
    const stale = await repo.update(projectId, "550e8400-e29b-41d4-a716-446655440000", {
      positionX: 9, updatedAt: "2026-05-21T12:00:00.000Z", expectedVersion: 1,
    });
    expect(stale).toBeNull();
    // data stays at first update (second did not overwrite)
    const got = await repo.getById(projectId, "550e8400-e29b-41d4-a716-446655440000");
    expect(got?.positionX).toBe(5);
    expect(got?.version).toBe(2);
  });

  it("delete causes getById to return null for removed node", async () => {
    await repo.create(nodeFixture());
    await repo.delete(projectId, "550e8400-e29b-41d4-a716-446655440000");
    const got = await repo.getById(projectId, "550e8400-e29b-41d4-a716-446655440000");
    expect(got).toBeNull();
  });

  it("findByName used for in-project unique check", async () => {
    await repo.create(nodeFixture());
    const found = await repo.findByName(projectId, "users");
    expect(found?.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    const notFound = await repo.findByName(projectId, "ghost");
    expect(notFound).toBeNull();
  });
});
