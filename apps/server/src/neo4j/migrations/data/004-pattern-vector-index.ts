import { Neo4jService } from "../../neo4j.service";
import { env } from "../../../config/env";

/** :Pattern(embedding) için native vektör index. Idempotent (IF NOT EXISTS).
 *  Boyut env.EMBED_DIM'den (lokal all-MiniLM-L6-v2 = 384). Model/boyut değişirse
 *  index DROP + yeniden oluşturma gerekir. */
async function main(): Promise<void> {
  const svc = new Neo4jService({
    uri: env.NEO4J_URI,
    user: env.NEO4J_USER,
    password: env.NEO4J_PASSWORD,
  });
  await svc.onModuleInit();
  // Index config map'i parametre kabul etmiyor + sayıyı INTEGER ister (param float
  // gider). EMBED_DIM trusted env int → literal olarak göm.
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
