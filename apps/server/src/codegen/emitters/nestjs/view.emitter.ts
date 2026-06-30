import type { GeneratedFile, NodeEmitter } from "../../types";
import type { CodeNode } from "../../ir";
import { filePathFor, pascalCase, tsPropName, viewEntityFilePath } from "../../naming";
import { sqlTypeToTs } from "./sql-type-map";
import { countSurgicalMarkers } from "../../surgical";
import type { ViewNode } from "../../../nodes/schemas/view.schema";

/* ────────────────────────────────────────────────────────────────────────
 * view.emitter.ts — ViewNode -> Postgres migration SQL (CREATE VIEW).
 *
 * Contract (aligned with table.emitter / enum.emitter canonical references):
 *   - no default export; named `export const emitView: NodeEmitter`.
 *   - PURE function: (node, ctx) -> GeneratedFile[]. No I/O, no throw.
 *   - Path always via filePathFor(node, ctx.graph) (hardcode FORBIDDEN). NNN
 *     migration order resolved via graph.migrationIndexOf inside filePathFor:
 *     View always placed AFTER SourceTables.
 *   - Content DETERMINISTIC: single input node.properties; no timestamp/random.
 *   - Content ends with single "\n".
 *   - surgicalMarkers counted via countSurgicalMarkers(content) (pure SQL -> 0).
 *
 * A DB View produces SQL migration like Table (no algorithm field):
 *   CREATE [MATERIALIZED] VIEW <name> AS
 *   <Definition>;
 *
 * Materialized + RefreshStrategy documented as SQL comment (automatic
 * refresh DDL left to user/ops — stay deterministic).
 * ──────────────────────────────────────────────────────────────────────── */

/** View node properties — ir.ts PropsByKind does not include View (only backend-code
 *  emitting kinds are listed), so type comes from View schema; no runtime
 *  conversion (DB is already Zod-validated). */
type ViewProps = ViewNode["properties"];

export const emitView: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = node.properties as ViewProps;
  // Physical view name from single source: same tableSqlName derivation as
  // filePathFor/table.emitter (snake_case; no double pluralization).
  const viewName = sqlIdentName(node.name);
  const materialized = props.Materialized === true;

  const blocks: string[] = [];

  // ── Header comment (deterministic) ──────────────────────────────────────
  if (props.Description) {
    blocks.push(`-- ${props.Description}`);
  }

  // ── Materialized view refresh strategy -> documentation comment ─────────────
  if (materialized && props.RefreshStrategy) {
    blocks.push(`-- RefreshStrategy: ${props.RefreshStrategy}`);
  }

  // ── CREATE [MATERIALIZED] VIEW body ────────────────────────────────
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

  // ── TS @ViewEntity (TypeORM) — importable class when repository returns View type
  //    (migration alone is not enough; resolveTypeToken resolves this).
  //    Columns @ViewColumn + camelCase member (tsPropName) + sqlTypeToTs for TS type. ──
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

/* ── Helpers ────────────────────────────────────────────────────────── */

/** Normalize View Definition: trim surrounding whitespace, normalize line
 *  endings to "\n", strip trailing ";" (emitter adds its own ";").
 *  Determinism: transform raw string only, order preserved. */
function normalizeDefinition(raw: string): string {
  const trimmed = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  return trimmed.endsWith(";") ? trimmed.slice(0, -1).trimEnd() : trimmed;
}

/** Physical SQL name: snake_case (same word-split rules as table.emitter tableSqlName).
 *  Kept here without importing naming.ts — emitter stays dependent only on
 *  filePathFor (no circular/scope expansion); same boundaries as splitWords. */
function sqlIdentName(input: string): string {
  return splitWords(input).map((w) => w.toLowerCase()).join("_");
}

/** Same word splitting as naming.splitWords (camelCase/PascalCase/
 *  snake/kebab/space). */
function splitWords(input: string): string[] {
  return (input ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s\-_./]+/)
    .filter((w) => w.length > 0);
}

/** SQL identifier quoting (same as table.emitter; always double-quote,
 *  embedded double quotes doubled). */
function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}
