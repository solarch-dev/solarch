import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Neo4jService } from "../neo4j.service";
import { env } from "../../config/env";

async function main() {
  const service = new Neo4jService({
    uri: env.NEO4J_URI,
    user: env.NEO4J_USER,
    password: env.NEO4J_PASSWORD,
  });
  await service.onModuleInit();

  const dir = __dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith(".cypher")).sort();

  for (const file of files) {
    const cypher = readFileSync(join(dir, file), "utf-8");
    // Comment LINES are stripped (bug: comment at chunk start dropped entire statement —
    // 005's first constraint was silently skipped).
    const statements = cypher
      .split(/;\s*$/m)
      .map((s) =>
        s
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter(Boolean);
    for (const stmt of statements) {
      console.log(`[${file}] ${stmt.slice(0, 80)}...`);
      await service.run(stmt);
    }
  }

  await service.onModuleDestroy();
  console.log("✓ Migrations complete.");
}

main().catch((err) => {
  console.error("✗ Migration failed:", err);
  process.exit(1);
});
