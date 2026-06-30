import { randomUUID } from "node:crypto";
import { Neo4jService } from "../../neo4j.service";
import { env } from "../../../config/env";

/** Her projeye default "Ana Mimari" sekmesi + her node'a homeTabId backfill.
 *  Idempotent — node.position KORUNUR. */
async function main(): Promise<void> {
  const svc = new Neo4jService({ uri: env.NEO4J_URI, user: env.NEO4J_USER, password: env.NEO4J_PASSWORD });
  await svc.onModuleInit();

  const projects = await svc.run(`MATCH (p:Project) RETURN p.id AS id`);
  let tabs = 0;
  let backfilled = 0;
  for (const rec of projects.records) {
    const projectId = rec.get("id");
    const def = await svc.run(
      `MATCH (t:Tab {projectId: $projectId, isDefault: true}) RETURN t.id AS id LIMIT 1`,
      { projectId },
    );
    let tabId: string;
    if (def.records.length === 0) {
      tabId = randomUUID();
      const now = new Date().toISOString();
      await svc.run(
        `CREATE (t:Tab {
          id: $id, projectId: $projectId, name: 'Main Architecture', isDefault: true,
          order: 0, moduleNodeId: null, createdAt: datetime($now), updatedAt: datetime($now)
        })`,
        { id: tabId, projectId, now },
      );
      tabs++;
    } else {
      tabId = def.records[0].get("id");
    }
    const res = await svc.run(
      `MATCH (n:Node {projectId: $projectId}) WHERE n.homeTabId IS NULL
       SET n.homeTabId = $tabId RETURN count(n) AS c`,
      { projectId, tabId },
    );
    backfilled += Number(res.records[0].get("c"));
  }

  await svc.onModuleDestroy();
  console.log(`✓ Tabs migration: ${tabs} default sekme, ${backfilled} node homeTabId backfill.`);
}

main().catch((e) => {
  console.error("✗ Tabs migration failed:", e);
  process.exit(1);
});
