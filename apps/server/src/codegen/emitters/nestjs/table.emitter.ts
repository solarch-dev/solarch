import type { EmitterContext, GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeNode } from "../../ir";
import { filePathFor, snakeCase, tableSqlName } from "../../naming";
import { countSurgicalMarkers } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * table.emitter.ts — TableNode -> Postgres migration SQL (DDL).
 *
 * Sözleşme (enum.emitter.ts kanonik referansı ile birebir tutarlı):
 *   - default export YOK; named `export const emitTable: NodeEmitter`.
 *   - SAF fonksiyon: (node, ctx) -> GeneratedFile[]. I/O yok, throw yok.
 *   - Yol her zaman filePathFor(node, ctx.graph) ile (hardcode YASAK). NNN
 *     migration sırası graph.migrationIndexOf üzerinden filePathFor içinde çözülür;
 *     bu nedenle emitter tüm Table setini ctx.graph üzerinden görür.
 *   - İçerik DETERMİNİSTİK: koleksiyonlar verilen sırada, timestamp/random yok.
 *   - İçerik tek "\n" ile biter.
 *   - surgicalMarkers countSurgicalMarkers(content) ile sayılır (SQL'de 0).
 *
 * TableNode -> migrations/NNN_create_<pluralizeSnake(TableName)>.sql:
 *   CREATE TABLE <table> (
 *     <kolonlar: tip + NOT NULL + UNIQUE + DEFAULT + GENERATED>,
 *     PRIMARY KEY (...),                  (Column.IsPrimaryKey veya PrimaryKey.Columns)
 *     CONSTRAINT <u> UNIQUE (...),        (UniqueConstraints)
 *     CONSTRAINT <c> CHECK (...)          (CheckConstraints)
 *   );
 *   CREATE [UNIQUE] INDEX <i> ON <table> [USING ...] (...) [WHERE ...];  (Indexes)
 *   ALTER TABLE <table> ADD CONSTRAINT <fk> FOREIGN KEY (...) REFERENCES ...;  (ForeignKeys)
 *
 * FK'lar TÜM tablolardan sonra gelmeli (sıra sorunu) — codegen.service migration
 * dosyalarını NNN'e göre sıralar, FK'lar her tablonun kendi dosyasının sonunda
 * ALTER TABLE ile eklenir; referans edilen tablo migration topolojisinde önce
 * (daha düşük NNN) gelir, böylece çalıştırma sırasında hedef tablo zaten vardır.
 * ──────────────────────────────────────────────────────────────────────── */

type Column = {
  Name: string;
  DataType: string;
  Length?: number;
  Precision?: number;
  Scale?: number;
  IsPrimaryKey: boolean;
  IsNotNull: boolean;
  IsUnique: boolean;
  AutoIncrement: boolean;
  DefaultValue?: string;
  Comment?: string;
  EnumRef?: string;
  IsGenerated?: boolean;
  GeneratedExpression?: string;
};

type ForeignKey = {
  Name?: string;
  Columns: string[];
  ReferencesTable: string;
  ReferencesColumns: string[];
  OnDelete?: string;
  OnUpdate?: string;
};

type Index = {
  IndexName: string;
  Columns: string[];
  Type?: string;
  IsUnique?: boolean;
  IsPartial?: boolean;
  WhereClause?: string;
};

type UniqueConstraint = { Name?: string; Columns: string[] };
type CheckConstraint = { Name?: string; Expression: string };

export const emitTable: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"Table">(node);
  // TableName fiziksel ad olarak alınır (tekrar çoğullanmaz). model.emitter ile
  // TEK KAYNAK: tableSqlName -> entity @Entity adı bu migration adıyla aynı kalır.
  const tableName = tableSqlName(node.name);

  const columns = (props.Columns ?? []) as Column[];
  const foreignKeys = (props.ForeignKeys ?? []) as ForeignKey[];
  const uniques = (props.UniqueConstraints ?? []) as UniqueConstraint[];
  const checks = (props.CheckConstraints ?? []) as CheckConstraint[];
  const indexes = (props.Indexes ?? []) as Index[];

  const blocks: string[] = [];

  // Üst açıklama (deterministik).
  if (props.Description) {
    blocks.push(`-- ${props.Description}`);
  }

  // ── CREATE TABLE gövdesi ──────────────────────────────────────────────
  const inner: string[] = [];

  for (const col of columns) {
    inner.push(`  ${renderColumn(col)}`);
  }

  const pkColumns = resolvePrimaryKey(columns, props.PrimaryKey?.Columns);
  if (pkColumns.length > 0) {
    inner.push(`  PRIMARY KEY (${pkColumns.map(quoteIdent).join(", ")})`);
  }

  for (const uc of uniques) {
    const rawCols = uc.Columns ?? [];
    const cols = rawCols.map((c) => quoteIdent(snakeCase(c))).join(", ");
    if (cols.length === 0) continue; // kayıp kolon -> satırı atla
    const name = uc.Name ?? defaultUniqueName(tableName, rawCols);
    inner.push(`  CONSTRAINT ${quoteIdent(name)} UNIQUE (${cols})`);
  }

  for (const cc of checks) {
    if (!cc.Expression || cc.Expression.trim().length === 0) continue;
    const name = cc.Name ?? defaultCheckName(tableName, cc.Expression);
    inner.push(`  CONSTRAINT ${quoteIdent(name)} CHECK (${cc.Expression.trim()})`);
  }

  // ── ENUM kolonları için CHECK constraint (#56: varchar + CHECK) ──────────
  // Native CREATE TYPE yerine geçerli değerleri CHECK ile kısıtla -> entity'nin
  // varchar kolonuyla TUTARLI + DB-seviyesi doğrulama. Değerler EnumRef -> Enum
  // node'dan (Value ?? Key). Ref çözülemezse CHECK atlanır (kolon yine VARCHAR).
  for (const col of columns) {
    const line = enumCheckConstraint(col, tableName, ctx);
    if (line) inner.push(`  ${line}`);
  }

  const createTable =
    `CREATE TABLE ${quoteIdent(tableName)} (\n` + inner.join(",\n") + `\n);`;
  blocks.push(createTable);

  // ── İndeksler (ayrı CREATE INDEX) ─────────────────────────────────────
  for (const idx of indexes) {
    const line = renderIndex(idx, tableName);
    if (line) blocks.push(line);
  }

  // ── Foreign Key'ler (TÜM tablolardan sonra; ALTER TABLE) ──────────────
  for (const fk of foreignKeys) {
    const line = renderForeignKey(fk, tableName, ctx);
    if (line) blocks.push(line);
  }

  const body = blocks.join("\n\n") + "\n";

  const file: GeneratedFile = {
    path: filePathFor(node, ctx.graph),
    content: body,
    language: "sql",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
};

/* ── Kolon üretimi ──────────────────────────────────────────────────────── */
function renderColumn(col: Column): string {
  const parts: string[] = [quoteIdent(snakeCase(col.Name)), sqlType(col)];

  // AUTO_INCREMENT zaten SERIAL/BIGSERIAL'a çevrildi (sqlType içinde); DEFAULT eklemeyiz.
  const isSerial = col.AutoIncrement === true;

  if (col.IsGenerated === true && col.GeneratedExpression && col.GeneratedExpression.trim().length > 0) {
    parts.push(`GENERATED ALWAYS AS (${col.GeneratedExpression.trim()}) STORED`);
  }
  if (col.IsNotNull === true) {
    parts.push("NOT NULL");
  }
  if (col.IsUnique === true) {
    parts.push("UNIQUE");
  }
  if (!isSerial && col.DefaultValue !== undefined && col.DefaultValue !== "") {
    parts.push(`DEFAULT ${col.DefaultValue}`);
  }
  return parts.join(" ");
}

/** DataType -> Postgres SQL tipi (Length/Precision/Scale + AutoIncrement). */
function sqlType(col: Column): string {
  const dt = (col.DataType ?? "").toUpperCase();
  if (col.AutoIncrement === true) {
    return dt === "BIGINT" ? "BIGSERIAL" : "SERIAL";
  }
  switch (dt) {
    case "INT":
      return "INTEGER";
    case "BIGINT":
      return "BIGINT";
    case "VARCHAR":
      return col.Length && col.Length > 0 ? `VARCHAR(${col.Length})` : "VARCHAR(255)";
    case "TEXT":
      return "TEXT";
    case "BOOLEAN":
      return "BOOLEAN";
    case "DATETIME":
      return "TIMESTAMP";
    case "DATE":
      return "DATE";
    case "GUID":
    case "UUID":
      return "UUID";
    case "FLOAT":
      return "DOUBLE PRECISION";
    case "DECIMAL":
      if (col.Precision && col.Precision > 0) {
        const scale = col.Scale !== undefined ? col.Scale : 0;
        return `DECIMAL(${col.Precision}, ${scale})`;
      }
      return "DECIMAL";
    case "JSON":
      return "JSONB";
    case "ENUM":
      // ENUM kolonu -> VARCHAR (entity de varchar; tutarlılık #56). Geçerli değerler
      // ayrıca CHECK constraint ile kısıtlanır (enumCheckConstraint, emitTable'da).
      // Native CREATE TYPE üretilmez (diyagram evrilince ALTER TYPE kâbusu olmasın).
      return "VARCHAR(255)";
    default:
      return dt.length > 0 ? dt : "TEXT";
  }
}

/** PK kolonlarını çözer: önce PrimaryKey.Columns (composite), yoksa
 *  Column.IsPrimaryKey olan kolonlar (verilen sırada). snake_case'lenir. */
function resolvePrimaryKey(columns: Column[], composite?: string[]): string[] {
  if (composite && composite.length > 0) {
    return composite.map((c) => snakeCase(c));
  }
  return columns.filter((c) => c.IsPrimaryKey === true).map((c) => snakeCase(c.Name));
}

/* ── İndeks üretimi ─────────────────────────────────────────────────────── */
function renderIndex(idx: Index, tableName: string): string | null {
  const cols = (idx.Columns ?? []).map((c) => quoteIdent(snakeCase(c)));
  if (cols.length === 0) return null; // kayıp kolon -> atla
  const unique = idx.IsUnique === true ? "UNIQUE " : "";
  const using = indexUsing(idx.Type);
  const name = quoteIdent(idx.IndexName);
  const table = quoteIdent(tableName);
  const where =
    idx.WhereClause && idx.WhereClause.trim().length > 0 ? ` WHERE ${idx.WhereClause.trim()}` : "";
  return `CREATE ${unique}INDEX ${name} ON ${table}${using} (${cols.join(", ")})${where};`;
}

/** İndeks tipi -> Postgres USING ifadesi (BTree varsayılan; atlanır). */
function indexUsing(type?: string): string {
  switch ((type ?? "BTree").toLowerCase()) {
    case "hash":
      return " USING HASH";
    case "gin":
      return " USING GIN";
    case "gist":
      return " USING GIST";
    case "btree":
    default:
      return "";
  }
}

/* ── Foreign key üretimi (ALTER TABLE; tüm tablolardan sonra) ───────────── */
function renderForeignKey(
  fk: ForeignKey,
  tableName: string,
  ctx: { graph: { resolveRef: (kind: "Table", name: string) => CodeNode | null } },
): string | null {
  const cols = (fk.Columns ?? []).map((c) => quoteIdent(snakeCase(c)));
  const refCols = (fk.ReferencesColumns ?? []).map((c) => quoteIdent(snakeCase(c)));
  if (cols.length === 0 || refCols.length === 0) return null; // eksik kolon -> atla

  // Hedef tablo node'unu çöz; bulunamazsa ham isimden türet (THROW ETMEZ).
  // Fiziksel ad tek kaynaktan (tableSqlName) — referans edilen tablonun
  // CREATE TABLE adıyla birebir aynı (çoğullama YOK).
  const refNode = ctx.graph.resolveRef("Table", fk.ReferencesTable);
  const refTable = refNode ? tableSqlName(refNode.name) : tableSqlName(fk.ReferencesTable);

  const name = fk.Name ?? defaultForeignKeyName(tableName, fk.Columns);
  const onDelete = fkAction(fk.OnDelete);
  const onUpdate = fkAction(fk.OnUpdate);

  return (
    `ALTER TABLE ${quoteIdent(tableName)} ADD CONSTRAINT ${quoteIdent(name)} ` +
    `FOREIGN KEY (${cols.join(", ")}) ` +
    `REFERENCES ${quoteIdent(refTable)} (${refCols.join(", ")}) ` +
    `ON DELETE ${onDelete} ON UPDATE ${onUpdate};`
  );
}

/** FK_ACTION enum -> SQL ifadesi (SET_NULL -> "SET NULL", NO_ACTION -> "NO ACTION"). */
function fkAction(action?: string): string {
  switch ((action ?? "NO_ACTION").toUpperCase()) {
    case "CASCADE":
      return "CASCADE";
    case "RESTRICT":
      return "RESTRICT";
    case "SET_NULL":
      return "SET NULL";
    case "NO_ACTION":
    default:
      return "NO ACTION";
  }
}

/* ── Deterministik varsayılan constraint adları ─────────────────────────── */
function defaultUniqueName(tableName: string, columns: string[]): string {
  return `uq_${tableName}_${columns.map((c) => snakeCase(c)).join("_")}`;
}

/** ENUM kolonu için CHECK constraint satırı: değerler EnumRef -> Enum node'dan
 *  (Value ?? Key, enum.emitter ile AYNI backing). Ref çözülemez/değer yoksa null
 *  (CHECK üretilmez; kolon yine VARCHAR). Değerler SQL-escape edilir (' -> ''). */
function enumCheckConstraint(col: Column, tableName: string, ctx: EmitterContext): string | null {
  if ((col.DataType ?? "").toUpperCase() !== "ENUM" || !col.EnumRef) return null;
  const enumNode = ctx.graph.resolveRef("Enum", col.EnumRef);
  if (!enumNode) return null;
  const values = propsOf<"Enum">(enumNode).Values ?? [];
  const backing = values.map((v) => (v.Value !== undefined && v.Value !== "" ? v.Value : v.Key));
  if (backing.length === 0) return null;
  const colName = snakeCase(col.Name);
  const name = `ck_${tableName}_${colName}_enum`;
  const list = backing.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
  return `CONSTRAINT ${quoteIdent(name)} CHECK (${quoteIdent(colName)} IN (${list}))`;
}

function defaultCheckName(tableName: string, expression: string): string {
  // İfadeden çıplak kimlik türet: harf/rakam dışı -> "_", sıkıştırılır.
  const slug = expression
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return `ck_${tableName}_${slug.length > 0 ? slug : "check"}`;
}

function defaultForeignKeyName(tableName: string, columns: string[]): string {
  return `fk_${tableName}_${columns.map((c) => snakeCase(c)).join("_")}`;
}

/* ── SQL kimlik alıntılama (deterministik; her zaman çift tırnak) ────────── */
function quoteIdent(ident: string): string {
  // Postgres kimliği: gömülü çift tırnak ikilenir.
  return `"${ident.replace(/"/g, '""')}"`;
}
