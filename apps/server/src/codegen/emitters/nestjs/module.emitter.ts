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
 * module.emitter.ts — FEATURE -> <feature>/<feature>.module.ts (SYNTHESIS).
 *
 * ARCHITECTURE-AWARE: even WITHOUT a Module node, one NestJS @Module is SYNTHESIZED
 * per extracted feature. Input is NOT a raw Module node but a `Feature` definition
 * produced by ir.ts feature inference:
 *
 *   @Module({
 *     imports:     [TypeOrmModule.forFeature([<entities>]),
 *                   CacheModule.register(),                 (if Cache)
 *                   HttpModule, ConfigModule,               (if ExternalService)
 *                   BullModule.registerQueue({ name: Q }),  (MessageQueue/queue-handler)
 *                   ...<cross-feature dependent feature modules>],
 *     controllers: [<controllers>],
 *     providers:   [<service + repository + infra providers + middleware>],
 *     exports:     [<providers other features inject>],
 *   })
 *   export class <Feature>Module [implements NestModule] {}
 *
 * When middleware exists the module `implements NestModule` and `configure(consumer)`
 * binds each middleware to controllers it ROUTES_TO (or Global -> '*')
 * via apply(...).forRoutes(...) (sorted by ExecutionOrder).
 *
 * PURE + DETERMINISTIC: all collections sorted by name/slug (Feature already
 * arrives sorted), imports via ImportCollector, content ends with single "\n".
 * @Module class is body-less when no middleware -> no surgical markers.
 * ──────────────────────────────────────────────────────────────────────── */

