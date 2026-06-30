import type { EmitterContext, GeneratedFile } from "../../types";
import { propsOf, type CodeGraph, type CodeNode } from "../../ir";
import {
  camelCase,
  entityClassNameForTable,
  filePathFor,
  importPathOf,
  pascalCase,
  pluralizeSnake,
  relativeImportPath,
  singularize,
  snakeCase,
  synthEntityFilePath,
  tableSqlName,
  tsPropName,
} from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";
import { columnOrmType, columnTsType } from "./sql-type-map";

// Entity name/path SINGLE SOURCE is in naming.ts (resolveTypeRef depends on it);
// re-exported here for backward compatibility.
export { entityClassNameForTable, synthEntityFilePath };

/* ────────────────────────────────────────────────────────────────────────
 * entity-synthesis.ts — SYNTHESIZED TypeORM entity from Table.
 *
 * ARCHITECTURE-AWARE BOOT GUARANTEE: In real graphs often no Model node,
 * only Table nodes (Users/GeneratedImages -> migrations/*.sql). When a
 * Repository.EntityReference points to a Table, repository.emitter emits
 * `@InjectRepository(Entity)`/`Repository<Entity>` and module.emitter adds
 * `TypeOrmModule.forFeature([Entity])`. If no TypeORM @Entity class exists
 * NestJS DI cannot resolve `Repository<Entity>` at boot and the app WON'T START.
 * This module emits a deterministic @Entity class from Table schema for every
 * Table referenced by a Repository but WITHOUT a Model.
 *
 * SINGLE SOURCE rules:
 *   - Class name: entityClassNameForTable(table) — avoid Model<->Table collision
 *     via singular-pascal of table name (UsersTable.name="users" -> "User";
 *     "generated_images" -> "GeneratedImage"). repository.emitter uses same name.
 *   - @Entity(<name>): tableSqlName(table.name) — EXACTLY same as table.emitter's
 *     `CREATE TABLE` name (entity never binds to nonexistent table).
 *   - File path: synthEntityFilePath(table, graph) — <feature>/entities/<kebab>.entity.ts
 *     (same layout as Model entity path; if Model exists in same feature, Model
 *     file is emitted — orchestrator synthesizes only for Tables WITHOUT Model).
 *
 * RELATION SYNTHESIS (M2): Table has no @OneToMany/@ManyToOne; only SQL FKs.
 *   Without relation decorators on entity, N+1/lazy decision stays entirely with
 *   surgical. This module DETERMINISTICALLY synthesizes TypeORM relations from
 *   Table ForeignKeys:
 *     - FK (this table -> target) -> owning side @ManyToOne(() => Target) + @JoinColumn.
 *     - Inverse (other table -> this table) -> @OneToMany(() => Other, x => x.<owning>).
 *   Default eager:false / lazy:false (no auto-load -> no N+1 explosion).
 *   PURITY RULE: a relation is emitted ONLY when the other side also resolves to a
 *   SYNTHETIC entity (Table without Model + repository-referenced). If other side
 *   cannot resolve (has Model, not repo-referenced, or missing) relation is NOT
 *   emitted — to avoid importing nonexistent class and breaking compile.
 *   Bidirectional @OneToMany uses owning-side property name (deterministically
 *   derived from FK column) in inverse function.
 *
 * PURE + DETERMINISTIC: columns in given order, relations in FK order (ManyToOne)
 * then target-table name order (OneToMany), imports via ImportCollector,
 * no timestamp/random, content ends with single "\n". Relation body is NOT emitted
 * -> no surgical marker.
 * ──────────────────────────────────────────────────────────────────────── */

type Column = {
  Name: string;
  DataType: string;
  Length?: number;
  IsPrimaryKey: boolean;
  IsNotNull: boolean;
  IsUnique: boolean;
  AutoIncrement: boolean;
  EnumRef?: string;
};

type ForeignKey = {
  Name?: string;
  Columns: string[];
  ReferencesTable: string;
  ReferencesColumns: string[];
  OnDelete?: string;
  OnUpdate?: string;
};

