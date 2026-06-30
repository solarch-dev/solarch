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
 * CANONICAL enum.emitter.ts pattern: named `export const emitRepository`, PURE
 * function, no throw, path via filePathFor, imports via ImportCollector,
 * surgicalMarkers via countSurgicalMarkers, content ends with single "\n".
 *
 * Output:
 *   - @Injectable() class. (BaseClass unresolved free name — no `extends`
 *       generated; only TODO comment left, else TS2304 breaks compile.)
 *   - constructor: @InjectRepository(Entity) private readonly repo: Repository<Entity>.
 *       Entity = EntityReference -> Model/Table node (ctx.resolveRef).
 *         · Model -> entity class imported.
 *         · Table (no Model) -> SYNTHESIZED @Entity from Table imported
 *           (entity-synthesis); so @InjectRepository(Entity)/Repository<Entity>/
 *           module.forFeature stay CONSISTENT and app BOOTS.
 *         · Missing ref -> string token + Repository<any> (compilable, TODO).
 *   - STANDARD CRUD (#3): every repository carries FULL CRUD — findById/findAll/save/
 *       remove. These are NOT surgical; REAL (deterministic) bodies delegate to
 *       injected TypeORM Repository<Entity> (no NOT_IMPLEMENTED):
 *         findById(id): repo.findOneBy({ <pk>: id }) -> Entity | null
 *         findAll():     repo.find()                  -> Entity[]
 *         save(entity):  repo.save(entity)            -> Entity
 *         remove(id):    repo.delete(id) (void)
 *       PK field/type resolved from entity (Model "id" / Table pickPrimaryKey). If
 *       CustomQuery has same name CRUD method SKIPPED (user intent wins;
 *       duplicate method breaks compile). Missing entity (Repository<any>) -> CRUD
 *       still generated (any type, compilable; pk type falls back to string).
 *   - CustomQueries: each async method signature (Parameters + ReturnType) +
 *       surgical marker + NOT_IMPLEMENTED body. Sorted by name (determinism).
 *       Param/Return types normalized via scalarTsType + resolveTypeRef
 *       (UUID->string; User -> import + class), else TS2304.
 *       Surgical marker gets GUIDANCE note for synthesized @ManyToOne/@OneToMany
 *       relations (M2): "fetch via join/relations, avoid N+1"; Surgical AI loads
 *       related data in one query when filling body.
 * ──────────────────────────────────────────────────────────────────────── */

/** Fixed GUIDANCE note for Surgical AI to use synthesized entity relations
 *  (M2 @ManyToOne/@OneToMany) efficiently. Entities emitted eager:false;
 *  when related data needed use QueryBuilder.leftJoinAndSelect or
 *  find({ relations: [...] }) in ONE query — lazy access in loop causes
 *  N+1 explosion. Deterministic (fixed text). */
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

  // ── EntityReference resolution (Model or Table) ────────────────────────
  // @InjectRepository(<arg>) + private readonly repo: Repository<<type>>.
  //   - Resolved Model -> entity class + import (type and value same symbol).
  //   - Resolved Table (no Model) -> SYNTHESIZED @Entity from Table +
  //     import. Synthetic entity produced by entity-synthesis emitter;
  //     name via entityClassNameForTable SINGLE SOURCE -> forFeature/InjectRepository
  //     /Repository<T> all bind SAME class -> app BOOTS.
  //   - Unresolved ref -> STRING token to stay COMPILABLE:
  //     @InjectRepository("rawRef") + Repository<any> (prevents TS2304).
  const entityRefName = props.EntityReference;
  const entityNode = entityRefName
    ? ctx.graph.resolveRef(["Model", "Table"], entityRefName)
    : null;

  const isModelEntity = entityNode !== null && entityNode.kindOf() === "Model";
  const isTableEntity = entityNode !== null && entityNode.kindOf() === "Table";
  const missingEntity = entityRefName.length > 0 && entityNode === null;

  // Repository<...> type arg and @InjectRepository(...) value arg.
  let entityType: string;
  let injectArg: string;
  if (isModelEntity) {
    entityType = pascalCase(entityNode!.name);
    injectArg = entityType;
    const toPath = filePathFor(entityNode!, ctx.graph);
    imports.add(entityType, importPathOf(relativeImportPath(filePath, toPath)));
  } else if (isTableEntity) {
    // No Model -> synthesized entity from Table (same name/path as entity-synthesis).
    entityType = entityClassNameForTable(entityNode!);
    injectArg = entityType;
    imports.add(
      entityType,
      importPathOf(relativeImportPath(filePath, synthEntityFilePath(entityNode!, ctx.graph))),
    );
  } else {
    // Missing ref -> no importable symbol. String token + any.
    entityType = "any";
    injectArg = JSON.stringify(entityRefName);
  }

  const lines: string[] = [];

  if (props.Description) {
    lines.push(`/** ${props.Description} */`);
  }
  // BaseClass: unresolved free name -> no `extends` generated (prevents TS2304).
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

  // ── STANDARD CRUD (#3): findById/findAll/save/remove ────────────────────
  // REAL (deterministic) bodies — delegate to injected TypeORM Repository<Entity>;
  //   not surgical, not NOT_IMPLEMENTED. If CustomQuery has same name that CRUD
  //   method SKIPPED (user intent wins + duplicate method breaks compile). PK field
  //   name/type from entity (missing entity -> "id"/string + any).
  const customNames = new Set((props.CustomQueries ?? []).map((q) => q.QueryName));
  const pk = resolvePrimaryKey(entityNode);
  const crud = renderCrudMethods(entityType, pk, customNames);
  if (crud.usesFindOptionsWhere) imports.add("FindOptionsWhere", "typeorm");
  for (const ml of crud.lines) lines.push(ml);

  // ── CustomQueries -> async method + surgical body ───────────────────────
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
    // Work description + relation/N+1 guidance (synthesized @ManyToOne/
    //   @OneToMany relations eager:false; Surgical AI fetches via join in one query).
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

/* ── STANDARD CRUD (#3) ────────────────────────────────────────────────────
 * Every repository carries FULL CRUD delegating to injected TypeORM
 * Repository<Entity>. Bodies REAL + deterministic (no NOT_IMPLEMENTED, no
 * surgical) — TypeORM API suffices, no algorithm needed:
 *   findById(id): repo.findOneBy({ <pk>: id }) -> Entity | null
 *   findAll():    repo.find()                   -> Entity[]
 *   save(entity): repo.save(entity)             -> Entity
 *   remove(id):   repo.delete(id) (void)
 * If CustomQuery has same name CRUD method SKIPPED (duplicate breaks compile;
 * user intent wins). ──────────────────────────────────────────────── */

/** Entity primary-key field name + TS type. Unresolved entity (Repository
 *  <any>) -> { name:"id", tsType:"string" } (compilable default). */
interface PrimaryKey {
  /** PK field name (entity property). */
  name: string;
  /** PK TS type (findById/remove param type). */
  tsType: string;
}

/** Resolve PK field name + TS type from entity node (Model or Table).
 *   - Model: Property named "id"; else first Property; else "id"/string.
 *   - Table: column named "id"; else IsPrimaryKey column; else first column.
 *  Missing entity (null) -> "id"/string. Pure + deterministic (DataType normalize). */
function resolvePrimaryKey(entityNode: CodeNode | null): PrimaryKey {
  if (!entityNode) return { name: "id", tsType: "string" };

  if (entityNode.kindOf() === "Model") {
    const properties = propsOf<"Model">(entityNode).Properties ?? [];
    const byId = properties.find((p) => p.Name.toLowerCase() === "id");
    const chosen = byId ?? properties[0];
    // SINGLE SOURCE: entity property name = tsPropName(name) (same as model.emitter/entity-synthesis).
    // Raw 'Id' would bind findById to non-existent column on entity.
    if (chosen) return { name: tsPropName(chosen.Name), tsType: scalarTsType(chosen.Type) };
    return { name: "id", tsType: "string" };
  }

  if (entityNode.kindOf() === "Table") {
    const columns = propsOf<"Table">(entityNode).Columns ?? [];
    const byId = columns.find((c) => c.Name.toLowerCase() === "id");
    const flagged = columns.find((c) => c.IsPrimaryKey === true);
    const chosen = byId ?? flagged ?? columns[0];
    // SINGLE SOURCE: entity property name = tsPropName(col.Name) (same as entity-synthesis,
    // e.g. "Id" -> "id", "CustomerId" -> "customerId"). Else findById queries non-existent
    // column (as-cast hides, runtime fails).
    if (chosen) return { name: tsPropName(chosen.Name), tsType: scalarTsType(chosen.DataType) };
    return { name: "id", tsType: "string" };
  }

  return { name: "id", tsType: "string" };
}

/** renderCrudMethods output: generated lines + whether FindOptionsWhere import needed. */
interface CrudRender {
  /** indented CRUD method lines (blank line prefix per method). */
  lines: string[];
  /** Import FindOptionsWhere when findById generated (strict-safe cast). */
  usesFindOptionsWhere: boolean;
}

/** Generate standard CRUD method lines (indented). CRUD method SKIPPED when
 *  name collides with customNames. When entityType is "any" (missing entity)
 *  bodies stay compilable (repo: Repository<any>). findById where arg cast to
 *  FindOptionsWhere<Entity> to compile under strict (plain object literal not
 *  assignable to FindOptionsWhere<Entity>; PK field dynamic). */
function renderCrudMethods(
  entityType: string,
  pk: PrimaryKey,
  customNames: Set<string>,
): CrudRender {
  const idType = pk.tsType.length > 0 ? pk.tsType : "string";
  // Write PK field name safely as object literal key (stringify if needed).
  const pkKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(pk.name) ? pk.name : JSON.stringify(pk.name);

  const blocks: Array<{ name: string; lines: string[] }> = [
    {
      name: "findById",
      // findById loads entity's DIRECT relations in one query —
      // relation names from runtime entity-metadata (no cross-emitter calc; synthetic
      // entity included). Caller can safely access `entity.<relation>` (audit
      // #12/#13: accessing unloaded relation after findById undefined/crash). No relations ->
      // relations=[] -> no extra join. eager:false intent preserved (single-entity
      // aggregate fetch; not eager-on-every-list).
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
    if (customNames.has(b.name)) continue; // user CustomQuery wins
    if (b.name === "findById") usesFindOptionsWhere = true;
    out.push("");
    out.push(...b.lines);
  }
  return { lines: out, usesFindOptionsWhere };
}

/** Wrap ReturnType in Promise (unchanged if already Promise<...>). Async
 *  method always returns Promise; single rule for determinism. */
function wrapPromise(returnType: string): string {
  const t = returnType.trim();
  if (t.length === 0) return "Promise<void>";
  if (/^Promise\s*</.test(t)) return t;
  return `Promise<${t}>`;
}

/** Convert CustomQuery param/return type string to VALID TS:
 *  scalarTsType (UUID->string, int->number ...) + entity/DTO name resolution
 *  (resolveTypeRef -> import + class). Unresolved free name passes through.
 *  Else undefined symbols like "User"/"UUID" break compile with TS2304. */
function resolveQueryType(
  rawType: string,
  graph: CodeGraph,
  fromFile: string,
  imports: ImportCollector,
): string {
  return resolveTypeRef(rawType, graph, fromFile, imports);
}
