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

// Entity isim/yol TEK KAYNAĞI naming.ts'tedir (resolveTypeRef de oraya bağımlı);
// geriye-uyum için buradan re-export edilir.
export { entityClassNameForTable, synthEntityFilePath };

/* ────────────────────────────────────────────────────────────────────────
 * entity-synthesis.ts — Table'dan SENTEZLENEN TypeORM entity.
 *
 * MİMARİ-FARKINDA BOOT GARANTİSİ: Gerçek graph'larda çoğu zaman Model node YOK,
 * yalnız Table node'ları vardır (Users/GeneratedImages -> migrations/*.sql). Bir
 * Repository.EntityReference bir Table'a işaret ettiğinde, repository.emitter
 * `@InjectRepository(Entity)`/`Repository<Entity>` üretir ve module.emitter
 * `TypeOrmModule.forFeature([Entity])` ekler. Eğer ortada TypeORM @Entity sınıfı
 * YOKSA NestJS DI bootta `Repository<Entity>` provider'ını çözemez ve uygulama
 * AÇILMAZ. Bu modül, Model'i olmayan ama bir Repository tarafından REFERANS
 * EDİLEN her Table için Table şemasından deterministik bir @Entity sınıfı üretir.
 *
 * TEK KAYNAK kuralları:
 *   - Sınıf adı: entityClassNameForTable(table) — Model<->Table çakışması olmasın
 *     diye tablo adının tekil-pascal hali (UsersTable.name="users" -> "User";
 *     "generated_images" -> "GeneratedImage"). Repository.emitter aynı adı kullanır.
 *   - @Entity(<ad>): tableSqlName(table.name) — table.emitter'ın `CREATE TABLE`
 *     adıyla BİREBİR aynı (entity hiç var olmayan bir tabloya bağlanmaz).
 *   - Dosya yolu: synthEntityFilePath(table, graph) — <feature>/entities/<kebab>.entity.ts
 *     (Model entity yoluyla aynı düzen; aynı feature'da Model varsa zaten Model
 *     dosyası üretilir — orchestrator yalnız Model'i OLMAYAN Table'lar için sentezler).
 *
 * İLİŞKİ SENTEZİ (M2): Table'da @OneToMany/@ManyToOne YOKTUR; yalnız SQL FK'leri
 *   vardır. Entity'de ilişki dekoratörü olmadan N+1/lazy kararı tümüyle
 *   surgical'a kalır. Bu modül, Table'ın ForeignKeys'inden TypeORM ilişkilerini
 *   DETERMİNİSTİK sentezler:
 *     - FK (bu tablo -> hedef) -> sahip taraf @ManyToOne(() => Hedef) + @JoinColumn.
 *     - Ters yön (başka tablo -> bu tablo) -> @OneToMany(() => Diğer, x => x.<owning>).
 *   Varsayılan eager:false / lazy:false (otomatik yükleme YOK; N+1 patlamasın).
 *   SAFLIK KURALI: bir ilişki YALNIZ karşı-taraf da bir SENTETİK entity'ye
 *   (Model'siz + repository-referanslı Table) çözülürse üretilir. Karşı taraf
 *   çözülemiyorsa (Model'li, repository-referanssız ya da yok) ilişki HİÇ
 *   üretilmez — var olmayan bir sınıfı import edip derlemeyi KIRMAMAK için.
 *   Bidirectional @OneToMany, sahip-taraf property adını (FK kolonundan
 *   deterministik türetilir) inverse fonksiyonunda kullanır.
 *
 * SAF + DETERMİNİSTİK: kolonlar verilen sırada, ilişkiler FK sırasında
 * (ManyToOne) sonra hedef-tablo isim sırasında (OneToMany), import'lar
 * ImportCollector ile, timestamp/random yok, içerik tek "\n" ile biter. İlişki
 * gövdesi YOKTUR -> surgical marker üretmez.
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

/** Entity SENTEZLENECEK Table'lar (Model'i OLMAYAN). TEK KAYNAK — module.emitter
 *  forFeature, repository.emitter, naming.resolveTypeRef ve ilişki sentezi
 *  (isSyntheticEntityTable) hepsi bu kümeyle tutarlı kalır.
 *
 *  KÜME (deterministik, FK kapanışı):
 *   1) ÇEKİRDEK: bir Repository.EntityReference ile gösterilen Table'lar.
 *   2) KAPANIŞ: çekirdekteki bir Table ile bir FK üzerinden bağlı (ona FK veren
 *      VEYA ondan FK alan) HER Model'siz Table — örn. join/ara tablolar
 *      (order_items: ne bir repo gösterir ne de Model'i vardır; ama orders ve
 *      products'a FK verir). Bunlar için de @Entity üretilmezse FK ilişkileri
 *      (orders -> @OneToMany(OrderItem)) çözülemez ve şema<->ORM kapsamı eksik
 *      kalırdı (migration var, entity yok). Çift-yönlü FK ile transitif kapanır.
 *
 *  Model'i OLAN Table'lar HİÇBİR durumda dahil edilmez (Model entity üretilir).
 *  graph.allOf isme sıralı + sabit fixpoint -> deterministik. */