/** Tables that will have entity SYNTHESIZED (without Model). SINGLE SOURCE — module.emitter
 *  forFeature, repository.emitter, naming.resolveTypeRef and relation synthesis
 *  (isSyntheticEntityTable) all stay consistent with this set.
 *
 *  SET (deterministic, FK closure):
 *   1) CORE: Tables pointed to by a Repository.EntityReference.
 *   2) CLOSURE: every Model-less Table linked via FK to a core Table (FK to it
 *      OR FK from it) — e.g. join/bridge tables
 *      (order_items: neither pointed by a repo nor has Model; but FKs to orders and
 *      products). Without @Entity for these, FK relations
 *      (orders -> @OneToMany(OrderItem)) cannot resolve and schema<->ORM scope is
 *      incomplete (migration exists, entity missing). Transitive closure via bidirectional FK.
 *
 *  Tables WITH Model are NEVER included (Model entity is emitted).
 *  graph.allOf sorted by name + fixed fixpoint -> deterministic. */
export function tablesNeedingSyntheticEntity(graph: CodeGraph): CodeNode[] {
  const ids = computeSyntheticEntityIds(graph);
  const out: CodeNode[] = [];
  for (const table of graph.allOf("Table")) {
    if (ids.has(table.id)) out.push(table);
  }
  return out;
}

/** Table ids that get synthetic entity (FK closure; deterministic). */
function computeSyntheticEntityIds(graph: CodeGraph): Set<string> {
  // Model-less Tables are candidates; those with Model excluded (Model entity emitted).
  const tables = graph.allOf("Table").filter((t) => !hasBackingModel(t, graph));
  const byTableName = new Map<string, CodeNode>();
  for (const t of tables) byTableName.set(t.name, t);

  // ── 1) CORE: repo-referenced Model-less Tables ──────────────────────
  const set = new Set<string>();
  for (const repo of graph.allOf("Repository")) {
    const ref = (repo.properties as Record<string, unknown>).EntityReference;
    if (typeof ref !== "string" || ref.length === 0) continue;
    const node = graph.resolveRef(["Model", "Table"], ref);
    if (node && node.kindOf() === "Table" && !hasBackingModel(node, graph)) {
      set.add(node.id);
    }
  }

  // ── 2) FK CLOSURE (transitive, bidirectional; among Model-less candidates) ────
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of tables) {
      // (a) t -> target FKs: if t in set add target; if target in set add t.
      const fks = (propsOf<"Table">(t).ForeignKeys ?? []) as ForeignKey[];
      for (const fk of fks) {
        const target = byTableName.get(fk.ReferencesTable);
        if (!target) continue;
        const tIn = set.has(t.id);
        const targetIn = set.has(target.id);
        if (tIn && !targetIn) {
          set.add(target.id);
          changed = true;
        } else if (targetIn && !tIn) {
          set.add(t.id);
          changed = true;
        }
      }
    }
  }

  return set;
}

/** Does a Model represent this Table via TableRef? (if yes Model entity
 *  is emitted; synthesis unnecessary.) */
function hasBackingModel(table: CodeNode, graph: CodeGraph): boolean {
  for (const m of graph.allOf("Model")) {
    const tableRef = (m.properties as Record<string, unknown>).TableRef;
    if (typeof tableRef === "string" && graph.resolveRef("Table", tableRef)?.id === table.id) {
      return true;
    }
  }
  return false;
}

