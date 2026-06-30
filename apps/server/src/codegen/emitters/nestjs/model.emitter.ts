import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeNode } from "../../ir";
import {
  filePathFor,
  pascalCase,
  camelCase,
  pluralizeSnake,
  tableSqlName,
  relativeImportPath,
  importPathOf,
  tsPropName,
  scalarTsType,
} from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers, notImplemented, surgicalMarker } from "../../surgical";
import { columnOrmType, sqlTypeToTs } from "./sql-type-map";

/* ────────────────────────────────────────────────────────────────────────
 * model.emitter.ts — ModelNode -> TypeORM entity.
 *
 * Sözleşme (enum.emitter.ts kanonik referansıyla birebir):
 *   - named `export const emitModel: NodeEmitter`; default export YOK.
 *   - SAF fonksiyon: (node, ctx) -> GeneratedFile[]. I/O yok, throw yok.
 *   - Yol her zaman filePathFor(node, ctx.graph) ile.
 *   - import'lar ImportCollector ile (elle "import ..." YASAK).
 *   - DETERMİNİSTİK: Properties/Methods verildiği sırada; ref çözümü ctx üzerinden.
 *   - surgicalMarkers countSurgicalMarkers(content) ile sayılır.
 *   - İçerik tek "\n" ile biter.
 *
 * ModelNode -> <feature>/entities/<kebab>.entity.ts.
 *   @Entity(<tablo adı>) — TableRef varsa o Table'ın fiziksel adı (tableSqlName,
 *     table.emitter ile TEK KAYNAK), yoksa ClassName'in pluralize snake hali.
 *   PK: "id" adlı property -> @PrimaryGeneratedColumn("uuid"); yoksa ilk property.
 *   RelationType + RelatedModelRef -> @OneToOne/@OneToMany/@ManyToOne/@ManyToMany
 *     (()=>Related) + import (ctx.resolveRef("Model", RelatedModelRef)).
 *     Ref çözülemezse ilişki satırı atlanır + // TODO yorumu (ASLA throw).
 *   Methods varsa imza + surgical gövde (NOT_IMPLEMENTED).
 * ──────────────────────────────────────────────────────────────────────── */

type ModelProps = ReturnType<typeof propsOf<"Model">>;
type ModelProperty = ModelProps["Properties"][number];
type ModelMethod = ModelProps["Methods"][number];

const RELATION_DECORATOR: Record<string, string> = {
  OneToOne: "OneToOne",
  OneToMany: "OneToMany",
  ManyToOne: "ManyToOne",
  ManyToMany: "ManyToMany",
};

export const emitModel: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"Model">(node);
  const className = pascalCase(node.name);
  const fromPath = filePathFor(node, ctx.graph);

  const imports = new ImportCollector();
  // TypeORM çekirdek dekoratörleri — Entity + Column her zaman gerekli.
  imports.add("Column", "typeorm");
  imports.add("Entity", "typeorm");

  const tableName = resolveTableName(props, node, ctx);

  // PK seçimi: "id" adlı property öncelik; yoksa ilk property.
  const pkProperty = pickPrimaryKey(props.Properties);

  const lines: string[] = [];
  if (props.Description) lines.push(`/** ${props.Description} */`);
  lines.push(`@Entity(${JSON.stringify(tableName)})`);
  lines.push(`export class ${className} {`);

  const memberBlocks: string[] = [];

  for (const p of props.Properties) {
    const block = renderProperty(p, p === pkProperty, className, node, ctx, imports, fromPath);
    if (block) memberBlocks.push(block);
  }

  for (const m of props.Methods ?? []) {
    memberBlocks.push(renderMethod(m, className, node));
  }

  // Üyeler arasında bir boş satır (deterministik).
  lines.push(memberBlocks.join("\n\n"));
  lines.push("}");

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  const file: GeneratedFile = {
    path: fromPath,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
};

/** @Entity tablosu adı. TEK KAYNAK: tableSqlName — table.emitter'ın
 *  `CREATE TABLE` adıyla BİREBİR aynı (aksi halde entity var olmayan bir tabloya
 *  bağlanır). Deterministik.
 *   - TableRef çözülürse -> tableSqlName(table.name)  (table emitter ile aynı).
 *   - TableRef var ama çözülmezse -> ham ref'i fiziksel ad say (tableSqlName).
 *   - TableRef yoksa -> ClassName'den tablo adı TÜRET (pluralizeSnake): açık
 *     TableName olmadığı için "User" -> "users", "OrderItem" -> "order_items".
 *     Bu, böyle bir Table node'u eklendiğinde table.emitter'ın üreteceği adla
 *     tutarlıdır (kullanıcı tabloyu doğal/çoğul TableName ile adlandırır). */
