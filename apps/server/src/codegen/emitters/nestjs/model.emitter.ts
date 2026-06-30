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
 * Sozlesme (enum.emitter.ts kanonik referansiyla birebir):
 *   - named `export const emitModel: NodeEmitter`; default export NONE.
 *   - SAF fonksiyon: (node, ctx) -> GeneratedFile[]. I/O yok, throw yok.
 *   - Yol her zaman filePathFor(node, ctx.graph) ile.
 *   - import'lar ImportCollector ile (elle "import ..." YASAK).
 *   - DETERMINISTIC: Properties/Methods verildigi sirada; ref cozumu ctx uzerinden.
 *   - surgicalMarkers countSurgicalMarkers(content) ile sayilir.
 *   - Icerik tek "\n" ile biter.
 *
 * ModelNode -> <feature>/entities/<kebab>.entity.ts.
 *   @Entity(<tablo adi>) — TableRef varsa o Table'in fiziksel adi (tableSqlName,
 *     table.emitter ile TEK SOURCE), yoksa ClassName'in pluralize snake hali.
 *   PK: "id" adli property -> @PrimaryGeneratedColumn("uuid"); yoksa ilk property.
 *   RelationType + RelatedModelRef -> @OneToOne/@OneToMany/@ManyToOne/@ManyToMany
 *     (()=>Related) + import (ctx.resolveRef("Model", RelatedModelRef)).
 *     Ref cozulemezse iliski satiri atlanir + // TODO yorumu (ASLA throw).
 *   Methods varsa imza + surgical govde (NOT_IMPLEMENTED).
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
  // TypeORM cekirdek dekoratorleri — Entity + Column her zaman gerekli.
  imports.add("Column", "typeorm");
  imports.add("Entity", "typeorm");

  const tableName = resolveTableName(props, node, ctx);

  // PK secimi: "id" adli property oncelik; yoksa ilk property.
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

  // Uyeler arasinda bir bos satir (deterministik).
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

/** @Entity tablosu adi. TEK SOURCE: tableSqlName — table.emitter'in
 *  `CREATE TABLE` adiyla BIREBIR ayni (aksi halde entity var olmayan bir tabloya
 *  baglanir). Deterministik.
 *   - TableRef cozulurse -> tableSqlName(table.name)  (table emitter ile ayni).
 *   - TableRef var ama cozulmezse -> ham ref'i fiziksel ad say (tableSqlName).
 *   - TableRef yoksa -> ClassName'den tablo adi TURET (pluralizeSnake): acik
 *     TableName olmadigi icin "User" -> "users", "OrderItem" -> "order_items".
 *     Bu, boyle bir Table node'u eklendiginde table.emitter'in uretecegi adla
 *     tutarlidir (kullanici tabloyu dogal/cogul TableName ile adlandirir). */
function resolveTableName(props: ModelProps, node: CodeNode, ctx: Parameters<NodeEmitter>[1]): string {
  if (props.TableRef) {
    const table = ctx.graph.resolveRef("Table", props.TableRef);
    if (table) return tableSqlName(table.name);
    // Ref cozulemedi: yine de niyeti koru (ham ref'i fiziksel ad say).
    return tableSqlName(props.TableRef);
  }
  // Acik tablo yok -> class adindan tablo adi turet (cogullanir).
  return pluralizeSnake(node.name);
}

/** "id" adli property oncelik; yoksa ilk property (varsa). */
function pickPrimaryKey(properties: ModelProperty[]): ModelProperty | null {
  const byId = properties.find((p) => p.Name.toLowerCase() === "id");
  if (byId) return byId;
  return properties.length > 0 ? properties[0] : null;
}

/** Tek bir property -> dekoratorlu alan (iliski ise @OneToMany... + import). */
function renderProperty(
  p: ModelProperty,
  isPrimaryKey: boolean,
  className: string,
  node: CodeNode,
  ctx: Parameters<NodeEmitter>[1],
  imports: ImportCollector,
  fromPath: string,
): string | null {
  // Iliski property'si.
  if (p.RelationType && p.RelatedModelRef) {
    return renderRelation(p, className, node, ctx, imports, fromPath);
  }

  const out: string[] = [];
  if (isPrimaryKey) {
    imports.add("PrimaryGeneratedColumn", "typeorm");
    // id alani uuid varsayimi; aksi halde siradan PK uretici.
    const isUuid = p.Name.toLowerCase() === "id";
    out.push(`  @PrimaryGeneratedColumn(${isUuid ? '"uuid"' : ""})`);
    out.push(`  ${fieldDeclaration(p, ctx)}`);
    return out.join("\n");
  }

  out.push(`  @Column(${columnOptions(p, ctx, imports, fromPath)})`);
  out.push(`  ${fieldDeclaration(p, ctx)}`);
  return out.join("\n");
}

