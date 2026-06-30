import type { GeneratedFile } from "../../types";
import { pascalCase } from "../../naming";
import { countSurgicalMarkers } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * migration-runner.emitter.ts — ham SQL migration'larından ÇALIŞTIRILABİLİR
 * TypeORM TS migration sınıfları üretir (H5).
 *
 * Sorun: table.emitter / view.emitter `migrations/NNN_create_<x>.sql` üretir;
 * bunlar OKUNAKLI ama TypeORM CLI tarafından çalıştırılamaz. Bu üretici, montaj
 * sırasında toplanan SQL dosyalarını alır ve her biri için bir
 * `src/migrations/NNN-Create<X>.ts` (MigrationInterface) üretir:
 *   - up(queryRunner)   -> SQL ifadelerini sırayla çalıştırır
 *   - down(queryRunner) -> tabloyu/view'ı DROP eder (ters işlem)
 * data-source.ts `dist/migrations/*.js` glob'u bunlara bakar -> `npm run db:migrate`
 * şemayı uygulayabilir. synchronize:false korunur.
 *
 * SAF + DETERMİNİSTİK: girdi yalnız SQL dosyaları (sıralı verilir); timestamp/
 * random YOK. SQL ham metni template literal içine GÜVENLİ kaçışla gömülür.
 * Bu bir scaffold/orchestrator yardımcısıdır; node'a bağlı DEĞİLDİR (nodeId yok).
 * ──────────────────────────────────────────────────────────────────────── */

/** Tek bir toplanmış SQL migration dosyası (montajdan; path "migrations/...sql"). */
export interface SqlMigrationFile {
  /** ör. "migrations/001_create_users.sql". */
  path: string;
  /** Ham SQL içeriği (table/view emitter çıktısı). */
  content: string;
}

/** Sıralı SQL migration dosyalarından TypeORM TS migration sınıfları üretir.
 *  Dosyalar AYNI sırada (NNN'e göre) verilmelidir. TypeORM, sınıf adının SON 13
 *  KARAKTERİNİ JS-milisaniye zaman damgası olarak ayrıştırır (MigrationExecutor:
 *  parseInt(name.substr(-13))) ve migration'ları buna göre sıralar; salt "001"
 *  soneki NaN verir ve CLI fırlatır. Bu yüzden NNN'den DETERMİNİSTİK bir 13-haneli
 *  zaman damgası türetiriz (BASE_TS + seq) ve sınıf adının SONUNA ekleriz ->
 *  substr(-13) tam o 13 haneyi döndürür, sıra NNN ile artar, timestamp/random YOK. */
export function emitMigrationRunners(sqlFiles: SqlMigrationFile[]): GeneratedFile[] {
  const out: GeneratedFile[] = [];
  for (const sql of sqlFiles) {
    const seq = seqOf(sql.path);
    const tableName = tableNameOf(sql.path);
    if (seq === null || tableName.length === 0) continue;

    const isView = looksLikeView(sql.content);
    const ts = syntheticTimestamp(seq);
    // Sınıf adı <Name><ts> ile biter -> TypeORM substr(-13) == ts (saf 13 hane).
    const className = `Create${pascalCase(tableName)}${ts}`;
    const statements = splitSqlStatements(sql.content);
    out.push(buildMigrationFile(seq, ts, tableName, className, statements, isView));
  }
  return out;
}

/** NNN dizisinden TypeORM-uyumlu DETERMİNİSTİK 13-haneli zaman damgası üretir.
 *  TypeORM yalnız son 13 haneyi parseInt eder ve timestamp'e göre sıralar; gerçek
 *  zaman gerekmez, yalnız monoton-artan 13-haneli bir sayı yeter. BASE_TS sabit
 *  (2023-11-14) + seq -> seq arttıkça timestamp artar; aynı graph -> byte-identical. */
function syntheticTimestamp(seq: string): string {
  const BASE_TS = 1_700_000_000_000; // sabit 13-haneli taban (UTC ~2023-11-14)
  return String(BASE_TS + Number(seq));
}

/* ── Bir migration dosyasını üretir ─────────────────────────────────────── */
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
    // TypeORM geleneği: <timestamp>-<Name>.ts. Glob (dist/migrations/*.js) bunları
    //   bulur; dosya adındaki ts dosya sırasını da NNN ile hizalar.
    path: `src/migrations/${ts}-Create${pascalCase(tableName)}.ts`,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
}

/* ── SQL ayrıştırma (deterministik; yorum-farkında değil ama yorumları
 *    ifadelerle birlikte taşır) ─────────────────────────────────────────── */

/** Ham SQL'i ";" ile biten ifadelere böler. Yorum satırları (-- ...) bir
 *  sonraki ifadeye iliştirilir; üst düzey FK ALTER ve CREATE INDEX ayrı ifade
 *  olur. Tek satır sonu normalize edilir. */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = "";
  for (const rawLine of sql.split("\n")) {
    buf += (buf.length > 0 ? "\n" : "") + rawLine;
    // Bir ifade ";" ile biter (satır sonu boşlukları yok sayılır).
    if (/;\s*$/.test(rawLine)) {
      const stmt = buf.trim();
      if (stmt.length > 0) statements.push(stmt.replace(/;\s*$/, ""));
      buf = "";
    }
  }
  const tail = buf.trim();
  if (tail.length > 0) statements.push(tail.replace(/;\s*$/, ""));
  // Tümüyle yorum olan parçaları (yalnız "-- ...") at — çalıştırılamaz.
  return statements.filter((s) => s.split("\n").some((l) => l.trim().length > 0 && !l.trim().startsWith("--")));
}

/** Bir CREATE VIEW / MATERIALIZED VIEW mı? (down() DROP VIEW seçimi için.) */
function looksLikeView(sql: string): boolean {
  return /\bCREATE\s+(MATERIALIZED\s+)?VIEW\b/i.test(sql);
}

/** "migrations/001_create_users.sql" -> "001". */
function seqOf(path: string): string | null {
  const m = path.match(/\/(\d+)_create_/);
  return m ? m[1] : null;
}

/** "migrations/001_create_users.sql" -> "users" (fiziksel ad). */
function tableNameOf(path: string): string {
  const m = path.match(/_create_(.+)\.sql$/);
  return m ? m[1] : "";
}

/** Bir SQL ifadesini güvenli bir TS template literal'e gömer (backtick + ${}
 *  + backslash kaçışlanır). Deterministik. */
function tsTemplate(sql: string): string {
  const escaped = sql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  // Çok satırlı SQL'ler okunaklı kalsın diye template literal kullanılır.
  return `\`${escaped}\``;
}

/** Postgres kimlik alıntılama (table.emitter ile aynı). */
function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}