function resolveTableName(props: ModelProps, node: CodeNode, ctx: Parameters<NodeEmitter>[1]): string {
  if (props.TableRef) {
    const table = ctx.graph.resolveRef("Table", props.TableRef);
    if (table) return tableSqlName(table.name);
    // Ref çözülemedi: yine de niyeti koru (ham ref'i fiziksel ad say).
    return tableSqlName(props.TableRef);
  }
  // Açık tablo yok -> class adından tablo adı türet (çoğullanır).
  return pluralizeSnake(node.name);
}

/** "id" adlı property öncelik; yoksa ilk property (varsa). */
function pickPrimaryKey(properties: ModelProperty[]): ModelProperty | null {
  const byId = properties.find((p) => p.Name.toLowerCase() === "id");
  if (byId) return byId;
  return properties.length > 0 ? properties[0] : null;
}

/** Tek bir property -> dekoratörlü alan (ilişki ise @OneToMany... + import). */
function renderProperty(
  p: ModelProperty,
  isPrimaryKey: boolean,
  className: string,
  node: CodeNode,
  ctx: Parameters<NodeEmitter>[1],
  imports: ImportCollector,
  fromPath: string,
): string | null {
  // İlişki property'si.
  if (p.RelationType && p.RelatedModelRef) {
    return renderRelation(p, className, node, ctx, imports, fromPath);
  }

  const out: string[] = [];
  if (isPrimaryKey) {
    imports.add("PrimaryGeneratedColumn", "typeorm");
    // id alanı uuid varsayımı; aksi halde sıradan PK üretici.
    const isUuid = p.Name.toLowerCase() === "id";
    out.push(`  @PrimaryGeneratedColumn(${isUuid ? '"uuid"' : ""})`);
    out.push(`  ${fieldDeclaration(p, ctx)}`);
    return out.join("\n");
  }

  out.push(`  @Column(${columnOptions(p, ctx, imports, fromPath)})`);
  out.push(`  ${fieldDeclaration(p, ctx)}`);
  return out.join("\n");
}

/** İlişki dekoratörü + import + alan bildirimi. Ref çözülemezse TODO ile atla. */
function renderRelation(
  p: ModelProperty,
  className: string,
  node: CodeNode,
  ctx: Parameters<NodeEmitter>[1],
  imports: ImportCollector,
  fromPath: string,
): string | null {
  const decorator = RELATION_DECORATOR[p.RelationType as string];
  if (!decorator) return null;

  const related = ctx.graph.resolveRef("Model", p.RelatedModelRef as string);
  if (!related) {
    // Kayıp ref: ilişkiyi koy, ama type-safe import yok -> TODO + atla.
    return `  // TODO: relation "${tsPropName(p.Name)}" (${p.RelationType} -> ${p.RelatedModelRef}) — reference could not be resolved`;
  }

  const relatedClass = pascalCase(related.name);
  // TypeORM OneToMany'de inverseSide ZORUNLU (tek-arg @OneToMany TS2554 verir).
  // PropertySchema'da InverseSide alanı yok → ilişkili Model'de BU Model'e geri-dönen
  // @ManyToOne'ı bul ve `(r) => r.<prop>` ters-yönünü ÜRET. Karşılıklı ManyToOne yoksa
  // çıkarsanamaz → TODO bırak. OneToOne/ManyToMany'de inverseSide opsiyonel → dokunma.
  if (decorator === "OneToMany") {
    const inverse = findInverseManyToOne(related, node, ctx);
    if (!inverse) {
      return `  // TODO: relation "${tsPropName(p.Name)}" (OneToMany -> ${p.RelatedModelRef}) — inverse side required (no reciprocal @ManyToOne found); add manually`;
    }
    imports.add(decorator, "typeorm");
    if (related.id !== node.id) {
      imports.add(relatedClass, importPathOf(relativeImportPath(fromPath, filePathFor(related, ctx.graph))));
    }
    const inverseVar = camelCase(related.name);
    const inverseProp = tsPropName(inverse.Name);
    const optional = p.IsNullable ? "?" : "";
    const assertion = optional ? "" : "!";
    const out: string[] = [];
    out.push(`  @OneToMany(() => ${relatedClass}, (${inverseVar}) => ${inverseVar}.${inverseProp})`);
    out.push(`  ${tsPropName(p.Name)}${optional}${assertion}: ${relatedClass}[];`);
    return out.join("\n");
  }
  imports.add(decorator, "typeorm");
  // İlişki tipini import et (kendi kendine ilişki ise import gerekmez).
  if (related.id !== node.id) {
    imports.add(relatedClass, importPathOf(relativeImportPath(fromPath, filePathFor(related, ctx.graph))));
  }

  const tsType = p.IsCollection || p.RelationType === "OneToMany" || p.RelationType === "ManyToMany"
    ? `${relatedClass}[]`
    : relatedClass;
  const optional = p.IsNullable ? "?" : "";
  // Zorunlu ilişki alanları da definite-assignment "!" alır (strict:true).
  const assertion = optional ? "" : "!";

  const out: string[] = [];
  out.push(`  @${decorator}(() => ${relatedClass})`);
  out.push(`  ${tsPropName(p.Name)}${optional}${assertion}: ${tsType};`);
  return out.join("\n");
}

