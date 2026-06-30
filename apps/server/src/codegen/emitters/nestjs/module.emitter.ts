import type { EmitterContext, GeneratedFile } from "../../types";
import type { CodeGraph, CodeNode, Feature } from "../../ir";
import { filePathFor, pascalCase, relativeImportPath, importPathOf } from "../../naming";
import { ImportCollector } from "../../imports";
import {
  entityClassNameForTable,
  synthEntityFilePath,
} from "./entity-synthesis";
import { stubClassName, stubFilePath } from "./stub.emitter";
import { queueNameConst } from "./message-queue.emitter";
import { countSurgicalMarkers } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * module.emitter.ts — FEATURE -> <feature>/<feature>.module.ts (SENTEZ).
 *
 * MİMARİ-FARKINDA: Module node OLMASA bile her çıkarılmış feature için bir
 * NestJS @Module SENTEZLENİR. Girdi ham Module node DEĞİL, ir.ts feature-
 * inference'ın ürettiği bir `Feature` tanımıdır:
 *
 *   @Module({
 *     imports:     [TypeOrmModule.forFeature([<entity'ler>]),
 *                   CacheModule.register(),                 (Cache varsa)
 *                   HttpModule, ConfigModule,               (ExternalService varsa)
 *                   BullModule.registerQueue({ name: Q }),  (MessageQueue/queue-handler varsa)
 *                   ...<cross-feature bağımlı feature modülleri>],
 *     controllers: [<controller'lar>],
 *     providers:   [<service + repository + mimari altyapı provider'ları + middleware>],
 *     exports:     [<başka feature'ların enjekte ettiği provider'lar>],
 *   })
 *   export class <Feature>Module [implements NestModule] {}
 *
 * Middleware varsa modül `implements NestModule` olur ve `configure(consumer)`
 * içinde her middleware ROUTES_TO ettiği controller'lara (yoksa Global -> '*')
 * apply(...).forRoutes(...) ile bağlanır (ExecutionOrder'a göre sıralı).
 *
 * SAF + DETERMİNİSTİK: tüm koleksiyonlar isme/slug'a göre sıralı (Feature zaten
 * sıralı gelir), import'lar ImportCollector ile, içerik tek "\n" ile biter.
 * @Module sınıfı (middleware yoksa) gövdesizdir -> surgical marker üretmez.
 * ──────────────────────────────────────────────────────────────────────── */

/** Bir Feature tanımından <feature>.module.ts üretir (Module node'dan bağımsız). */
export function emitFeatureModule(feature: Feature, ctx: EmitterContext): GeneratedFile[] {
  const graph = ctx.graph;
  const className = `${pascalCase(feature.slug)}Module`;
  // Module dosya yolu: feature'a sentetik bir Module node yokmuş gibi davranıp
  // filePathFor ile değil, doğrudan feature düzeninden türetiriz (tek module/feature).
  const selfPath = `${feature.slug}/${feature.slug}.module.ts`;

  const imports = new ImportCollector();
  imports.add("Module", "@nestjs/common");

  const {
    controllers,
    gateways,
    services,
    repositories,
    entities,
    syntheticEntityTables,
    stubProviders,
    infraProviders,
    middlewares,
    exports,
    dependsOn,
    forwardRefDeps,
  } = feature;

  // APIGateway gerçek bir @Controller'dır -> @Module.controllers'a Controller'larla
  //   BİRLİKTE girer (provider DEĞİL); NestJS routing'i otomatik bağlar (orphan yok).
  const allControllers = [...controllers, ...gateways];

  // ── Provider/controller sembollerini import et (aynı feature klasörü içi) ──
  const realProviders = [...services, ...repositories];
  for (const n of [...allControllers, ...realProviders]) {
    const cls = pascalCase(n.name);
    if (cls.length === 0) continue;
    imports.add(cls, importPathOf(relativeImportPath(selfPath, filePathFor(n, graph))));
  }

  // ── Mimari altyapı provider'ları (Cache/ExternalService/Worker/EventHandler/
  //    Orchestrator/MessageQueue) — TAM @Injectable() sınıflar (Stub eki YOK).
  //    Her biri kendi dosyasından (filePathFor) import edilir + providers'a girer. ──
  const infraProviderClasses: string[] = [];
  for (const n of infraProviders) {
    const cls = pascalCase(n.name);
    if (cls.length === 0) continue;
    imports.add(cls, importPathOf(relativeImportPath(selfPath, filePathFor(n, graph))));
    infraProviderClasses.push(cls);
  }

  // ── Middleware'ler — @Injectable() sınıflar; providers'a girer + configure()
  //    içinde apply().forRoutes(...) ile bağlanır. ──
  const middlewareWiring = collectMiddlewareWiring(middlewares, graph, selfPath, imports);
  const middlewareClasses = middlewareWiring.map((m) => m.className);

  // ── Stub provider'lar (varsa): @Injectable() stub sınıfları. Cache/
  //    ExternalService artık tam emitter'lı -> bu liste pratikte BOŞ; mekanizma
  //    ileride yeni stub kind'lar için korunur. Sınıf adı/yol stub.emitter ile
  //    TEK KAYNAK (stubClassName/stubFilePath). ──
  const stubProviderClasses: string[] = [];
  for (const sp of stubProviders) {
    const cls = stubClassName(sp);
    if (cls.length === 0) continue;
    imports.add(cls, importPathOf(relativeImportPath(selfPath, stubFilePath(sp, graph))));
    stubProviderClasses.push(cls);
  }

  // ── TypeOrmModule.forFeature([Model entity'leri + Table'dan sentezlenenler]) ──
  const entityClasses: string[] = [];
  for (const ent of entities) {
    const cls = pascalCase(ent.name);
    if (cls.length === 0) continue;
    imports.add(cls, importPathOf(relativeImportPath(selfPath, filePathFor(ent, graph))));
    entityClasses.push(cls);
  }
  for (const table of syntheticEntityTables) {
    const cls = entityClassNameForTable(table);
    if (cls.length === 0) continue;
    imports.add(cls, importPathOf(relativeImportPath(selfPath, synthEntityFilePath(table, graph))));
    entityClasses.push(cls);
  }
  if (entityClasses.length > 0) {
    imports.add("TypeOrmModule", "@nestjs/typeorm");
  }

  // ── Cross-feature bağımlı feature modülleri (import) ──
  //    DÖNGÜ kenarları (forwardRefDeps) `forwardRef(() => XModule)` ile emit edilir
  //    → NestJS circular module dependency'yi boot'ta lazy çözer. Kenar KORUNUR
  //    (provider import'u kaybolmaz); yalnız referans ertelenir.
  const forwardRefSet = new Set(forwardRefDeps);
  const depModuleClasses: string[] = [];
  for (const depSlug of dependsOn) {
    const depClass = `${pascalCase(depSlug)}Module`;
    const depPath = `${depSlug}/${depSlug}.module.ts`;
    imports.add(depClass, importPathOf(relativeImportPath(selfPath, depPath)));
    if (forwardRefSet.has(depSlug)) {
      imports.add("forwardRef", "@nestjs/common");
      depModuleClasses.push(`forwardRef(() => ${depClass})`);
    } else {
      depModuleClasses.push(depClass);
    }
  }

  // ── Mimari altyapı module-seviyesi import'ları (kind'lara göre, deterministik) ──
  // CacheModule.register() (Cache varsa); HttpModule + ConfigModule
  // (ExternalService varsa); BullModule.registerQueue({ name: Q }) (MessageQueue
  // producer + queue-tabanlı EventHandler için, kuyruk başına TEK KAYNAK const).
  const infraImportEntries = collectInfraModuleImports(infraProviders, graph, selfPath, imports);

  // ── @Module dekoratör alanları ──
  const importEntries: string[] = [];
  if (entityClasses.length > 0) {
    importEntries.push(`TypeOrmModule.forFeature([${entityClasses.join(", ")}])`);
  }
  importEntries.push(...infraImportEntries);
  importEntries.push(...depModuleClasses);

  // providers = gerçek service/repository + mimari altyapı + middleware + (varsa) stub.
  const providerClasses = [
    ...realProviders.map((p) => pascalCase(p.name)),
    ...infraProviderClasses,
    ...middlewareClasses,
    ...stubProviderClasses,
  ];

  const decoratorLines: string[] = [];
  pushArrayField(decoratorLines, "imports", importEntries);
  pushArrayField(decoratorLines, "controllers", allControllers.map((c) => pascalCase(c.name)));
  pushArrayField(decoratorLines, "providers", providerClasses);
  // exports: Service/Repository VE mimari altyapı provider'ları (cross-feature
  //   enjeksiyon hedefi). NestJS'te export edilmeyen provider modül-dışı görünmez.
  pushArrayField(decoratorLines, "exports", exports.map((e) => pascalCase(e.name)));

  const lines: string[] = [];
  const description = feature.module
    ? (feature.module.properties as Record<string, unknown>).Description
    : undefined;
  if (typeof description === "string" && description.length > 0) {
    lines.push(`/** ${description} */`);
  } else {
    lines.push(`/** ${pascalCase(feature.slug)} feature module (synthesized by Solarch). */`);
  }
  lines.push("@Module({");
  lines.push(...decoratorLines);
  lines.push("})");

  if (middlewareWiring.length > 0) {
    // Middleware varsa modül NestModule implements eder + configure(consumer).
    imports.add("MiddlewareConsumer", "@nestjs/common");
    imports.add("NestModule", "@nestjs/common");
    lines.push(`export class ${className} implements NestModule {`);
    lines.push("  configure(consumer: MiddlewareConsumer): void {");
    for (const w of middlewareWiring) {
      lines.push(`    consumer.apply(${w.className}).forRoutes(${w.forRoutes});`);
    }
    lines.push("  }");
    lines.push("}");
  } else {
    lines.push(`export class ${className} {}`);
  }

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  const file: GeneratedFile = {
    path: selfPath,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
}

/* ── Mimari altyapı module import'ları ─────────────────────────────────────
 * Kind'lara göre deterministik @Module.imports girdileri üretir + gerekli
 * sembolleri ImportCollector'a ekler. Sıra SABİTTİR (BullModule kuyrukları
 * kuyruk const adına göre sıralı). ──────────────────────────────────────── */
function collectInfraModuleImports(
  infraProviders: CodeNode[],
  graph: CodeGraph,
  selfPath: string,
  imports: ImportCollector,
): string[] {
  const entries: string[] = [];

  const hasCache = infraProviders.some((n) => n.kindOf() === "Cache");
  const hasExternal = infraProviders.some((n) => n.kindOf() === "ExternalService");

  // CacheModule.register() — CACHE_MANAGER token'ını çözer (store bağlaması app
  //   root'ta; burada feature-seviyesi register yeterli, bootta token mevcut olur).
  if (hasCache) {
    imports.add("CacheModule", "@nestjs/cache-manager");
    entries.push("CacheModule.register()");
  }
  // ExternalService -> HttpModule (HttpService) + ConfigModule (ConfigService).
  if (hasExternal) {
    imports.add("HttpModule", "@nestjs/axios");
    imports.add("ConfigModule", "@nestjs/config");
    entries.push("HttpModule");
    entries.push("ConfigModule");
  }

  // BullModule.registerQueue({ name: <CONST> }) — bu feature'ın HER kuyruğu için.
  //   Kuyruk const'ı .queue.ts'ten import edilir (DEĞER tek kaynak). MessageQueue
  //   producer'ları + queue-tabanlı EventHandler'ların dinlediği kuyruklar dahil.
  const queueNodes = collectFeatureQueues(infraProviders, graph);
  if (queueNodes.length > 0) {
    imports.add("BullModule", "@nestjs/bullmq");
    for (const q of queueNodes) {
      const constName = queueNameConst(q);
      imports.add(constName, importPathOf(relativeImportPath(selfPath, filePathFor(q, graph))));
      entries.push(`BullModule.registerQueue({ name: ${constName} })`);
    }
  }

  return entries;
}

/** Bu feature'ın kaydetmesi gereken MessageQueue node'ları: doğrudan feature'a
 *  ait MessageQueue producer'ları ∪ feature'a ait queue-tabanlı EventHandler'ların
 *  SUBSCRIBES (yoksa QueueRef) ile dinlediği kuyruklar. DEDUP + kuyruk const adına
 *  göre sıralı (deterministik). */
function collectFeatureQueues(infraProviders: CodeNode[], graph: CodeGraph): CodeNode[] {
  const byId = new Map<string, CodeNode>();
  for (const n of infraProviders) {
    if (n.kindOf() === "MessageQueue") byId.set(n.id, n);
    if (n.kindOf() === "EventHandler") {
      const q = resolveHandlerQueue(n, graph);
      if (q) byId.set(q.id, q);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const ca = queueNameConst(a);
    const cb = queueNameConst(b);
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

/** Bir queue-tabanlı EventHandler'ın dinlediği MessageQueue: SUBSCRIBES edge'i
 *  (yoksa QueueRef property'si). event-handler.emitter ile aynı çözüm. */
function resolveHandlerQueue(handler: CodeNode, graph: CodeGraph): CodeNode | null {
  for (const e of graph.outEdges(handler.id, "SUBSCRIBES")) {
    const tgt = graph.byId(e.targetNodeId);
    if (tgt && tgt.kindOf() === "MessageQueue") return tgt;
  }
  const queueRef = (handler.properties as Record<string, unknown>).QueueRef;
  if (typeof queueRef === "string" && queueRef.length > 0) {
    const q = graph.resolveRef("MessageQueue", queueRef);
    if (q) return q;
  }
  return null;
}

/* ── Middleware bağlama (NestModule.configure) ─────────────────────────────
 * Her Middleware için: sınıfı import et + ROUTES_TO ettiği Controller'lara
 * forRoutes(...) üret. AppliesTo==="Global" (veya ROUTES_TO yok) -> forRoutes("*").
 * Birden çok middleware ExecutionOrder'a (küçük önce) göre sıralanır. ──────── */
interface MiddlewareWiring {
  className: string;
  /** forRoutes(...) argüman ifadesi (controller listesi veya "*"). */
  forRoutes: string;
}

function collectMiddlewareWiring(
  middlewares: CodeNode[],
  graph: CodeGraph,
  selfPath: string,
  imports: ImportCollector,
): MiddlewareWiring[] {
  const wirings: { order: number; name: string; wiring: MiddlewareWiring }[] = [];

  for (const mw of middlewares) {
    const className = pascalCase(mw.name);
    if (className.length === 0) continue;
    imports.add(className, importPathOf(relativeImportPath(selfPath, filePathFor(mw, graph))));

    const props = mw.properties as Record<string, unknown>;
    const appliesTo = props.AppliesTo;
    const executionOrder = typeof props.ExecutionOrder === "number" ? props.ExecutionOrder : 0;

    // ROUTES_TO -> Controller (deterministik sıralı). AppliesTo==="Global" ya da
    //   hiç ROUTES_TO yoksa tüm rotalara ("*").
    const routedControllers: CodeNode[] = [];
    for (const e of graph.outEdges(mw.id, "ROUTES_TO")) {
      const tgt = graph.byId(e.targetNodeId);
      if (tgt && tgt.kindOf() === "Controller") routedControllers.push(tgt);
    }

    let forRoutes: string;
    if (appliesTo === "Global" || routedControllers.length === 0) {
      forRoutes = `"*"`;
    } else {
      const ctrlClasses = routedControllers.map((c) => pascalCase(c.name));
      for (const c of routedControllers) {
        imports.add(
          pascalCase(c.name),
          importPathOf(relativeImportPath(selfPath, filePathFor(c, graph))),
        );
      }
      forRoutes = ctrlClasses.join(", ");
    }

    wirings.push({ order: executionOrder, name: className, wiring: { className, forRoutes } });
  }

  // ExecutionOrder küçük önce; eşitlikte sınıf adı (deterministik).
  wirings.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.name < b.name ? -1 : 1));
  return wirings.map((w) => w.wiring);
}

/** @Module dekoratör alanını üretir. Boş entries -> alan tamamen atlanır. */
function pushArrayField(out: string[], field: string, entries: string[]): void {
  if (entries.length === 0) return;
  out.push(`  ${field}: [${entries.join(", ")}],`);
}

/* CodeGraph/CodeNode type referansları (emitter dışı tüketici için tutulur). */
export type { CodeGraph, CodeNode };
