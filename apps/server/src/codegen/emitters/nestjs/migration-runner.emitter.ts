import type { GeneratedFile } from "../../types";
import { pascalCase } from "../../naming";
import { countSurgicalMarkers } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * migration-runner.emitter.ts — produce RUNNABLE TypeORM TS migration classes
 * from raw SQL migrations (H5).
 *
 * Problem: table.emitter / view.emitter produce `migrations/NNN_create_<x>.sql`;
 * these are READABLE but not runnable by TypeORM CLI. This emitter takes SQL files
 * collected at assembly and for each produces
 * `src/migrations/NNN-Create<X>.ts` (MigrationInterface):
 *   - up(queryRunner)   -> runs SQL statements in order
 *   - down(queryRunner) -> DROP table/view (reverse)
 * data-source.ts `dist/migrations/*.js` glob picks these up -> `npm run db:migrate`
 * can apply schema. synchronize:false preserved.
 *
 * PURE + DETERMINISTIC: input is SQL files only (given sorted); no timestamp/
 * random. SQL raw text embedded in template literal with SAFE escaping.
 * Scaffold/orchestrator helper; NOT node-bound (no nodeId).
 * ──────────────────────────────────────────────────────────────────────── */

/** One collected SQL migration file (from assembly; path "migrations/...sql"). */
export interface SqlMigrationFile {
  /** e.g. "migrations/001_create_users.sql". */
  path: string;
  /** Raw SQL content (table/view emitter output). */
  content: string;
}

/** Produce TypeORM TS migration classes from sorted SQL migration files.
 *  Files must be given in SAME order (by NNN). TypeORM parses LAST 13 CHARACTERS
 *  of class name as JS-millisecond timestamp (MigrationExecutor:
 *  parseInt(name.substr(-13))) and sorts migrations by it; plain "001"
 *  suffix yields NaN and CLI throws. So we derive DETERMINISTIC 13-digit
 *  timestamp from NNN (BASE_TS + seq) and append to class name END ->
 *  substr(-13) returns exactly those 13 digits, order increases with NNN, no timestamp/random. */
export function emitMigrationRunners(sqlFiles: SqlMigrationFile[]): GeneratedFile[] {
  const out: GeneratedFile[] = [];
  for (const sql of sqlFiles) {
    const seq = seqOf(sql.path);
    const tableName = tableNameOf(sql.path);
    if (seq === null || tableName.length === 0) continue;

    const isView = looksLikeView(sql.content);
    const ts = syntheticTimestamp(seq);
    // Class name ends with <Name><ts> -> TypeORM substr(-13) == ts (pure 13 digits).
    const className = `Create${pascalCase(tableName)}${ts}`;
    const statements = splitSqlStatements(sql.content);
    out.push(buildMigrationFile(seq, ts, tableName, className, statements, isView));
  }
  return out;
}

/** Produce TypeORM-compatible DETERMINISTIC 13-digit timestamp from NNN sequence.
 *  TypeORM only parseInts last 13 digits and sorts by timestamp; real time not
 *  needed, only monotonically increasing 13-digit number. Fixed BASE_TS
 *  (2023-11-14) + seq -> timestamp increases with seq; same graph -> byte-identical. */
function syntheticTimestamp(seq: string): string {
  const BASE_TS = 1_700_000_000_000; // fixed 13-digit base (UTC ~2023-11-14)
  return String(BASE_TS + Number(seq));
}

/* ── Produce one migration file ─────────────────────────────────────── */
function buildMigrationFile(
  seq: string,
  ts: string,
  tableName: string,
  className: string,
  statements: string[],
  isView: boolean,
): GeneratedFile {
  const upLines = statements.map((s) => `    await queryRunner.query(${tsTemplate(s)});`);
  const dropKw = isView ? "DROP VIEW IF EXISTS" : "DROP TABLE IF EXISTS";
  const downStmt = `${dropKw} ${quoteIdent(tableName)} CASCADE`;

  const body = `import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Solarch-generated TypeORM migration (${tableName}).
 * up(): applies the schema; down(): reverts it. With synchronize:false the schema
 * changes ONLY through migrations. Raw SQL reference: migrations/${seq}_create_${tableName}.sql.
 */
export class ${className} implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
${upLines.join("\n")}
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(${tsTemplate(downStmt)});
  }
}
`;

  return {
    // TypeORM convention: <timestamp>-<Name>.ts. Glob (dist/migrations/*.js) finds these;
    //   filename ts also aligns file order with NNN.
    path: `src/migrations/${ts}-Create${pascalCase(tableName)}.ts`,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
}

/* ── SQL parsing (deterministic; not comment-aware but carries comments
 *    with statements) ─────────────────────────────────────────── */

/** Split raw SQL into ";" terminated statements. Comment lines (-- ...) attach
 *  to next statement; top-level FK ALTER and CREATE INDEX are separate statements.
 *  Single line ending normalized. */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = "";
  for (const rawLine of sql.split("\n")) {
    buf += (buf.length > 0 ? "\n" : "") + rawLine;
    // Statement ends with ";" (trailing whitespace ignored).
    if (/;\s*$/.test(rawLine)) {
      const stmt = buf.trim();
      if (stmt.length > 0) statements.push(stmt.replace(/;\s*$/, ""));
      buf = "";
    }
  }
  const tail = buf.trim();
  if (tail.length > 0) statements.push(tail.replace(/;\s*$/, ""));
  // Drop all-comment chunks (only "-- ...") — not executable.
  return statements.filter((s) => s.split("\n").some((l) => l.trim().length > 0 && !l.trim().startsWith("--")));
}

/** Is this CREATE VIEW / MATERIALIZED VIEW? (for down() DROP VIEW choice.) */
function looksLikeView(sql: string): boolean {
  return /\bCREATE\s+(MATERIALIZED\s+)?VIEW\b/i.test(sql);
}

/** "migrations/001_create_users.sql" -> "001". */
function seqOf(path: string): string | null {
  const m = path.match(/\/(\d+)_create_/);
  return m ? m[1] : null;
}

/** "migrations/001_create_users.sql" -> "users" (physical name). */
function tableNameOf(path: string): string {
  const m = path.match(/_create_(.+)\.sql$/);
  return m ? m[1] : "";
}

/** Embed SQL statement in safe TS template literal (escape backtick + ${}
 *  + backslash). Deterministic. */
function tsTemplate(sql: string): string {
  const escaped = sql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  // Template literal for readable multi-line SQL.
  return `\`${escaped}\``;
}

/** Postgres identifier quoting (same as table.emitter). */
function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}
