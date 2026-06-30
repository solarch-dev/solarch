import { Neo4jService } from "../../neo4j.service";
import { env } from "../../../config/env";

/** Faz C veri migration'ı: Altyapı/İstemci/Güvenlik/Konfig/Yapı node'larını
 *  (Repository/Cache/ExternalService/FrontendApp/UIComponent/Middleware/
 *  EnvironmentVariable/Exception/Module) v4 şemaya taşır.
 *
 *  Idempotent. Tek kırıcı dönüşüm: Repository.CustomQueries string[] → obje[].
 *  Geri kalan yeni alanlar additive (opsiyonel/default) — eksik default dizileri
 *  tutarlılık için doldurulur. */
async function main(): Promise<void> {
  const svc = new Neo4jService({
    uri: env.NEO4J_URI,
    user: env.NEO4J_USER,
    password: env.NEO4J_PASSWORD,
  });
  await svc.onModuleInit();

  const kinds = ["Repository", "Cache", "ExternalService", "FrontendApp", "UIComponent", "Middleware", "EnvironmentVariable", "Exception", "Module"];
  let migrated = 0;
  for (const kind of kinds) {
    const res = await svc.run(
      `MATCH (n:\`${kind}\`) RETURN n.id AS id, n.properties AS props`,
    );
    for (const rec of res.records) {
      const id = rec.get("id");
      const props = JSON.parse(rec.get("props"));
      const next = enrich(kind, props);
      await svc.run(`MATCH (n {id: $id}) SET n.properties = $props`, {
        id,
        props: JSON.stringify(next),
      });
      migrated++;
    }
  }

  await svc.onModuleDestroy();
  console.log(`✓ Phase C migration: ${migrated} nodes converted.`);
}

function enrich(kind: string, p: any): any {
  if (kind === "Repository") {
    return {
      IsCached: false,
      ...p,
      CustomQueries: (p.CustomQueries ?? []).map((q: any) =>
        typeof q === "string"
          ? { QueryName: q, QueryType: "custom", Parameters: [], ReturnType: "unknown" }
          : { QueryType: "custom", Parameters: [], ...q },
      ),
    };
  }
  if (kind === "FrontendApp") {
    return { ...p, Routes: p.Routes ?? [] };
  }
  if (kind === "UIComponent") {
    return {
      ...p,
      Props: (p.Props ?? []).map((pr: any) => ({ Required: false, ...pr })),
      State: p.State ?? [],
      Events: p.Events ?? [],
      ChildComponentRefs: p.ChildComponentRefs ?? [],
    };
  }
  if (kind === "Middleware") {
    return { ...p, Config: p.Config ?? [] };
  }
  if (kind === "EnvironmentVariable") {
    return { IsRequired: true, ...p };
  }
  if (kind === "Module") {
    return { ...p, ExposedServices: p.ExposedServices ?? [], Dependencies: p.Dependencies ?? [] };
  }
  // Cache / ExternalService / Exception: yeni alanlar tümü opsiyonel — dönüşüm gerekmez.
  return p;
}

main().catch((e) => {
  console.error("✗ Migration failed:", e);
  process.exit(1);
});