/** OneToMany ters-yönü: ilişkili Model'in property'lerinde, BU Model'e (owner)
 *  geri-dönen @ManyToOne'ı ara. TypeORM `@OneToMany(() => R, r => r.<owner>)`
 *  ister; karşılıklı ManyToOne yoksa ters-yön çıkarsanamaz → null (çağıran TODO bırakır).
 *  Deterministik: yalnız graf ref çözümü, I/O yok. */
function findInverseManyToOne(
  related: CodeNode,
  owner: CodeNode,
  ctx: Parameters<NodeEmitter>[1],
): ModelProperty | null {
  let relatedProps: ModelProps;
  try {
    relatedProps = propsOf<"Model">(related);
  } catch {
    return null; // related bir Model değilse (sentezlenmiş/Table) ters-yön okunamaz
  }
  for (const rp of relatedProps.Properties ?? []) {
    if (rp.RelationType !== "ManyToOne" || !rp.RelatedModelRef) continue;
    const back = ctx.graph.resolveRef("Model", rp.RelatedModelRef);
    if (back?.id === owner.id) return rp;
  }
  return null;
}

/** @Column({ ... }) seçenekleri (deterministik anahtar sırası). columnOrmType
 *  (sql-type-map TEK KAYNAK) ile entity/Table ile tutarlı fiziksel tip. */
function columnOptions(
  p: ModelProperty,
  ctx: Parameters<NodeEmitter>[1],
  imports: ImportCollector,
  fromPath: string,
): string {
  const parts: string[] = [];
  // Enum-tipli kolon (#56): Type bir Enum node'una çözülürse @Column VARCHAR olur
  // (native Postgres enum DEĞİL) -> migration de VARCHAR + CHECK üretir, TUTARLI.
  // cls yine import edilir çünkü TS alan tipi (fieldDeclaration) generated enum sınıfıdır;
  // DB-seviyesi değer kısıtı migration'daki CHECK constraint'tedir.
  const enumNode = ctx.graph.resolveRef("Enum", p.Type);
  if (enumNode) {
    const cls = pascalCase(enumNode.name);
    imports.add(cls, importPathOf(relativeImportPath(fromPath, filePathFor(enumNode, ctx.graph))));
    parts.push(`type: "varchar"`);
  } else {
    parts.push(`type: ${JSON.stringify(columnOrmType(p.Type))}`);
  }
  if (p.IsNullable) parts.push("nullable: true");
  return `{ ${parts.join(", ")} }`;
}

/** TypeScript alan bildirimi: "name: Type;" (nullable -> "?").
 *  Zorunlu (initializer'sız) alanlar definite-assignment "!" alır; strict:true
 *  (strictPropertyInitialization) altında TS2564 vermeden derlenir — TypeORM
 *  standardı. Opsiyonel "?" alanlar dokunulmaz. */
function fieldDeclaration(p: ModelProperty, ctx: Parameters<NodeEmitter>[1]): string {
  const optional = p.IsNullable ? "?" : "";
  const assertion = optional ? "" : "!";
  // Enum-tipli alan: Type bir Enum node'una çözülürse o sınıfı TS tipi yap
  // (import @Column adımında eklendi). Aksi halde serbest string olduğu gibi geçer.
  const enumNode = ctx.graph.resolveRef("Enum", p.Type);
  const base = enumNode ? pascalCase(enumNode.name) : sqlTypeToTs(p.Type, false);
  const tsType = p.IsCollection ? `${base}[]` : base;
  return `${tsPropName(p.Name)}${optional}${assertion}: ${tsType};`;
}

/** Bir method -> imza + surgical gövde (NOT_IMPLEMENTED). */
function renderMethod(m: ModelMethod, className: string, node: CodeNode): string {
  const visibility = m.Visibility && m.Visibility !== "public" ? `${m.Visibility} ` : "";
  const staticKw = m.IsStatic ? "static " : "";
  const asyncKw = m.IsAsync ? "async " : "";
  const params = (m.Parameters ?? [])
    .map((param) => {
      const opt = param.Optional ? "?" : "";
      const def = param.Default !== undefined && param.Default !== "" ? ` = ${param.Default}` : "";
      return `${param.Name}${opt}: ${scalarTsType(param.Type)}${def}`;
    })
    .join(", ");
  const ret = scalarTsType(m.ReturnType);
  const signature = `  ${visibility}${staticKw}${asyncKw}${m.MethodName}(${params}): ${ret} {`;

  const marker = surgicalMarker({ nodeId: node.id, member: m.MethodName });
  const markerLines = marker
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");

  return [signature, markerLines, `    ${notImplemented(className, m.MethodName)}`, "  }"].join("\n");
}
