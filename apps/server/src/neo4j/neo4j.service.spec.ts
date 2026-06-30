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
  }, 180_000);

  afterAll(async () => {
    await service.onModuleDestroy();
    await container.stop();
  });

  it("ping çalışır (1 dönderir)", async () => {
    const result = await service.run("RETURN 1 AS n");
    expect(result.records[0].get("n")).toBe(1);
  });

  it("ping() readiness — DB ayaktayken resolve eder", async () => {
    await expect(service.ping()).resolves.toBeUndefined();
  });

  it("transaction içinde write yapar", async () => {
    await service.write(async (tx) => {
      await tx.run("CREATE (n:Test {id: 't1'})");
    });
    const result = await service.run("MATCH (n:Test {id: 't1'}) RETURN n.id AS id");
    expect(result.records[0].get("id")).toBe("t1");
  });
});
