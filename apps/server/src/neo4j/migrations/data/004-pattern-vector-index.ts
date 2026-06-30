import { Neo4jService } from "../../neo4j.service";
import { env } from "../../../config/env";

/** Native vector index for :Pattern(embedding). Idempotent (IF NOT EXISTS).
 *  Dimension from env.EMBED_DIM (local all-MiniLM-L6-v2 = 384). If model/dimension
 *  changes, index DROP + recreate is required. */
async function main(): Promise<void> {
  const svc = new Neo4jService({
    uri: env.NEO4J_URI,
    user: env.NEO4J_USER,
    password: env.NEO4J_PASSWORD,
  });
  await svc.onModuleInit();
  // Index config map does not accept params + requires INTEGER (param becomes float).
  // EMBED_DIM is trusted env int → embed as literal.
  const dim = Math.trunc(env.EMBED_DIM);
  await svc.run(
    `CREATE VECTOR INDEX pattern_embedding IF NOT EXISTS
     FOR (p:Pattern) ON (p.embedding)
     OPTIONS { indexConfig: {
       \`vector.dimensions\`: ${dim},
       \`vector.similarity_function\`: 'cosine'
     } }`,
  );
  await svc.onModuleDestroy();
  console.log(`✓ pattern_embedding vector index ready (dim=${env.EMBED_DIM}).`);
}

main().catch((e) => {
  console.error("✗ Index migration failed:", e);
  process.exit(1);
});
