import { Neo4jService } from "../../neo4j.service";
import { env } from "../../../config/env";

/** Phase B data migration: moves Business Logic + Access nodes (Service/Worker/
 *  EventHandler/Orchestrator/Controller/MessageQueue/APIGateway) to v3 schema.
 *
 *  Idempotent — converts breaking renames, defaults missing arrays.
 *  Safe to re-run (already-migrated fields are no-op). */
async function main(): Promise<void> {
  const svc = new Neo4jService({
    uri: env.NEO4J_URI,
    user: env.NEO4J_USER,
    password: env.NEO4J_PASSWORD,
  });
  await svc.onModuleInit();

  const kinds = ["Service", "Worker", "EventHandler", "Orchestrator", "Controller", "MessageQueue", "APIGateway"];
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
  console.log(`✓ Phase B migration: ${migrated} nodes converted.`);
}

function enrich(kind: string, p: any): any {
  if (kind === "Service") {
    return {
      ...p,
      Dependencies: p.Dependencies ?? [],
      Methods: (p.Methods ?? []).map((m: any) => {
        const { InputParams, ...rest } = m; // eski InputParams → Parameters
        return {
          Visibility: "public",
          IsAsync: false,
          Throws: [],
          ...rest,
          Parameters: rest.Parameters ?? InputParams ?? [],
        };
      }),
    };
  }
  if (kind === "Worker") {
    // RetryPolicy: number → { MaxRetries }
    const rp = typeof p.RetryPolicy === "number" ? { MaxRetries: p.RetryPolicy } : p.RetryPolicy ?? { MaxRetries: 0 };
    return { IsEnabled: true, ...p, RetryPolicy: rp };
  }
  if (kind === "EventHandler") {
    return { ...p }; // new fields all optional — no transform needed
  }
  if (kind === "Orchestrator") {
    return { ...p, Steps: p.Steps ?? [] };
  }
  if (kind === "Controller") {
    return {
      ...p,
      Endpoints: (p.Endpoints ?? []).map((e: any) => {
        const { RequestDTO, ResponseDTO, ...rest } = e; // eski → Ref
        const out: any = {
          RequiredRoles: [],
          PathParams: [],
          QueryParams: [],
          StatusCodes: [],
          MiddlewareRefs: [],
          ...rest,
          RequestDTORef: rest.RequestDTORef ?? RequestDTO,
          ResponseDTORef: rest.ResponseDTORef ?? ResponseDTO,
        };
        if (out.RequestDTORef === undefined) delete out.RequestDTORef;
        if (out.ResponseDTORef === undefined) delete out.ResponseDTORef;
        return out;
      }),
    };
  }
  if (kind === "MessageQueue") {
    return { ...p }; // yeni alanlar opsiyonel
  }
  if (kind === "APIGateway") {
    return { ...p, Routes: p.Routes ?? [] };
  }
  return p;
}

main().catch((e) => {
  console.error("✗ Migration failed:", e);
  process.exit(1);
});