/** Convert a Table node to SYNTHESIZED TypeORM entity file. */
export function emitSyntheticEntity(table: CodeNode, ctx: EmitterContext): GeneratedFile[] {
  const props = propsOf<"Table">(table);
  const className = entityClassNameForTable(table);
  const tableName = tableSqlName(table.name);
  const columns = (props.Columns ?? []) as Column[];

  const imports = new ImportCollector();
  imports.add("Column", "typeorm");
  imports.add("Entity", "typeorm");

  const pk = pickPrimaryKey(columns);

  // Reserve column names to avoid member name collisions; relation
  // properties added to this set (deterministic; conflicting relation SKIPPED).
  const usedNames = new Set<string>(columns.map((c) => c.Name));

  const fromPath = synthEntityFilePath(table, ctx.graph);
  const memberBlocks: string[] = [];
  for (const col of columns) {
    memberBlocks.push(renderColumn(col, col === pk, imports, ctx.graph, fromPath));
  }

  // RELATION SYNTHESIS (M2): TypeORM relation decorators from FKs. If other side
  // does not resolve to synthetic entity, relation not emitted (pure/deterministic).
  for (const block of synthesizeRelations(table, ctx.graph, imports, usedNames)) {
    memberBlocks.push(block);
  }

  const lines: string[] = [];
  if (props.Description) lines.push(`/** ${props.Description} (synthesized from Table) */`);
  else lines.push(`/** ${className} entity (synthesized from Table "${tableName}"). */`);
  lines.push(`@Entity(${JSON.stringify(tableName)})`);
  lines.push(`export class ${className} {`);
  lines.push(memberBlocks.join("\n\n"));
  lines.push("}");

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  const file: GeneratedFile = {
    path: synthEntityFilePath(table, ctx.graph),
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
}

/* ────────────────────────────────────────────────────────────────────────
 * RELATION SYNTHESIS (M2) — TypeORM @ManyToOne/@OneToMany from FKs.
 *
 * Owning side (@ManyToOne): for each SINGLE-COLUMN FK of this table when target
 *   resolves to a SYNTHETIC entity. @JoinColumn binds FK column.
 * Inverse (@OneToMany): for each OTHER synthetic entity with FK pointing to this table.
 *   Bidirectional: inverse function uses owning-side property name
 *   (same FK + same algorithm -> both sides derive SAME name).
 * Default { eager: false } (lazy:false; no auto-load -> no N+1).
 * PURITY: if other side is not synthetic entity (has Model / not repo-referenced / missing)
 *   relation SKIPPED. Multi-column (composite) FK SKIPPED (no single-column mapping).
 * ──────────────────────────────────────────────────────────────────────── */
function synthesizeRelations(
  table: CodeNode,
  graph: CodeGraph,
  imports: ImportCollector,
  usedNames: Set<string>,
): string[] {
  const fromPath = synthEntityFilePath(table, graph);
  const blocks: string[] = [];

  // ── Owning side: this table's FKs -> @ManyToOne ────────────────────────
  // owningRelationProps SINGLE SOURCE: same property names here (owning side) and
  // inverse direction -> consistent bidirectional.
  const ownCols = (propsOf<"Table">(table).Columns ?? []) as Column[];
  const fks = (propsOf<"Table">(table).ForeignKeys ?? []) as ForeignKey[];
  const ownProps = owningRelationProps(table, graph);
  for (let i = 0; i < fks.length; i++) {
    const prop = ownProps.get(i);
    if (!prop) continue; // FK not emitted (composite / not synthetic / collision)
    usedNames.add(prop);
    const fkCol = ownCols.find((c) => c.Name === (fks[i].Columns ?? [])[0]);
    // If FK column not NOT NULL, relation is optional (read from column schema).
    const nullable = fkCol ? fkCol.IsNotNull !== true : false;
    const ref = resolveSyntheticEntity(fks[i].ReferencesTable, graph)!;
    blocks.push(renderManyToOne(prop, ref, (fks[i].Columns ?? [])[0], nullable, graph, imports, fromPath));
  }

  // ── Inverse: OTHER synthetic entity FKs pointing to this table -> @OneToMany
  for (const other of graph.allOf("Table")) {
    if (other.id === table.id) continue;
    if (!isSyntheticEntityTable(other, graph)) continue;
    // Replay owning-side property names from other table with SAME loop
    // -> inverse (x) => x.<owningProp> stays consistent on both sides.
    const owningProps = owningRelationProps(other, graph);
    const otherFks = (propsOf<"Table">(other).ForeignKeys ?? []) as ForeignKey[];
    for (let i = 0; i < otherFks.length; i++) {
      const fk = otherFks[i];
      const cols = fk.Columns ?? [];
      if (cols.length !== 1) continue;
      const target = resolveSyntheticEntity(fk.ReferencesTable, graph);
      if (!target || target.id !== table.id) continue; // does not point to me
      const owningProp = owningProps.get(i);
      if (!owningProp) continue; // if not emitted on owning side, inverse not emitted either
      const prop = oneToManyPropName(other, usedNames);
      if (!prop) continue; // collision -> skip
      usedNames.add(prop);
      // AGGREGATE CASCADE: child->parent FK ON DELETE CASCADE means parent owns children
      // (aggregate) -> inverse @OneToMany ORM cascade:true (save parent persists children;
      // audit #11: children were not persisted). RESTRICT/
      // SET_NULL -> independent relation, cascade NONE.
      const cascade = (fk.OnDelete ?? "").toUpperCase() === "CASCADE";
      blocks.push(renderOneToMany(prop, other, owningProp, graph, imports, fromPath, cascade));
    }
  }

  return blocks;
}

/** Owning-side (@ManyToOne) property names this table EMITS, computed with EXACTLY
 *  the same algorithm as the owning-side loop: FK index -> property name.
 *  FKs not emitted (composite / other side not synthetic / collision) are NOT in map.
 *  Inverse (@OneToMany) uses this map ->
 *  both sides ALWAYS meet on same property name (deterministic bidirectional). */
function owningRelationProps(table: CodeNode, graph: CodeGraph): Map<number, string> {
  const out = new Map<number, string>();
  const cols = (propsOf<"Table">(table).Columns ?? []) as Column[];
  const used = new Set<string>(cols.map((c) => c.Name));
  const fks = (propsOf<"Table">(table).ForeignKeys ?? []) as ForeignKey[];
  for (let i = 0; i < fks.length; i++) {
    const fk = fks[i];
    if ((fk.Columns ?? []).length !== 1) continue;
    const ref = resolveSyntheticEntity(fk.ReferencesTable, graph);
    if (!ref || ref.id === table.id) continue;
    const prop = manyToOnePropName(fk, ref, used);
    if (!prop) continue;
    used.add(prop);
    out.set(i, prop);
  }
  return out;
}

/** Owning-side @ManyToOne property name: strip "id"/"_id" suffix from FK column,
 *  camelCase. Empty or collision -> fall back to target table singular name; if that
 *  collides too -> null (relation skipped). Deterministic (name + given set only). */
function manyToOnePropName(fk: ForeignKey, ref: CodeNode, used: Set<string>): string | null {
  const col = (fk.Columns ?? [])[0] ?? "";
  const stripped = col.replace(/_?[Ii]d$/, "");
  const candidates = [camelCase(stripped), camelCase(singularize(ref.name))];
  for (const c of candidates) {
    if (c.length > 0 && !used.has(c)) return c;
  }
  return null;
}

/** Inverse @OneToMany property name: plural-camelCase of owning table name.
 *  singularize then pluralize -> already-plural name not double-pluralized
 *  ("posts" -> "post" -> "posts"; "order_items" -> "order_item" -> "orderItems").
 *  Collision -> null. Deterministic. */
function oneToManyPropName(owning: CodeNode, used: Set<string>): string | null {
  const c = camelCase(pluralizeSnake(singularize(owning.name)));
  if (c.length > 0 && !used.has(c)) return c;
  return null;
}

/** @ManyToOne(() => Ref, { eager: false }) + @JoinColumn({ name: <fk_col> }). */
function renderManyToOne(
  prop: string,
  ref: CodeNode,
  fkColumn: string,
  nullable: boolean,
  graph: CodeGraph,
  imports: ImportCollector,
  fromPath: string,
): string {
  const refClass = entityClassNameForTable(ref);
  imports.add("JoinColumn", "typeorm");
  imports.add("ManyToOne", "typeorm");
  imports.add(refClass, importPathOf(relativeImportPath(fromPath, synthEntityFilePath(ref, graph))));
  // Nullable FK -> optional relation; otherwise required (definite-assignment "!").
  const optional = nullable ? "?" : "";
  const assertion = optional ? "" : "!";
  const out: string[] = [];
  out.push(`  @ManyToOne(() => ${refClass}, { eager: false${nullable ? ", nullable: true" : ""} })`);
  out.push(`  @JoinColumn({ name: ${JSON.stringify(snakeCase(fkColumn))} })`);
  out.push(`  ${prop}${optional}${assertion}: ${refClass};`);
  return out.join("\n");
}

/** @OneToMany(() => Other, (x) => x.<owningProp>). Collection -> definite-assignment
 *  "!" (compiles under strict). TypeORM forbids array initializer (= []) on relation
 *  properties (InitializedRelationError: breaks metadata build, migration/boot
 *  fails); so NO initializer, use "!" — same pattern as @ManyToOne. */
function renderOneToMany(
  prop: string,
  other: CodeNode,
  owningProp: string,
  graph: CodeGraph,
  imports: ImportCollector,
  fromPath: string,
  cascade: boolean,
): string {
  const otherClass = entityClassNameForTable(other);
  imports.add("OneToMany", "typeorm");
  imports.add(otherClass, importPathOf(relativeImportPath(fromPath, synthEntityFilePath(other, graph))));
  const param = inverseParamName(other);
  // AGGREGATE (FK ON DELETE CASCADE) -> { cascade: true } (save parent persists children).
  const opts = cascade ? ", { cascade: true }" : "";
  const out: string[] = [];
  out.push(`  @OneToMany(() => ${otherClass}, (${param}) => ${param}.${owningProp}${opts})`);
  out.push(`  ${prop}!: ${otherClass}[];`);
  return out.join("\n");
}

/** Inverse function parameter name: singular-camelCase of other entity
 *  (e.g. "posts" -> "post"). Empty -> "x". */
function inverseParamName(other: CodeNode): string {
  const p = camelCase(singularize(other.name));
  return p.length > 0 ? p : "x";
}

/** Does a type token / ref name resolve to a SYNTHETIC entity Table?
 *  (Model-less + repository-referenced.) Returns Table node if yes; else null. */
function resolveSyntheticEntity(refName: string, graph: CodeGraph): CodeNode | null {
  if (typeof refName !== "string" || refName.length === 0) return null;
  const node = graph.resolveRef("Table", refName);
  if (!node || node.kindOf() !== "Table") return null;
  return isSyntheticEntityTable(node, graph) ? node : null;
}

/** Does this Table emit a SYNTHETIC entity? Same set as tablesNeedingSyntheticEntity
 *  (repo-referenced core + FK closure). SINGLE SOURCE. */
function isSyntheticEntityTable(table: CodeNode, graph: CodeGraph): boolean {
  return computeSyntheticEntityIds(graph).has(table.id);
}

/** Prefer column named "id"; else first IsPrimaryKey column; else first column. */
function pickPrimaryKey(columns: Column[]): Column | null {
  const byId = columns.find((c) => c.Name.toLowerCase() === "id");
  if (byId) return byId;
  const flagged = columns.find((c) => c.IsPrimaryKey === true);
  if (flagged) return flagged;
  return columns.length > 0 ? columns[0] : null;
}

/** Single column -> decorated TypeORM field. ENUM column uses generated
 *  enum class as TS type (SAME as DTO) but @Column({ type: 'varchar' }) (no native
 *  enum — #56; migration also VARCHAR + CHECK). JSON -> Record<string, unknown> +
 *  'jsonb'. (sql-type-map SINGLE SOURCE.) */
function renderColumn(
  col: Column,
  isPrimaryKey: boolean,
  imports: ImportCollector,
  graph: CodeGraph,
  fromPath: string,
): string {
  const tsType = entityColumnTsType(col, graph, imports, fromPath);
  const out: string[] = [];
  if (isPrimaryKey) {
    imports.add("PrimaryGeneratedColumn", "typeorm");
    const isUuid = (col.DataType ?? "").toUpperCase() === "UUID";
    out.push(`  @PrimaryGeneratedColumn(${isUuid ? '"uuid"' : ""})`);
    out.push(`  ${fieldDecl(col, true, tsType)}`);
    return out.join("\n");
  }
  imports.add("Column", "typeorm");
  out.push(`  @Column(${columnOptions(col)})`);
  out.push(`  ${fieldDecl(col, false, tsType)}`);
  return out.join("\n");
}

/** Column TS type (ENUM -> generated enum class + import; JSON ->
 *  Record<string, unknown>; else sqlTypeToTs). */
function entityColumnTsType(
  col: Column,
  graph: CodeGraph,
  imports: ImportCollector,
  fromPath: string,
): string {
  return columnTsType(col.DataType, col.EnumRef, graph, (enumNode) => {
    const cls = pascalCase(enumNode.name);
    imports.add(cls, importPathOf(relativeImportPath(fromPath, filePathFor(enumNode, graph))));
    return cls;
  });
}

/** @Column({ ... }) options (deterministic). #56: ENUM column becomes VARCHAR
 *  (no native Postgres enum) -> CONSISTENT with migration (also VARCHAR + CHECK).
 *  TS field type (entityColumnTsType) is still generated enum class; DB-level
 *  value constraint is in migration CHECK constraint. */
function columnOptions(col: Column): string {
  const parts: string[] = [];
  const isEnumCol = (col.DataType ?? "").toUpperCase() === "ENUM";
  if (isEnumCol) {
    parts.push(`type: "varchar"`);
  } else {
    parts.push(`type: ${JSON.stringify(columnOrmType(col.DataType))}`);
  }
  if (col.IsNotNull !== true) parts.push("nullable: true");
  if (col.IsUnique === true) parts.push("unique: true");
  return `{ ${parts.join(", ")} }`;
}

/** TS field declaration: PK always required; else "?" when not NOT NULL.
 *  Required fields (no initializer) get definite-assignment "!" so compile under
 *  strict:true (strictPropertyInitialization) without TS2564
 *  — TypeORM/class-validator standard. Optional "?" fields untouched. */
function fieldDecl(col: Column, isPrimaryKey: boolean, tsType: string): string {
  const optional = !isPrimaryKey && col.IsNotNull !== true ? "?" : "";
  const assertion = optional ? "" : "!";
  // TS member name camelCase (Id→id, CustomerId→customerId); DB column name derived
  // separately as snakeCase + SnakeNamingStrategy maps member to same snake_case → no drift.
  return `${tsPropName(col.Name)}${optional}${assertion}: ${tsType};`;
}
