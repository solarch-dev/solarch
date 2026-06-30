import { Neo4jService } from "../../neo4j/neo4j.service";
import { ProjectsRepository } from "../../projects/projects.repository";
import { PatternsRepository } from "../patterns.repository";
import { PatternsService } from "../patterns.service";
import { EmbeddingsService } from "../../embeddings/embeddings.service";
import { CANONICAL_PATTERNS } from "./canonical-patterns";
import { env } from "../../config/env";

/** Reconciles the canonical 'seed' patterns to the current definitions: removes
 *  every existing 'seed' pattern and recreates them from CANONICAL_PATTERNS, so
 *  renamed AND description-only changes (e.g. the old Turkish copy → English)
 *  always land. User-promoted patterns (source != 'seed') are never listed nor
 *  deleted here. Outcome-idempotent. */
async function main(): Promise<void> {
  const neo4j = new Neo4jService({ uri: env.NEO4J_URI, user: env.NEO4J_USER, password: env.NEO4J_PASSWORD });
  await neo4j.onModuleInit();
  const repo = new PatternsRepository(neo4j);
  const svc = new PatternsService(repo, new ProjectsRepository(neo4j), new EmbeddingsService());

  // Remove every existing 'seed' pattern, then recreate from the current
  // definitions — so renamed AND description-only changes always land.
  let removed = 0;
  for (const existing of await repo.list()) {
    await repo.delete(existing.id);
    removed++;
  }

  let created = 0;
  for (const p of CANONICAL_PATTERNS) {
    await svc.create(p, "seed");
    created++;
    console.log(`  + ${p.name}`);
  }

  await neo4j.onModuleDestroy();
  console.log(`✓ Pattern seed sync: ${removed} removed, ${created} recreated from canonical.`);
}

main().catch((e) => {
  console.error("✗ Seed failed:", e);
  process.exit(1);
});
