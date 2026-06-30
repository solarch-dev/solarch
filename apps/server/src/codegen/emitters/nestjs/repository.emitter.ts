import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeGraph, type CodeNode } from "../../ir";
import {
  filePathFor,
  pascalCase,
  relativeImportPath,
  importPathOf,
  resolveTypeRef,
  scalarTsType,
  tsPropName,
} from "../../naming";
import { ImportCollector } from "../../imports";
import { entityClassNameForTable, synthEntityFilePath } from "./entity-synthesis";
import { countSurgicalMarkers, notImplemented, surgicalMarker } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * repository.emitter.ts — RepositoryNode -> <feature>/<r>.repository.ts.
 *
 * KANONİK enum.emitter.ts deseni: named `export const emitRepository`, SAF
 * fonksiyon, throw YOK, yol filePathFor ile, import'lar ImportCollector ile,
 * surgicalMarkers countSurgicalMarkers ile, içerik tek "\n" ile biter.
 *
 * Üretim:
 *   - @Injectable() sınıf. (BaseClass çözülemez bir serbest ad — `extends`
 *       ÜRETİLMEZ; yalnız TODO yorumu bırakılır, aksi halde TS2304 derlemeyi kırardı.)
 *   - constructor: @InjectRepository(Entity) private readonly repo: Repository<Entity>.
 *       Entity = EntityReference -> Model/Table node (ctx.resolveRef).
 *         · Model -> entity sınıfı import edilir.
 *         · Table (Model YOK) -> Table'dan SENTEZLENEN @Entity sınıfı import edilir
 *           (entity-synthesis); böylece @InjectRepository(Entity)/Repository<Entity>/
 *           module.forFeature TUTARLI olur ve uygulama BOOT EDER.
 *         · Kayıp ref -> string token + Repository<any> (derlenebilir, TODO).
 *   - STANDART CRUD (#3): her repository TAM CRUD taşır — findById/findAll/save/
 *       remove. Bunlar SURGICAL DEĞİL; enjekte edilen TypeORM Repository<Entity>'ye
 *       delege eden GERÇEK (deterministik) gövdeler içerir (NOT_IMPLEMENTED yok):
 *         findById(id): repo.findOneBy({ <pk>: id }) -> Entity | null
 *         findAll():     repo.find()                  -> Entity[]
 *         save(entity):  repo.save(entity)            -> Entity
 *         remove(id):    repo.delete(id) (void)
 *       PK alanı/tipi entity'den çözülür (Model "id" / Table pickPrimaryKey). Bir
 *       CustomQuery aynı isimde ise CRUD metodu ATLANIR (kullanıcı niyeti kazanır;
 *       çift metot derlemeyi kırardı). Kayıp entity (Repository<any>) -> CRUD yine
 *       üretilir (any tip, derlenebilir; pk tipi string'e düşer).
 *   - CustomQueries: her biri async metot imzası (Parameters + ReturnType) +
 *       surgical marker + NOT_IMPLEMENTED gövde. İsme göre sıralı (determinizm).
 *       Param/Return tipleri scalarTsType + resolveTypeRef ile NORMALIZE edilir
 *       (UUID->string; User -> import + sınıf), aksi halde TS2304.
 *       Surgical marker'a, entity'de sentezlenen @ManyToOne/@OneToMany ilişkileri
 *       (M2) için "join/relations ile çek, N+1'den kaçın" REHBER notu eklenir;
 *       Surgical AI gövdeyi doldururken ilişkili veriyi tek sorguda toplar.
 * ──────────────────────────────────────────────────────────────────────── */

/** Surgical AI'a, sentezlenen entity ilişkilerini (M2 @ManyToOne/@OneToMany)
 *  verimli kullanması için sabit REHBER notu. Entity'ler eager:false üretilir;
 *  ilişkili veri gerektiğinde QueryBuilder.leftJoinAndSelect veya
 *  find({ relations: [...] }) ile TEK sorguda çekilmeli — döngü içinde lazy
 *  erişim N+1 patlamasına yol açar. Deterministik (sabit metin). */
const RELATION_GUIDANCE =
  "GUIDANCE: fetch related data in a SINGLE query via join/relations (leftJoinAndSelect or find({ relations })); avoid N+1 by not relying on lazy access inside a loop.";

export const emitRepository: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"Repository">(node);
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, ctx.graph);

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");
  imports.add("InjectRepository", "@nestjs/typeorm");
  imports.add("Repository", "typeorm");

  // ── EntityReference çözümleme (Model veya Table) ────────────────────────
  // @InjectRepository(<arg>) + private readonly repo: Repository<<type>>.
  //   - Çözülen Model -> entity sınıfı + import (tip ve değer aynı sembol).
  //   - Çözülen Table (Model YOK) -> Table'dan SENTEZLENEN @Entity sınıfı +
  //     import. Sentetik entity entity-synthesis emitter tarafından üretilir;
  //     adı entityClassNameForTable ile TEK KAYNAK -> forFeature/InjectRepository
  //     /Repository<T> hepsi AYNI sınıfa bağlanır -> uygulama BOOT EDER.
  //   - Çözülemeyen ref -> DERLENEBİLİR kalmak için STRING token:
  //     @InjectRepository("rawRef") + Repository<any> (TS2304 önlenir).
  const entityRefName = props.EntityReference;
  const entityNode = entityRefName
    ? ctx.graph.resolveRef(["Model", "Table"], entityRefName)
    : null;

  const isModelEntity = entityNode !== null && entityNode.kindOf() === "Model";
  const isTableEntity = entityNode !== null && entityNode.kindOf() === "Table";
  const missingEntity = entityRefName.length > 0 && entityNode === null;

  // Repository<...> tip argümanı ve @InjectRepository(...) değer argümanı.
  let entityType: string;
  let injectArg: string;
  if (isModelEntity) {
    entityType = pascalCase(entityNode!.name);
    injectArg = entityType;
    const toPath = filePathFor(entityNode!, ctx.graph);
    imports.add(entityType, importPathOf(relativeImportPath(filePath, toPath)));
  } else if (isTableEntity) {
    // Model yok -> Table'dan sentezlenen entity (entity-synthesis ile aynı isim/yol).
    entityType = entityClassNameForTable(entityNode!);
    injectArg = entityType;
    imports.add(
      entityType,
      importPathOf(relativeImportPath(filePath, synthEntityFilePath(entityNode!, ctx.graph))),
    );
  } else {
    // Kayıp ref -> import edilebilir sembol yok. String token + any.
    entityType = "any";
    injectArg = JSON.stringify(entityRefName);
  }

  const lines: string[] = [];

  if (props.Description) {
    lines.push(`/** ${props.Description} */`);
  }
  // BaseClass: çözülemez serbest ad -> `extends` ÜRETİLMEZ (TS2304 önlenir).
  if (props.BaseClass && props.BaseClass.length > 0) {
    lines.push(
      `// TODO: BaseClass "${props.BaseClass}" — unresolved base class; \`extends\` was not generated (add it manually).`,
    );
  }
  lines.push("@Injectable()");
  lines.push(`export class ${className} {`);

  // ── constructor + DI ────────────────────────────────────────────────────
  if (missingEntity) {
    lines.push(`  // TODO: EntityReference "${entityRefName}" could not be resolved (no Model/Table found).`);
  }
  lines.push("  constructor(");
  lines.push(`    @InjectRepository(${injectArg})`);
  lines.push(`    private readonly repo: Repository<${entityType}>,`);
  lines.push("  ) {}");

  // ── STANDART CRUD (#3): findById/findAll/save/remove ────────────────────
  // GERÇEK (deterministik) gövdeler — enjekte edilen TypeORM Repository<Entity>'ye
  //   delege eder; surgical DEĞİL, NOT_IMPLEMENTED DEĞİL. Bir CustomQuery aynı isimde
  //   ise o CRUD metodu ATLANIR (kullanıcı niyeti kazanır + çift metot derlemeyi
  //   kırardı). PK alan adı/tipi entity'den çözülür (kayıp entity -> "id"/string + any).
  const customNames = new Set((props.CustomQueries ?? []).map((q) => q.QueryName));
  const pk = resolvePrimaryKey(entityNode);
  const crud = renderCrudMethods(entityType, pk, customNames);
  if (crud.usesFindOptionsWhere) imports.add("FindOptionsWhere", "typeorm");
  for (const ml of crud.lines) lines.push(ml);

  // ── CustomQueries -> async metot + surgical gövde ───────────────────────
  const queries = [...(props.CustomQueries ?? [])].sort((a, b) =>
    a.QueryName < b.QueryName ? -1 : a.QueryName > b.QueryName ? 1 : 0,
  );

  for (const q of queries) {
    const methodName = q.QueryName;
    const params = (q.Parameters ?? [])
      .map((p) => `${p.Name}: ${resolveQueryType(p.Type, ctx.graph, filePath, imports)}`)
      .join(", ");
    const returnType = wrapPromise(resolveQueryType(q.ReturnType, ctx.graph, filePath, imports));

    lines.push("");
    lines.push(`  async ${methodName}(${params}): ${returnType} {`);
    // İş açıklaması + ilişki/N+1 rehberi (entity'de sentezlenen @ManyToOne/
    //   @OneToMany ilişkileri eager:false; Surgical AI join ile tek sorguda çeker).
    const description = q.Description
      ? `${q.Description}\n${RELATION_GUIDANCE}`
      : RELATION_GUIDANCE;
    const marker = surgicalMarker({
      nodeId: node.id,
      member: methodName,
      description,
      deps: ["repo"],
    });
    for (const ml of marker.split("\n")) lines.push(`    ${ml}`);
    lines.push(`    ${notImplemented(className, methodName)}`);
    lines.push("  }");
  }

  lines.push("}");

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  const file: GeneratedFile = {
    path: filePath,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
};

/* ── STANDART CRUD (#3) ────────────────────────────────────────────────────
 * Her repository, enjekte edilen TypeORM Repository<Entity>'ye delege eden TAM
 * CRUD taşır. Bu gövdeler GERÇEK + deterministik (NOT_IMPLEMENTED yok, surgical
 * yok) — TypeORM API'si yeterlidir, algoritma gerektirmez:
 *   findById(id): repo.findOneBy({ <pk>: id }) -> Entity | null
 *   findAll():    repo.find()                   -> Entity[]
 *   save(entity): repo.save(entity)             -> Entity
 *   remove(id):   repo.delete(id) (void)
 * Bir CustomQuery aynı isimde ise CRUD metodu ATLANIR (çift metot derlemeyi kırar;
 * kullanıcı niyeti kazanır). ──────────────────────────────────────────────── */

/** Entity'nin birincil-anahtar alan adı + TS tipi. Çözülemeyen entity (Repository
 *  <any>) -> { name:"id", tsType:"string" } (derlenebilir varsayılan). */
interface PrimaryKey {
  /** PK alan adı (entity property). */
  name: string;
  /** PK TS tipi (findById/remove param tipi). */
  tsType: string;
}

/** Bir entity node'undan (Model veya Table) PK alan adı + TS tipini çözer.
 *   - Model: "id" adlı Property; yoksa ilk Property; yoksa "id"/string.
 *   - Table: "id" adlı kolon; yoksa IsPrimaryKey kolon; yoksa ilk kolon.
 *  Kayıp entity (null) -> "id"/string. Saf + deterministik (DataType normalize). */
function resolvePrimaryKey(entityNode: CodeNode | null): PrimaryKey {
  if (!entityNode) return { name: "id", tsType: "string" };

  if (entityNode.kindOf() === "Model") {
    const properties = propsOf<"Model">(entityNode).Properties ?? [];
    const byId = properties.find((p) => p.Name.toLowerCase() === "id");
    const chosen = byId ?? properties[0];
    // TEK-KAYNAK: entity property adı = tsPropName(name) (model.emitter/entity-synthesis
    // ile aynı). Ham 'Id' kullanmak findById'i entity'de olmayan kolona bağlardı.
    if (chosen) return { name: tsPropName(chosen.Name), tsType: scalarTsType(chosen.Type) };
    return { name: "id", tsType: "string" };
  }

  if (entityNode.kindOf() === "Table") {
    const columns = propsOf<"Table">(entityNode).Columns ?? [];
    const byId = columns.find((c) => c.Name.toLowerCase() === "id");
    const flagged = columns.find((c) => c.IsPrimaryKey === true);
    const chosen = byId ?? flagged ?? columns[0];
    // TEK-KAYNAK: entity property adı = tsPropName(col.Name) (entity-synthesis ile aynı,
    // ör. "Id" -> "id", "CustomerId" -> "customerId"). Aksi halde findById var olmayan
    // kolona sorgu atar (as-cast gizler, runtime patlar).
    if (chosen) return { name: tsPropName(chosen.Name), tsType: scalarTsType(chosen.DataType) };
    return { name: "id", tsType: "string" };
  }

  return { name: "id", tsType: "string" };
}

/** renderCrudMethods çıktısı: üretilen satırlar + FindOptionsWhere import gerekiyor mu. */
interface CrudRender {
  /** girintili CRUD metot satırları (her metot bir boş satır önek ile). */
  lines: string[];
  /** findById üretildiyse FindOptionsWhere import edilmeli (strict-safe cast). */
  usesFindOptionsWhere: boolean;
}

/** Standart CRUD metot satırlarını (girintili) üretir. customNames ile çakışan
 *  her CRUD metodu ATLANIR. entityType "any" ise (kayıp entity) de gövdeler
 *  derlenebilir kalır (repo: Repository<any>). findById'in where argümanı strict
 *  altında derlenmek için FindOptionsWhere<Entity>'ye cast edilir (düz nesne
 *  literali FindOptionsWhere<Entity>'ye atanamaz; PK alanı dinamik). */
function renderCrudMethods(
  entityType: string,
  pk: PrimaryKey,
  customNames: Set<string>,
): CrudRender {
  const idType = pk.tsType.length > 0 ? pk.tsType : "string";
  // PK alan adını obje literali anahtarı olarak güvenli yaz (gerekiyorsa string'le).
  const pkKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(pk.name) ? pk.name : JSON.stringify(pk.name);

  const blocks: Array<{ name: string; lines: string[] }> = [
    {
      name: "findById",
      // findById entity'nin DOĞRUDAN ilişkilerini (relations) tek sorguda yükler —
      // ilişki adları runtime entity-metadata'sından (cross-emitter hesap YOK; sentetik
      // entity de dahil). Böylece çağıran `entity.<relation>`'a güvenle erişir (audit
      // #12/#13: findById sonrası yüklenmemiş ilişkiye erişip undefined/crash). İlişkisiz
      // entity'de relations=[] -> ek join yok. eager:false niyeti korunur (bu tek-entity
      // aggregate fetch'i; eager-on-every-list değil).
      lines: [
        `  async findById(id: ${idType}): Promise<${entityType} | null> {`,
        `    return this.repo.findOne({`,
        `      where: { ${pkKey}: id } as FindOptionsWhere<${entityType}>,`,
        `      relations: this.repo.metadata.relations.map((r) => r.propertyName),`,
        `    });`,
        "  }",
      ],
    },
    {
      name: "findAll",
      lines: [
        `  async findAll(): Promise<${entityType}[]> {`,
        "    return this.repo.find();",
        "  }",
      ],
    },
    {
      name: "save",
      lines: [
        `  async save(entity: ${entityType}): Promise<${entityType}> {`,
        "    return this.repo.save(entity);",
        "  }",
      ],
    },
    {
      name: "remove",
      lines: [
        `  async remove(id: ${idType}): Promise<void> {`,
        "    await this.repo.delete(id);",
        "  }",
      ],
    },
  ];

  const out: string[] = [];
  let usesFindOptionsWhere = false;
  for (const b of blocks) {
    if (customNames.has(b.name)) continue; // kullanıcı CustomQuery'si kazanır
    if (b.name === "findById") usesFindOptionsWhere = true;
    out.push("");
    out.push(...b.lines);
  }
  return { lines: out, usesFindOptionsWhere };
}

/** ReturnType'ı Promise ile sarar (zaten Promise<...> ise dokunmaz). Async
 *  metot daima Promise döner; determinizm için tek kurallı sarmalama. */
function wrapPromise(returnType: string): string {
  const t = returnType.trim();
  if (t.length === 0) return "Promise<void>";
  if (/^Promise\s*</.test(t)) return t;
  return `Promise<${t}>`;
}

/** Bir CustomQuery param/return tip stringini GEÇERLİ TS'e çevirir:
 *  scalarTsType (UUID->string, int->number ...) + entity/DTO adı çözümü
 *  (resolveTypeRef -> import + sınıf). Çözülemeyen serbest ad olduğu gibi geçer.
 *  Aksi halde "User"/"UUID" gibi tanımsız semboller TS2304 ile derlemeyi kırardı. */
function resolveQueryType(
  rawType: string,
  graph: CodeGraph,
  fromFile: string,
  imports: ImportCollector,
): string {
  return resolveTypeRef(rawType, graph, fromFile, imports);
}