/** Iliski dekoratoru + import + alan bildirimi. Ref cozulemezse TODO ile atla. */
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
    // Kayip ref: iliskiyi koy, ama type-safe import yok -> TODO + atla.
    return `  // TODO: relation "${tsPropName(p.Name)}" (${p.RelationType} -> ${p.RelatedModelRef}) — reference could not be resolved`;
  }

  const relatedClass = pascalCase(related.name);
  // TypeORM OneToMany'de inverseSide ZORUNLU (tek-arg @OneToMany TS2554 verir).
  // PropertySchema'da InverseSide alani yok → iliskili Model'de BU Model'e geri-donen
  // @ManyToOne'i bul ve `(r) => r.<prop>` ters-yonunu URET. Karsilikli ManyToOne yoksa
  // cikarsanamaz → TODO birak. OneToOne/ManyToMany'de inverseSide opsiyonel → dokunma.
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
  // Iliski tipini import et (kendi kendine iliski ise import gerekmez).
  if (related.id !== node.id) {
    imports.add(relatedClass, importPathOf(relativeImportPath(fromPath, filePathFor(related, ctx.graph))));
  }

  const tsType = p.IsCollection || p.RelationType === "OneToMany" || p.RelationType === "ManyToMany"
    ? `${relatedClass}[]`
    : relatedClass;
  const optional = p.IsNullable ? "?" : "";
  // Zorunlu iliski alanlari da definite-assignment "!" alir (strict:true).
  const assertion = optional ? "" : "!";

  const out: string[] = [];
  out.push(`  @${decorator}(() => ${relatedClass})`);
  out.push(`  ${tsPropName(p.Name)}${optional}${assertion}: ${tsType};`);
  return out.join("\n");
}

/** OneToMany ters-yonu: iliskili Model'in property'lerinde, BU Model'e (owner)
 *  geri-donen @ManyToOne'i ara. TypeORM `@OneToMany(() => R, r => r.<owner>)`
 *  ister; karsilikli ManyToOne yoksa ters-yon cikarsanamaz → null (cagiran TODO birakir).
 *  Deterministik: yalniz graf ref cozumu, I/O yok. */
function findInverseManyToOne(
  related: CodeNode,
  owner: CodeNode,
  ctx: Parameters<NodeEmitter>[1],
): ModelProperty | null {
  let relatedProps: ModelProps;
  try {
    relatedProps = propsOf<"Model">(related);
  } catch {
    return null; // related bir Model degilse (sentezlenmis/Table) ters-yon okunamaz
  }
  for (const rp of relatedProps.Properties ?? []) {
    if (rp.RelationType !== "ManyToOne" || !rp.RelatedModelRef) continue;
    const back = ctx.graph.resolveRef("Model", rp.RelatedModelRef);
    if (back?.id === owner.id) return rp;
  }
  return null;
}

/** @Column({ ... }) secenekleri (deterministik anahtar sirasi). columnOrmType
 *  (sql-type-map TEK SOURCE) ile entity/Table ile tutarli fiziksel tip. */
function columnOptions(
  p: ModelProperty,
  ctx: Parameters<NodeEmitter>[1],
  imports: ImportCollector,
  fromPath: string,
): string {
  const parts: string[] = [];
  // Enum-tipli kolon (#56): Type bir Enum node'una cozulurse @Column VARCHAR olur
  // (native Postgres enum NOT) -> migration de VARCHAR + CHECK uretir, TUTARLI.
  // cls yine import edilir cunku TS alan tipi (fieldDeclaration) generated enum sinifidir;
  // DB-seviyesi deger kisiti migration'daki CHECK constraint'tedir.
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
 *  Zorunlu (initializer'siz) alanlar definite-assignment "!" alir; strict:true
 *  (strictPropertyInitialization) altinda TS2564 vermeden derlenir — TypeORM
 *  standardi. Opsiyonel "?" alanlar dokunulmaz. */
function fieldDeclaration(p: ModelProperty, ctx: Parameters<NodeEmitter>[1]): string {
  const optional = p.IsNullable ? "?" : "";
  const assertion = optional ? "" : "!";
  // Enum-tipli alan: Type bir Enum node'una cozulurse o sinifi TS tipi yap
  // (import @Column adiminda eklendi). Aksi halde serbest string oldugu gibi gecer.
  const enumNode = ctx.graph.resolveRef("Enum", p.Type);
  const base = enumNode ? pascalCase(enumNode.name) : sqlTypeToTs(p.Type, false);
  const tsType = p.IsCollection ? `${base}[]` : base;
  return `${tsPropName(p.Name)}${optional}${assertion}: ${tsType};`;
}

/** Bir method -> imza + surgical govde (NOT_IMPLEMENTED). */
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