/** Emit <feature>.module.ts from a Feature definition (independent of Module node). */
export function emitFeatureModule(feature: Feature, ctx: EmitterContext): GeneratedFile[] {
  const graph = ctx.graph;
  const className = `${pascalCase(feature.slug)}Module`;
  // Module file path: treat as if there is no synthetic Module node for the feature —
  // derive directly from feature layout (one module/feature), not via filePathFor.
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

  // APIGateway is a real @Controller -> goes in @Module.controllers WITH
  //   Controllers (NOT provider); NestJS routing wires it automatically (no orphan).
  const allControllers = [...controllers, ...gateways];

  // ── Import provider/controller symbols (same feature folder) ──
  const realProviders = [...services, ...repositories];
  for (const n of [...allControllers, ...realProviders]) {
    const cls = pascalCase(n.name);
    if (cls.length === 0) continue;
    imports.add(cls, importPathOf(relativeImportPath(selfPath, filePathFor(n, graph))));
  }

  // ── Infra providers (Cache/ExternalService/Worker/EventHandler/
  //    Orchestrator/MessageQueue) — FULL @Injectable() classes (no Stub suffix).
  //    Each imported from its own file (filePathFor) + added to providers. ──
  const infraProviderClasses: string[] = [];
  for (const n of infraProviders) {
    const cls = pascalCase(n.name);
    if (cls.length === 0) continue;
    imports.add(cls, importPathOf(relativeImportPath(selfPath, filePathFor(n, graph))));
    infraProviderClasses.push(cls);
  }

  // ── Middleware — @Injectable() classes; added to providers + wired in configure()
  //    via apply().forRoutes(...). ──
  const middlewareWiring = collectMiddlewareWiring(middlewares, graph, selfPath, imports);
  const middlewareClasses = middlewareWiring.map((m) => m.className);

  // ── Stub providers (if any): @Injectable() stub classes. Cache/
  //    ExternalService now have full emitters -> this list is practically EMPTY; mechanism
  //    kept for future stub kinds. Class name/path SINGLE SOURCE via stub.emitter
  //    (stubClassName/stubFilePath). ──
  const stubProviderClasses: string[] = [];
  for (const sp of stubProviders) {
    const cls = stubClassName(sp);
    if (cls.length === 0) continue;
    imports.add(cls, importPathOf(relativeImportPath(selfPath, stubFilePath(sp, graph))));
    stubProviderClasses.push(cls);
  }

  // ── TypeOrmModule.forFeature([Model entities + synthesized from Table]) ──
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

  // ── Cross-feature dependent feature modules (import) ──
  //    CYCLE edges (forwardRefDeps) emitted as `forwardRef(() => XModule)`
  //    -> NestJS lazily resolves circular module dependency at boot. Edge PRESERVED
  //    (provider import not lost); only reference deferred.
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

  // ── Infra module-level imports (by kind, deterministic) ──
  // CacheModule.register() (if Cache); HttpModule + ConfigModule
  // (if ExternalService); BullModule.registerQueue({ name: Q }) (MessageQueue
  // producer + queue-based EventHandler, ONE SOURCE const per queue).
  const infraImportEntries = collectInfraModuleImports(infraProviders, graph, selfPath, imports);

  // ── @Module decorator fields ──
  const importEntries: string[] = [];
  if (entityClasses.length > 0) {
    importEntries.push(`TypeOrmModule.forFeature([${entityClasses.join(", ")}])`);
  }
  importEntries.push(...infraImportEntries);
  importEntries.push(...depModuleClasses);

  // providers = real service/repository + infra + middleware + (if any) stub.
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
  // exports: Service/Repository AND infra providers (cross-feature
  //   injection targets). In NestJS unexported providers are invisible outside the module.
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
    // When middleware exists module implements NestModule + configure(consumer).
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

/* ── Infra module imports ─────────────────────────────────────
 * Produce deterministic @Module.imports entries by kind + add required
 * symbols to ImportCollector. Order FIXED (BullModule queues sorted by
 * queue const name). ──────────────────────────────────────── */
function collectInfraModuleImports(
  infraProviders: CodeNode[],
  graph: CodeGraph,
  selfPath: string,
  imports: ImportCollector,
): string[] {
  const entries: string[] = [];

  const hasCache = infraProviders.some((n) => n.kindOf() === "Cache");
  const hasExternal = infraProviders.some((n) => n.kindOf() === "ExternalService");

  // CacheModule.register() — resolves CACHE_MANAGER token (store binding at app
  //   root; feature-level register here is enough, token available at boot).
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

  // BullModule.registerQueue({ name: <CONST> }) — for EVERY queue in this feature.
  //   Queue const imported from .queue.ts (SINGLE SOURCE for value). Includes MessageQueue
  //   producers + queues listened to by queue-based EventHandlers.
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

/** MessageQueue nodes this feature must register: MessageQueue producers belonging
 *  directly to the feature ∪ queues listened to by queue-based EventHandlers in the
 *  feature via SUBSCRIBES (else QueueRef). DEDUP + sorted by queue const name
 *  (deterministic). */
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

/** MessageQueue listened to by a queue-based EventHandler: SUBSCRIBES edge
 *  (else QueueRef property). Same resolution as event-handler.emitter. */
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

/* ── Middleware wiring (NestModule.configure) ─────────────────────────────
 * For each Middleware: import class + produce forRoutes(...) for controllers
 * it ROUTES_TO. AppliesTo==="Global" (or no ROUTES_TO) -> forRoutes("*").
 * Multiple middleware sorted by ExecutionOrder (lower first). ──────── */
interface MiddlewareWiring {
  className: string;
  /** forRoutes(...) argument expression (controller list or "*"). */
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

    // ROUTES_TO -> Controller (deterministic order). AppliesTo==="Global" or
    //   no ROUTES_TO -> all routes ("*").
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

  // ExecutionOrder lower first; tie-break by class name (deterministic).
  wirings.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.name < b.name ? -1 : 1));
  return wirings.map((w) => w.wiring);
}

/** Emit @Module decorator field. Empty entries -> field omitted entirely. */
function pushArrayField(out: string[], field: string, entries: string[]): void {
  if (entries.length === 0) return;
  out.push(`  ${field}: [${entries.join(", ")}],`);
}

/* CodeGraph/CodeNode type references (kept for consumers outside emitters). */
export type { CodeGraph, CodeNode };
