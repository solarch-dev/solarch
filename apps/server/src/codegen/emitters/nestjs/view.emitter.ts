import type { GeneratedFile, NodeEmitter } from "../../types";
import type { CodeNode } from "../../ir";
import { filePathFor, pascalCase, tsPropName, viewEntityFilePath } from "../../naming";
import { sqlTypeToTs } from "./sql-type-map";
import { countSurgicalMarkers } from "../../surgical";
import type { ViewNode } from "../../../nodes/schemas/view.schema";

/* ────────────────────────────────────────────────────────────────────────
 * view.emitter.ts — ViewNode -> Postgres migration SQL (CREATE VIEW).
 *
 * Sözleşme (table.emitter / enum.emitter kanonik referansları ile birebir):
 *   - default export YOK; named `export const emitView: NodeEmitter`.
 *   - SAF fonksiyon: (node, ctx) -> GeneratedFile[]. I/O yok, throw yok.
 *   - Yol her zaman filePathFor(node, ctx.graph) ile (hardcode YASAK). NNN
 *     migration sırası graph.migrationIndexOf üzerinden filePathFor içinde
 *     çözülür: View daima SourceTables'tan SONRA yerleşir.
 *   - İçerik DETERMİNİSTİK: tek girdi node.properties; timestamp/random yok.
 *   - İçerik tek "\n" ile biter.
 *   - surgicalMarkers countSurgicalMarkers(content) ile sayılır (saf SQL -> 0).
 *
 * Bir DB View, Table gibi bir SQL migration üretir (algoritma alanı yok):
 *   CREATE [MATERIALIZED] VIEW <name> AS
 *   <Definition>;
 *
 * Materialized + RefreshStrategy bir SQL yorumu olarak belgelenir (otomatik
 * yenileme DDL'i kullanıcıya/işletime bırakılır — deterministik kalsın).
 * ──────────────────────────────────────────────────────────────────────── */

/** View node properties — ir.ts PropsByKind View'ı içermez (yalnız backend-kod
 *  üreten kind'lar listelidir), bu yüzden tip View şemasından ALINIR; çalışma
 *  zamanı dönüşümü YOK (DB zaten Zod-doğrulanmış). */
type ViewProps = ViewNode["properties"];

export const emitView: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = node.properties as ViewProps;
  // Fiziksel view adı tek kaynaktan: filePathFor/table.emitter ile aynı
  // tableSqlName türevi (snake_case; tekrar çoğullanmaz).
  const viewName = sqlIdentName(node.name);
  const materialized = props.Materialized === true;

  const blocks: string[] = [];

  // ── Üst açıklama (deterministik) ──────────────────────────────────────
  if (props.Description) {
    blocks.push(`-- ${props.Description}`);
  }

  // ── Materialized view yenileme stratejisi -> belge yorumu ─────────────
  if (materialized && props.RefreshStrategy) {
    blocks.push(`-- RefreshStrategy: ${props.RefreshStrategy}`);
  }

  // ── CREATE [MATERIALIZED] VIEW gövdesi ────────────────────────────────
  const viewKw = materialized ? "MATERIALIZED VIEW" : "VIEW";
  const definition = normalizeDefinition(props.Definition);
  blocks.push(`CREATE ${viewKw} ${quoteIdent(viewName)} AS\n${definition};`);

  const body = blocks.join("\n\n") + "\n";

  const file: GeneratedFile = {
    path: filePathFor(node, ctx.graph),
    content: body,
    language: "sql",
    surgicalMarkers: countSurgicalMarkers(body),
  };

  // ── TS @ViewEntity (TypeORM) — repository View'ı tip olarak döndürdüğünde import
  //    edilebilir bir sınıf olsun (yalnız migration yetmez; resolveTypeToken bunu çözer).
  //    Kolonlar @ViewColumn + camelCase üye (tsPropName) + sqlTypeToTs ile TS tipi. ──
  const cols = props.Columns ?? [];
  const ent: string[] = [`import { ViewColumn, ViewEntity } from "typeorm";`, ""];
  if (props.Description) ent.push(`/** ${props.Description} */`);
  ent.push(`@ViewEntity({ name: ${JSON.stringify(viewName)} })`, `export class ${pascalCase(node.name)} {`);
  cols.forEach((col, i) => {
    ent.push(`  @ViewColumn()`, `  ${tsPropName(col.Name)}!: ${sqlTypeToTs(col.DataType, false)};`);
    if (i < cols.length - 1) ent.push("");
  });
  ent.push(`}`);
  const entityFile: GeneratedFile = {
    path: viewEntityFilePath(node, ctx.graph),
    content: ent.join("\n") + "\n",
    language: "typescript",
    surgicalMarkers: 0,
  };

  return [file, entityFile];
};

/* ── Yardımcılar ────────────────────────────────────────────────────────── */

/** View Definition'ını normalize eder: çevreleyen boşlukları kırpar, satır
 *  sonu varyantlarını "\n"e indirger, sondaki ";" düşürülür (emitter kendi ";"
 *  ekler). Determinizm: yalnız ham string üzerinde dönüşüm, sıra korunur. */
function normalizeDefinition(raw: string): string {
  const trimmed = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  return trimmed.endsWith(";") ? trimmed.slice(0, -1).trimEnd() : trimmed;
}

/** Fiziksel SQL adı: snake_case (table.emitter tableSqlName ile aynı kelime
 *  bölme kuralları). naming.ts'yi import etmeden burada tutulur — emitter
 *  yalnız filePathFor'a bağımlı kalsın (döngüsel/kapsam genişlemesi olmasın);
 *  splitWords ile birebir aynı sınırlar. */
function sqlIdentName(input: string): string {
  return splitWords(input).map((w) => w.toLowerCase()).join("_");
}

/** naming.splitWords ile birebir aynı kelime bölme (camelCase/PascalCase/
 *  snake/kebab/boşluk). */
function splitWords(input: string): string[] {
  return (input ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s\-_./]+/)
    .filter((w) => w.length > 0);
}

/** SQL kimlik alıntılama (table.emitter ile birebir; her zaman çift tırnak,
 *  gömülü çift tırnak ikilenir). */
function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}