export function tablesNeedingSyntheticEntity(graph: CodeGraph): CodeNode[] {
  const ids = computeSyntheticEntityIds(graph);
  const out: CodeNode[] = [];
  for (const table of graph.allOf("Table")) {
    if (ids.has(table.id)) out.push(table);
  }
  return out;
}

/** Sentetik entity üretilecek Table id'leri (FK kapanışı; deterministik). */
function computeSyntheticEntityIds(graph: CodeGraph): Set<string> {
  // Model'siz Table'lar aday; Model'i olanlar dışlanır (Model entity üretilir).
  const tables = graph.allOf("Table").filter((t) => !hasBackingModel(t, graph));
  const byTableName = new Map<string, CodeNode>();
  for (const t of tables) byTableName.set(t.name, t);

  // ── 1) ÇEKİRDEK: repo-referanslı Model'siz Table'lar ──────────────────────
  const set = new Set<string>();
  for (const repo of graph.allOf("Repository")) {
    const ref = (repo.properties as Record<string, unknown>).EntityReference;
    if (typeof ref !== "string" || ref.length === 0) continue;
    const node = graph.resolveRef(["Model", "Table"], ref);
    if (node && node.kindOf() === "Table" && !hasBackingModel(node, graph)) {
      set.add(node.id);
    }
  }

  // ── 2) FK KAPANIŞI (transitif, çift-yönlü; Model'siz aday'lar arasında) ────
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of tables) {
      // (a) t -> hedef FK'leri: t kümedeyse hedef de eklenir; hedef kümedeyse t.
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

/** Bu Table'ı TableRef ile temsil eden bir Model var mı? (varsa Model entity
 *  üretilir; sentez gereksiz.) */
function hasBackingModel(table: CodeNode, graph: CodeGraph): boolean {
  for (const m of graph.allOf("Model")) {
    const tableRef = (m.properties as Record<string, unknown>).TableRef;
    if (typeof tableRef === "string" && graph.resolveRef("Table", tableRef)?.id === table.id) {
      return true;
    }
  }
  return false;
}

/** Bir Table node'unu SENTEZLENEN TypeORM entity dosyasına çevirir. */
export function emitSyntheticEntity(table: CodeNode, ctx: EmitterContext): GeneratedFile[] {
  const props = propsOf<"Table">(table);
  const className = entityClassNameForTable(table);
  const tableName = tableSqlName(table.name);
  const columns = (props.Columns ?? []) as Column[];

  const imports = new ImportCollector();
  imports.add("Column", "typeorm");
  imports.add("Entity", "typeorm");

  const pk = pickPrimaryKey(columns);

  // Üye adı çakışmalarını önlemek için kolon adları rezerve edilir; ilişki
  // property'leri bu kümeye eklenir (deterministik; çakışan ilişki ATLANIR).
  const usedNames = new Set<string>(columns.map((c) => c.Name));

  const fromPath = synthEntityFilePath(table, ctx.graph);
  const memberBlocks: string[] = [];
  for (const col of columns) {
    memberBlocks.push(renderColumn(col, col === pk, imports, ctx.graph, fromPath));
  }

  // İLİŞKİ SENTEZİ (M2): FK'lerden TypeORM ilişki dekoratörleri. Karşı taraf
  // bir sentetik entity'ye çözülmezse ilişki üretilmez (saf/deterministik).
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
 * İLİŞKİ SENTEZİ (M2) — FK'lerden TypeORM @ManyToOne/@OneToMany.
 *
 * Sahip taraf (@ManyToOne): bu tablonun her TEK-KOLON FK'si için, hedef tablo
 *   bir SENTETİK entity'ye çözülürse. @JoinColumn FK kolonunu bağlar.
 * Ters yön (@OneToMany): bu tabloya işaret eden FK'si olan her DİĞER sentetik
 *   entity için. Bidirectional: inverse fonksiyonu sahip-taraf property adını
 *   kullanır (aynı FK + aynı algoritma -> iki taraf da AYNI adı türetir).
 * Varsayılan { eager: false } (lazy:false; otomatik yükleme yok -> N+1 yok).
 * SAFLIK: karşı taraf sentetik entity değilse (Model'li / repo-referanssız / yok)
 *   ilişki ATLANIR. Çoklu-kolon (composite) FK ATLANIR (tek-kolon eşleme yapılamaz).
 * ──────────────────────────────────────────────────────────────────────── */
function synthesizeRelations(
  table: CodeNode,
  graph: CodeGraph,
  imports: ImportCollector,
  usedNames: Set<string>,
): string[] {
  const fromPath = synthEntityFilePath(table, graph);
  const blocks: string[] = [];

  // ── Sahip taraf: bu tablonun FK'leri -> @ManyToOne ────────────────────────
  // owningRelationProps TEK KAYNAK: hem burada (sahip taraf) hem ters yönde
  // (inverse fonksiyonu) AYNI property adlarını kullanır -> tutarlı bidirectional.
  const ownCols = (propsOf<"Table">(table).Columns ?? []) as Column[];
  const fks = (propsOf<"Table">(table).ForeignKeys ?? []) as ForeignKey[];
  const ownProps = owningRelationProps(table, graph);
  for (let i = 0; i < fks.length; i++) {
    const prop = ownProps.get(i);
    if (!prop) continue; // üretilmeyen FK (composite / sentetik değil / çakışma)
    usedNames.add(prop);
    const fkCol = ownCols.find((c) => c.Name === (fks[i].Columns ?? [])[0]);
    // FK kolonu NOT NULL değilse ilişki opsiyoneldir (kolon şemasından okunur).
    const nullable = fkCol ? fkCol.IsNotNull !== true : false;
    const ref = resolveSyntheticEntity(fks[i].ReferencesTable, graph)!;
    blocks.push(renderManyToOne(prop, ref, (fks[i].Columns ?? [])[0], nullable, graph, imports, fromPath));
  }

  // ── Ters yön: bu tabloya işaret eden DİĞER sentetik entity FK'leri -> @OneToMany
  for (const other of graph.allOf("Table")) {
    if (other.id === table.id) continue;
    if (!isSyntheticEntityTable(other, graph)) continue;
    // Karşı tablonun ürettiği sahip-taraf property adlarını AYNI loop'la replay
    // et -> inverse fonksiyonu (x) => x.<owningProp> iki tarafta da tutarlı kalır.
    const owningProps = owningRelationProps(other, graph);
    const otherFks = (propsOf<"Table">(other).ForeignKeys ?? []) as ForeignKey[];
    for (let i = 0; i < otherFks.length; i++) {
      const fk = otherFks[i];
      const cols = fk.Columns ?? [];
      if (cols.length !== 1) continue;
      const target = resolveSyntheticEntity(fk.ReferencesTable, graph);
      if (!target || target.id !== table.id) continue; // bana işaret etmiyor
      const owningProp = owningProps.get(i);
      if (!owningProp) continue; // sahip tarafta üretilmediyse ters yön de üretilmez
      const prop = oneToManyPropName(other, usedNames);
      if (!prop) continue; // çakışma -> atla
      usedNames.add(prop);
      // AGGREGATE CASCADE: çocuk->ebeveyn FK'si ON DELETE CASCADE ise ebeveyn çocukları
      // SAHİPLENİR (aggregate) -> ters @OneToMany'de ORM cascade:true (save ebeveyni
      // yazınca çocuklar da yazılır; audit #11: çocuklar persist edilmiyordu). RESTRICT/
      // SET_NULL -> bağımsız ilişki, cascade YOK.
      const cascade = (fk.OnDelete ?? "").toUpperCase() === "CASCADE";
      blocks.push(renderOneToMany(prop, other, owningProp, graph, imports, fromPath, cascade));
    }
  }

  return blocks;
}

/** Bir tablonun ÜRETTİĞİ sahip-taraf (@ManyToOne) property adlarını, sahip-taraf
 *  loop'uyla BİREBİR aynı algoritmayla hesaplar: FK index -> property adı.
 *  Üretilmeyen (composite / karşı taraf sentetik değil / çakışan) FK'ler haritada
 *  YER ALMAZ. Ters yön (@OneToMany) inverse fonksiyonu bu haritayı kullanır ->
 *  iki taraf DAİMA aynı property adında buluşur (deterministik bidirectional). */
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

/** Sahip-taraf @ManyToOne property adı: FK kolonundan "id"/"_id" eki atılıp
 *  camelCase. Boş ya da çakışan -> hedef tablo tekil adına düş; o da çakışırsa
 *  null (ilişki atlanır). Deterministik (yalnız ad + verilen küme). */
function manyToOnePropName(fk: ForeignKey, ref: CodeNode, used: Set<string>): string | null {
  const col = (fk.Columns ?? [])[0] ?? "";
  const stripped = col.replace(/_?[Ii]d$/, "");
  const candidates = [camelCase(stripped), camelCase(singularize(ref.name))];
  for (const c of candidates) {
    if (c.length > 0 && !used.has(c)) return c;
  }
  return null;
}

/** Ters-yön @OneToMany property adı: sahip tablo adının çoğul-camelCase hali.
 *  Önce singularize sonra pluralize -> zaten çoğul ad TEKRAR çoğullanmaz
 *  ("posts" -> "post" -> "posts"; "order_items" -> "order_item" -> "orderItems").
 *  Çakışan -> null. Deterministik. */
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
  // Nullable FK -> opsiyonel ilişki; aksi halde zorunlu (definite-assignment "!").
  const optional = nullable ? "?" : "";
  const assertion = optional ? "" : "!";
  const out: string[] = [];
  out.push(`  @ManyToOne(() => ${refClass}, { eager: false${nullable ? ", nullable: true" : ""} })`);
  out.push(`  @JoinColumn({ name: ${JSON.stringify(snakeCase(fkColumn))} })`);
  out.push(`  ${prop}${optional}${assertion}: ${refClass};`);
  return out.join("\n");
}

/** @OneToMany(() => Other, (x) => x.<owningProp>). Koleksiyon -> definite-assignment
 *  "!" (strict altında derlenir). TypeORM ilişki property'lerinde dizi initializer'ı
 *  (= []) YASAKLAR (InitializedRelationError: metadata build'i bozar, migration/boot
 *  patlar); bu yüzden initializer YOK, "!" KULLANILIR — @ManyToOne ile aynı desen. */
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
  // AGGREGATE (FK ON DELETE CASCADE) -> { cascade: true } (save ebeveyni çocuklarla persist).
  const opts = cascade ? ", { cascade: true }" : "";
  const out: string[] = [];
  out.push(`  @OneToMany(() => ${otherClass}, (${param}) => ${param}.${owningProp}${opts})`);
  out.push(`  ${prop}!: ${otherClass}[];`);
  return out.join("\n");
}

/** Inverse-fonksiyon parametre adı: karşı entity'nin tekil-camelCase'i
 *  (ör. "posts" -> "post"). Boşsa "x". */
function inverseParamName(other: CodeNode): string {
  const p = camelCase(singularize(other.name));
  return p.length > 0 ? p : "x";
}

/** Bir tip token'ı / ref ismi bir SENTETİK entity Table'ına çözülüyor mu?
 *  (Model'siz + repository-referanslı.) Çözülürse Table node döner; aksi null. */
function resolveSyntheticEntity(refName: string, graph: CodeGraph): CodeNode | null {
  if (typeof refName !== "string" || refName.length === 0) return null;
  const node = graph.resolveRef("Table", refName);
  if (!node || node.kindOf() !== "Table") return null;
  return isSyntheticEntityTable(node, graph) ? node : null;
}

/** Bu Table bir SENTETİK entity üretiyor mu? tablesNeedingSyntheticEntity ile
 *  AYNI küme (repo-referanslı çekirdek + FK kapanışı). TEK KAYNAK. */
function isSyntheticEntityTable(table: CodeNode, graph: CodeGraph): boolean {
  return computeSyntheticEntityIds(graph).has(table.id);
}

/** "id" adlı kolon öncelik; yoksa IsPrimaryKey olan ilk kolon; yoksa ilk kolon. */
function pickPrimaryKey(columns: Column[]): Column | null {
  const byId = columns.find((c) => c.Name.toLowerCase() === "id");
  if (byId) return byId;
  const flagged = columns.find((c) => c.IsPrimaryKey === true);
  if (flagged) return flagged;
  return columns.length > 0 ? columns[0] : null;
}

/** Tek bir kolon -> dekoratörlü TypeORM alanı. ENUM kolonu TS tipi olarak generated
 *  enum sınıfını kullanır (DTO ile AYNI) ama @Column({ type: 'varchar' }) ile (native
 *  enum DEĞİL — #56; migration de VARCHAR + CHECK). JSON -> Record<string, unknown> +
 *  'jsonb'. (sql-type-map TEK KAYNAK.) */
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

/** Bir kolonun TS tipi (ENUM -> generated enum sınıfı + import; JSON ->
 *  Record<string, unknown>; aksi sqlTypeToTs). */
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

/** @Column({ ... }) seçenekleri (deterministik). #56: ENUM kolonu VARCHAR olur
 *  (native Postgres enum DEĞİL) -> migration ile TUTARLI (o da VARCHAR + CHECK).
 *  TS alan tipi (entityColumnTsType) yine generated enum sınıfıdır; DB-seviyesi
 *  değer kısıtı migration'daki CHECK constraint'tedir. */
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

/** TS alan bildirimi: PK her zaman zorunlu; aksi NOT NULL değilse "?".
 *  Zorunlu (initializer'sız) alanlar definite-assignment "!" alır; böylece
 *  strict:true (strictPropertyInitialization) altında da TS2564 vermeden derlenir
 *  — TypeORM/class-validator standardı. Opsiyonel "?" alanlar dokunulmaz. */
function fieldDecl(col: Column, isPrimaryKey: boolean, tsType: string): string {
  const optional = !isPrimaryKey && col.IsNotNull !== true ? "?" : "";
  const assertion = optional ? "" : "!";
  // TS üye adı camelCase (Id→id, CustomerId→customerId); DB kolon adı snakeCase ile
  // ayrı türetilir + SnakeNamingStrategy member'ı aynı snake_case'e indirir → drift yok.
  return `${tsPropName(col.Name)}${optional}${assertion}: ${tsType};`;
}
