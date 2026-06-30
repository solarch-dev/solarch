import { Neo4jService } from "../../neo4j.service";
import { env } from "../../../config/env";

/** Faz A veri migration'ı: mevcut Veri ailesi node'larını (Table/DTO/Model/
 *  Enum/View) zengin v2 şemaya dönüştürür.
 *
 *  Idempotent — eksik zorunlu dizileri default ile doldurur, eski alanları
 *  (Column.IsForeignKey/References, string[] Enum Values) yeni biçime taşır.
 *  Tekrar çalıştırmak güvenlidir. */
async function main(): Promise<void> {
  const svc = new Neo4jService({
    uri: env.NEO4J_URI,
    user: env.NEO4J_USER,
    password: env.NEO4J_PASSWORD,
  });
  await svc.onModuleInit();

  const kinds = ["Table", "DTO", "Model", "Enum", "View"];
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
  console.log(`✓ Phase A migration: ${migrated} nodes converted.`);
}

function enrich(kind: string, p: any): any {
  if (kind === "Table") {
    return {
      ...p,
      ForeignKeys: p.ForeignKeys ?? [],
      UniqueConstraints: p.UniqueConstraints ?? [],
      CheckConstraints: p.CheckConstraints ?? [],
      Indexes: (p.Indexes ?? []).map((i: any) => ({ Type: "BTree", IsUnique: false, ...i })),
      Columns: (p.Columns ?? []).map((c: any) => {
        const { IsForeignKey, References, ...rest } = c; // eski alanları at
        return rest;
      }),
    };
  }
  if (kind === "DTO") {
    const KNOWN = ["Min", "Max", "MinLength", "MaxLength", "Email", "Url", "Regex", "Pattern", "Positive", "Negative"];
    const norm = (raw: unknown) => KNOWN.find((k) => k.toLowerCase() === String(raw).toLowerCase());
    return {
      ...p,
      Fields: (p.Fields ?? []).map((f: any) => {
        const { ValidationRule, ValidationRules, ...rest } = f;
        // Kaynak: yeni yapısal ValidationRules[] varsa onu, yoksa eski string'i.
        const source = ValidationRules ?? (ValidationRule ? [{ Rule: ValidationRule }] : []);
        // Rule'u enum'a normalize et (case-insensitive); serbest metin/tanınmayanı düşür.
        const cleaned = source
          .map((r: any) => {
            const matched = norm(r.Rule);
            return matched ? { ...r, Rule: matched } : null;
          })
          .filter(Boolean);
        return { ...rest, ValidationRules: cleaned };
      }),
    };
  }
  if (kind === "Model") {
    return {
      ...p,
      Properties: (p.Properties ?? []).map((pr: any) => ({ IsNullable: false, IsCollection: false, ...pr })),
      Methods: (p.Methods ?? []).map((m: any) => ({ Visibility: "public", Parameters: [], IsAsync: false, IsStatic: false, ...m })),
    };
  }
  if (kind === "Enum") {
    return {
      ...p,
      BackingType: p.BackingType ?? "string",
      Values: (p.Values ?? []).map((v: any) => (typeof v === "string" ? { Key: v } : v)),
    };
  }
  if (kind === "View") {
    return { ...p, Columns: p.Columns ?? [] };
  }
  return p;
}

main().catch((e) => {
  console.error("✗ Migration failed:", e);
  process.exit(1);
});
