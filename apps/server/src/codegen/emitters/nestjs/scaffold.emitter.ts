import type { EmitterContext, GeneratedFile, ScaffoldEmitter } from "../../types";
import { propsOf, type CodeNode } from "../../ir";
import { importPathOf, pascalCase, relativeImportPath } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";
import { isLoginEndpoint } from "./controller.emitter";
import type { EnvironmentVariableNode } from "../../../nodes/schemas";

/** EnvironmentVariable, foundation IR'ın PropsByKind tablosunda yer almaz; bu
 *  yüzden propsOf<"EnvironmentVariable"> yoktur. Şema tipiyle doğrudan daraltırız
 *  (DB zaten Zod-doğrulanmış — yalnız tip daraltma, çalışma zamanı dönüşümü yok). */
type EnvProps = EnvironmentVariableNode["properties"];
const envPropsOf = (node: CodeNode): EnvProps => node.properties as EnvProps;

/* ────────────────────────────────────────────────────────────────────────
 * scaffold.emitter.ts — GRAPH-FARKINDA proje-seviyesi iskelet (ScaffoldEmitter).
 *
 * Çekirdekteki sabit `scaffold.ts` (emitScaffold) bir PLACEHOLDER'dır. Bu emitter
 * onun graph-farkında, üretim-kalitesinde sürümüdür. Entegrasyon fazı montaj
 * noktasında (codegen.service) emitScaffoldProject çağırır (registry'de yer almaz —
 * ScaffoldEmitter node'a bağlı değildir).
 *
 * Sözleşme:
 *   - named export, default YOK: `export const emitScaffoldProject: ScaffoldEmitter`.
 *   - SAF fonksiyon: (ctx) -> GeneratedFile[]. I/O yok, throw yok.
 *   - Yollar her zaman filePathFor / relativeImportPath ile (hardcode'lar SABİT).
 *   - import'lar ImportCollector ile sıralı (elle "import ..." YASAK).
 *   - DETERMİNİSTİK: tüm koleksiyonlar isme göre sıralı (graph.allOf zaten sıralı),
 *     timestamp/random YOK, sabit version pin'leri. Aynı graph -> byte-identical.
 *   - Her içerik tek "\n" ile biter. surgicalMarkers countSurgicalMarkers ile.
 *
 * MİMARİ (modern + optimize NestJS, Encore best-practice):
 *   package.json, tsconfig.json, tsconfig.build.json, nest-cli.json   — sabit
 *   .gitignore, jest-e2e.json                                          — sabit (H6)
 *   src/main.ts            — NestFactory(bufferLogs) + Pino logger + ValidationPipe
 *   src/app.module.ts      — İNCE: yalnız CoreModule + CommonModule + feature module
 *   src/core/core.module.ts— TÜM root forRoot/register (Config/TypeORM/Cache/Bull/
 *                            Schedule/EventEmitter/Pino) + APP_FILTER (H1/H2/H3)
 *   src/shared/filters/all-exceptions.filter.ts        — global exception filter (H1)
 *   src/shared/guards/auth.guard.ts                     — gerçek JWT guard (jsonwebtoken)
 *   src/shared/decorators/roles.decorator.ts            — paylaşımlı stub decorator
 *   src/shared/decorators/current-user.decorator.ts     — @CurrentUser + AuthUser/AuthResponse
 *   src/config/env.validation.ts                        — Joi fail-fast şeması
 *   src/config/configuration.ts                         — (EnvVar varsa) tipli config
 *   src/data-source.ts                                  — TypeORM CLI DataSource (H5)
 *   .env.example  (KÖKTE)                               — EnvVar node'ları (H4)
 *   test/app.e2e-spec.ts                                — smoke e2e (H6)
 *   README.md                                           — üretim + surgical notları
 * ──────────────────────────────────────────────────────────────────────── */

export const emitScaffoldProject: ScaffoldEmitter = (ctx: EmitterContext): GeneratedFile[] => {
  const infra = scanInfraUsage(ctx);

  const files: GeneratedFile[] = [
    json("package.json", buildPackageJson(infra)),
    json("tsconfig.json", TSCONFIG_JSON),
    json("tsconfig.build.json", TSCONFIG_BUILD_JSON),
    json("nest-cli.json", NEST_CLI_JSON),
    json("jest-e2e.json", JEST_E2E_JSON),
    file(".gitignore", GITIGNORE, "markdown"),
    ts("src/main.ts", MAIN_TS),
    ts("src/app.module.ts", buildAppModule(ctx)),
    // core/core.module.ts — TÜM root forRoot/register + APP_FILTER + Pino logger.
    //   AppModule artık yalnız bunu (+ CommonModule + feature'lar) import eder.
    ts("src/core/core.module.ts", buildCoreModule(infra)),
    // shared/filters/all-exceptions.filter.ts — global exception filter (tutarlı zarf).
    ts("src/shared/filters/all-exceptions.filter.ts", ALL_EXCEPTIONS_FILTER_TS),
    // env.validation.ts — Joi şeması. DAİMA üretilir: en az DATABASE_URL zorunlu +
    //   EnvVar node'larından türetilen kurallar. Geçersiz/eksik env BOOT'ta fırlatır.
    ts("src/config/env.validation.ts", buildEnvValidation(infra)),
    // data-source.ts — TypeORM CLI DataSource (migration:run için). DAİMA üretilir;
    //   migration yoksa bile derlenebilir (boş migrations dizini glob'u).
    ts("src/data-source.ts", buildDataSource()),
    // test/app.e2e-spec.ts — smoke e2e: AppModule boot + GET / 404 (Nest 404 zarfı).
    ts("test/app.e2e-spec.ts", APP_E2E_SPEC_TS),
    file(".env.example", buildEnvExample(ctx, infra), "env"),
    file("README.md", README_MD, "markdown"),
  ];

  // ENV -> TİPLİ CONFIG: graph'ta EnvironmentVariable node'ları VARSA src/config/
  // configuration.ts üretilir (ConfigModule.forRoot load: [configuration]).
  if (infra.envNodes.length > 0) {
    files.push(ts("src/config/configuration.ts", buildConfiguration(infra.envNodes)));
  }

  // controller.emitter, RequiresAuth/RequiredRoles olan endpoint'ler için
  // `shared/guards/auth.guard` ve `shared/decorators/roles.decorator` import eder.
  // O dosyalar başka HİÇBİR yerde üretilmez -> derleme TS2307 verir. Graph'ta en
  // az bir kullanan endpoint VARSA stub'larını üret (yollar controller import'larıyla
  // aynı: src/shared/...). Kullanılmıyorsa üretme.
  const usage = scanAuthUsage(ctx);
  if (usage.usesAuth) {
    files.push(ts("src/shared/guards/auth.guard.ts", AUTH_GUARD_TS));
    // Auth capability primitive'leri — Login/Register fill'i bunları KULLANIR
    // (düz-metin şifre / sahte token yerine). AuthGuard ile JWT tek-kaynak.
    files.push(ts("src/shared/auth/password.ts", PASSWORD_TS));
    files.push(ts("src/shared/auth/auth-token.ts", AUTH_TOKEN_TS));
  }
  if (usage.usesRoles) {
    files.push(ts("src/shared/decorators/roles.decorator.ts", ROLES_DECORATOR_TS));
    // RBAC WIRE (#39): @Roles metadata'sını OKUYAN gerçek guard. roles.decorator
    // tek başına ölü olurdu; RolesGuard Reflector ile metadata'yı enforce eder.
    files.push(ts("src/shared/guards/roles.guard.ts", ROLES_GUARD_TS));
  }
  // current-user.decorator.ts — @CurrentUser param decorator + AuthUser/AuthResponse
  //   tipleri. RequiresAuth endpoint'leri (Finding #8) ve login endpoint'leri buradan
  //   import eder; başka yerde üretilmez -> emit etmezsek TS2307.
  if (usage.usesCurrentUser)
    files.push(ts("src/shared/decorators/current-user.decorator.ts", CURRENT_USER_DECORATOR_TS));

  return files;
};

/* ── Mimari altyapı taraması (root registration + dependency kararları) ────
 * Graph'taki kind'lara göre hangi @nestjs altyapı modüllerinin app root'a
 * kaydedileceğini (artık CoreModule'de) ve package.json'a hangi deps'in
 * ekleneceğini belirler. Tek geçiş, tek kaynak — core.module + package.json
 * AYNI flag'leri okur. */
interface InfraUsage {
  /** @nestjs/cache-manager (Cache node varsa). */
  usesCache: boolean;
  /** Cache.Engine === "Redis" olan en az bir Cache var mı? (Redis store dep). */
  usesRedisCache: boolean;
  /** @nestjs/bullmq + BullModule.forRoot (MessageQueue veya queue-handler varsa). */
  usesQueue: boolean;
  /** @nestjs/schedule + ScheduleModule.forRoot (Worker varsa). */
  usesSchedule: boolean;
  /** @nestjs/event-emitter + EventEmitterModule.forRoot (event-tabanlı handler varsa). */
  usesEventEmitter: boolean;
  /** @nestjs/axios (ExternalService varsa). */
  usesHttp: boolean;
  /** Auth kullanılıyor mu (RequiresAuth endpoint) — gerçek AuthGuard jsonwebtoken
   *  ile JWT doğrular → jsonwebtoken + @types/jsonwebtoken dep'i koşullu eklenir. */
  usesAuth: boolean;
  /** EnvironmentVariable node'ları (tipli config + .env.example). */
  envNodes: CodeNode[];
}

function scanInfraUsage(ctx: EmitterContext): InfraUsage {
  const graph = ctx.graph;
  const caches = graph.allOf("Cache");
  const externals = graph.allOf("ExternalService");
  const workers = graph.allOf("Worker");
  const queues = graph.allOf("MessageQueue");
  const handlers = graph.allOf("EventHandler");
  const envNodes = graph.allOf("EnvironmentVariable");

  // Her EventHandler kuyruk-tabanlı (SUBSCRIBES/QueueRef) mı, olay-tabanlı
  //   (@OnEvent) mı? -> BullModule vs EventEmitterModule kararı.
  let usesEventEmitter = false;
  let usesQueueHandler = false;
  for (const h of handlers) {
    if (handlerIsQueueBased(h, graph)) usesQueueHandler = true;
    else usesEventEmitter = true;
  }

  const usesRedisCache = caches.some(
    (c) => (c.properties as Record<string, unknown>).Engine === "Redis",
  );
  const usesHttp = externals.length > 0;

  return {
    usesCache: caches.length > 0,
    usesRedisCache,
    usesQueue: queues.length > 0 || usesQueueHandler,
    usesSchedule: workers.length > 0,
    usesEventEmitter,
    usesHttp,
    usesAuth: scanAuthUsage(ctx).usesAuth,
    envNodes,
  };
}

/** Bir EventHandler kuyruk-tabanlı mı? (SUBSCRIBES edge'i veya QueueRef property'si
 *  ile bir MessageQueue'ya bağlı.) event-handler.emitter ile aynı çözüm. */
function handlerIsQueueBased(handler: CodeNode, graph: EmitterContext["graph"]): boolean {
  for (const e of graph.outEdges(handler.id, "SUBSCRIBES")) {
    const tgt = graph.byId(e.targetNodeId);
    if (tgt && tgt.kindOf() === "MessageQueue") return true;
  }
  const queueRef = (handler.properties as Record<string, unknown>).QueueRef;
  if (typeof queueRef === "string" && queueRef.length > 0) {
    return graph.resolveRef("MessageQueue", queueRef) !== null;
  }
  return false;
}

/** Graph'taki Controller endpoint'lerinde RequiresAuth / RequiredRoles /
 *  current-user.decorator kullanımı var mı? (controller.emitter ile AYNI koşullar.)
 *
 *  usesCurrentUser: controller.emitter `shared/decorators/current-user.decorator`
 *  dosyasından import üretiyor mu? İki yol:
 *    - RequiresAuth bir endpoint  -> @CurrentUser() user: AuthUser parametresi
 *    - ResponseDTORef OLMAYAN login endpoint -> Promise<AuthResponse> dönüş
 *  Her iki durumda da o dosya BAŞKA hiçbir yerde üretilmez -> TS2307. Bu yüzden
 *  bu koşullardan biri tutuyorsa current-user.decorator.ts emit edilmeli. */
function scanAuthUsage(
  ctx: EmitterContext,
): { usesAuth: boolean; usesRoles: boolean; usesCurrentUser: boolean } {
  let usesAuth = false;
  let usesRoles = false;
  let usesCurrentUser = false;
  for (const ctrl of ctx.graph.allOf("Controller")) {
    for (const ep of propsOf<"Controller">(ctrl).Endpoints ?? []) {
      if (ep.RequiresAuth) {
        usesAuth = true;
        usesCurrentUser = true; // @CurrentUser() user: AuthUser
      }
      if ((ep.RequiredRoles ?? []).length > 0) usesRoles = true;
      // ResponseDTORef OLMAYAN login endpoint -> Promise<AuthResponse> dönüş.
      if (!ep.ResponseDTORef && isLoginEndpoint(ep)) usesCurrentUser = true;
    }
  }
  return { usesAuth, usesRoles, usesCurrentUser };
}

/* ── src/app.module.ts (İNCE — yalnız kompozisyon) ─────────────────────────
 * H3: app.module artık root forRoot/register İÇERMEZ. Yalnız:
 *   - CoreModule          (tüm root altyapı + APP_FILTER + Pino — TEK import)
 *   - CommonModule        (varsa; feature-bağsız altyapı)
 *   - <Feature>Module'ler (slug'a sıralı)
 * Feature listesi slug'a göre sıralı (determinizm).
 * ──────────────────────────────────────────────────────────────────────── */
function buildAppModule(ctx: EmitterContext): string {
  const graph = ctx.graph;
  const appModulePath = "src/app.module.ts";

  const imports = new ImportCollector();
  imports.add("Module", "@nestjs/common");
  imports.add("CoreModule", importPathOf(relativeImportPath(appModulePath, "src/core/core.module.ts")));

  const moduleClassNames: string[] = ["CoreModule"];

  // Tüm feature modüllerini import et (slug'a sıralı) -> imports[].
  for (const feature of graph.features()) {
    const className = `${pascalCase(feature.slug)}Module`;
    const modPath = `src/${feature.slug}/${feature.slug}.module.ts`;
    imports.add(className, importPathOf(relativeImportPath(appModulePath, modPath)));
    moduleClassNames.push(className);
  }
  // CommonModule (feature-bağsız altyapı: kuyruk/handler/cache + paylaşımlı HTTP
  //   giriş katmanı) varsa onu da import et -> orphan provider KALMAZ.
  if (graph.commonFeature()) {
    imports.add("CommonModule", importPathOf(relativeImportPath(appModulePath, "src/common/common.module.ts")));
    moduleClassNames.push("CommonModule");
  }

  const moduleImportLines = moduleClassNames.map((c) => `    ${c},`);

  const lines = [
    imports.render(),
    "",
    "@Module({",
    `  imports: [\n${moduleImportLines.join("\n")}\n  ],`,
    "})",
    "export class AppModule {}",
  ];
  return lines.join("\n");
}

/* ── src/core/core.module.ts (TÜM ROOT ALTYAPI — H1/H2/H3) ────────────────
 * Uygulama genelinde TEK kez kaydedilen her şey burada toplanır:
 *   - ConfigModule.forRoot         (isGlobal + Joi validationSchema, fail-fast)
 *   - LoggerModule.forRoot         (nestjs-pino structured logging — H2)
 *   - TypeOrmModule.forRootAsync   (ConfigService -> DATABASE_URL)
 *   - CacheModule.register         (Cache varsa)
 *   - BullModule.forRoot           (Queue varsa)
 *   - ScheduleModule.forRoot       (Worker varsa)
 *   - EventEmitterModule.forRoot   (event-tabanlı handler varsa)
 *   - APP_FILTER -> AllExceptionsFilter  (global exception filter — H1)
 * @Global DEĞİLDİR: AppModule'de tek import yeter (Nest root altyapı modülleri
 * zaten kendi global token'larını —ConfigService/Logger/DataSource— yayar).
 * ──────────────────────────────────────────────────────────────────────── */
function buildCoreModule(infra: InfraUsage): string {
  const coreModulePath = "src/core/core.module.ts";
  const imports = new ImportCollector();
  imports.add("Module", "@nestjs/common");
  imports.add("APP_FILTER", "@nestjs/core");
  imports.add(
    "AllExceptionsFilter",
    importPathOf(relativeImportPath(coreModulePath, "src/shared/filters/all-exceptions.filter.ts")),
  );

  const rootImportLines: string[] = [];

  // ── ConfigModule.forRoot — DAİMA + FAIL-FAST. ─────────────────────────────
  imports.add("ConfigModule", "@nestjs/config");
  imports.add("validationSchema", importPathOf(relativeImportPath(coreModulePath, "src/config/env.validation.ts")));
  if (infra.envNodes.length > 0) {
    imports.addDefault("configuration", importPathOf(relativeImportPath(coreModulePath, "src/config/configuration.ts")));
    rootImportLines.push("    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validationSchema }),");
  } else {
    rootImportLines.push("    ConfigModule.forRoot({ isGlobal: true, validationSchema }),");
  }

  // ── LoggerModule.forRoot (nestjs-pino) — yapılandırılmış JSON loglama (H2). ─
  //   DI'lanabilir Logger (@nestjs/common veya PinoLogger) her serviste mevcut
  //   olur; console.log yerine bu kullanılır. Dev'de pino-pretty (NODE_ENV ile).
  imports.add("LoggerModule", "nestjs-pino");
  rootImportLines.push(
    "    LoggerModule.forRoot({",
    "      pinoHttp: {",
    '        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),',
    "        transport:",
    '          process.env.NODE_ENV === "production"',
    "            ? undefined",
    '            : { target: "pino-pretty", options: { singleLine: true } },',
    "      },",
    "    }),",
  );

  // ── TypeOrmModule.forRootAsync(ConfigService) — daima (Postgres). ─────────
  //   M1: bağlantı havuzu + timeout + sınırlı retry. ConfigService-gated; ilgili
  //   env yoksa makul sabit default'lara düşer (sonsuz retry'i ÖNLER). Havuz
  //   ayarları `extra` ile pg sürücüsüne geçer (max açık bağlantı + bağlantı
  //   kurma timeout'u). retryAttempts/retryDelay TypeOrmModule'ün kendi
  //   yeniden-bağlanma davranışını sınırlar.
  imports.add("ConfigService", "@nestjs/config");
  imports.add("TypeOrmModule", "@nestjs/typeorm");
  imports.add("SnakeNamingStrategy", "typeorm-naming-strategies");
  rootImportLines.push(
    "    TypeOrmModule.forRootAsync({",
    "      inject: [ConfigService],",
    "      useFactory: (config: ConfigService) => ({",
    '        type: "postgres" as const,',
    '        url: config.getOrThrow<string>("DATABASE_URL"),',
    "        autoLoadEntities: true,",
    "        synchronize: false,",
    "        // Map PascalCase/camelCase entity members to snake_case DB columns",
    "        //   (same strategy as data-source.ts, consistent with the migrations).",
    "        namingStrategy: new SnakeNamingStrategy(),",
    "        // Pool + timeout (passed to the pg driver via `extra`).",
    "        extra: {",
    '          max: config.get<number>("DB_POOL_MAX") ?? 10,',
    '          connectionTimeoutMillis: config.get<number>("DB_CONNECTION_TIMEOUT_MS") ?? 10000,',
    "        },",
    "        // Bounded retry (NO infinite retry; it stops at boot sooner or later).",
    '        retryAttempts: config.get<number>("DB_RETRY_ATTEMPTS") ?? 10,',
    '        retryDelay: config.get<number>("DB_RETRY_DELAY_MS") ?? 3000,',
    "      }),",
    "    }),",
  );

  // CacheModule.register({ isGlobal: true }) — CACHE_MANAGER token uygulama geneli.
  if (infra.usesCache) {
    imports.add("CacheModule", "@nestjs/cache-manager");
    rootImportLines.push("    CacheModule.register({ isGlobal: true }),");
  }

  // BullModule.forRoot({ connection }) — Redis bağlantısı (Queue varsa).
  if (infra.usesQueue) {
    imports.add("BullModule", "@nestjs/bullmq");
    rootImportLines.push(
      "    BullModule.forRoot({",
      "      connection: {",
      '        host: process.env.REDIS_HOST ?? "localhost",',
      "        port: Number(process.env.REDIS_PORT ?? 6379),",
      "      },",
      "    }),",
    );
  }

  // ScheduleModule.forRoot() — @Cron handler'ları (Worker varsa) ateşlensin.
  if (infra.usesSchedule) {
    imports.add("ScheduleModule", "@nestjs/schedule");
    rootImportLines.push("    ScheduleModule.forRoot(),");
  }

  // EventEmitterModule.forRoot() — @OnEvent handler'ları (event-tabanlı) çalışsın.
  if (infra.usesEventEmitter) {
    imports.add("EventEmitterModule", "@nestjs/event-emitter");
    rootImportLines.push("    EventEmitterModule.forRoot(),");
  }

  const lines = [
    imports.render(),
    "",
    "/**",
    " * Solarch-generated core infrastructure module. It gathers everything that is",
    " * registered exactly ONCE across the application (Config/Logger/TypeORM and, per",
    " * the graph, Cache/Queue/Schedule/Events) + the global exception filter. AppModule",
    " * imports only this; root forRoot/register is never repeated anywhere else.",
    " */",
    "@Module({",
    `  imports: [\n${rootImportLines.join("\n")}\n  ],`,
    "  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],",
    "})",
    "export class CoreModule {}",
  ];
  return lines.join("\n");
}

/* ── .env.example (KÖKTE — H4; graph-farkında) ─────────────────────────────
 * EnvironmentVariable node'larından (isme göre sıralı) anahtar=değer satırları.
 * GÜVENLİK: IsSecret=true ise değer ASLA yazılmaz -> "<your-...-here>" placeholder.
 * Proje köküne yazılır (".env" geleneksel olarak kökten okunur); src/.env.example
 * DEĞİL.
 * ──────────────────────────────────────────────────────────────────────── */
function buildEnvExample(ctx: EmitterContext, infra: InfraUsage): string {
  const envNodes = ctx.graph.allOf("EnvironmentVariable");

  const lines: string[] = [
    "# Solarch-generated NestJS application — environment variables",
  ];

  if (envNodes.length === 0) {
    lines.push("PORT=3000", "DATABASE_URL=postgres://user:password@localhost:5432/app");
  } else {
    for (const node of envNodes) {
      const p = envPropsOf(node);
      const key = node.name;
      if (key.length === 0) continue;

      const envs = (p.Environment ?? []).join("/");
      const required = p.IsRequired === false ? "optional" : "required";
      const meta = envs.length > 0 ? `${p.Description} (${envs}; ${required})` : `${p.Description} (${required})`;
      lines.push("", `# ${meta}`);

      const value = envValueFor(p);
      lines.push(`${key}=${value}`);
    }
  }

  // ── Çekirdek çalışma-zamanı ayarları (graph'tan bağımsız; daima). ─────────
  //   M1: TypeORM havuz/timeout/retry. L2: CORS + gövde sınırı. Hepsi opsiyonel
  //   (Joi default'ları var); değerler yorum satırında varsayılanı gösterir.
  lines.push("", "# TypeORM connection pool + timeout + bounded retry (M1)");
  lines.push("DB_POOL_MAX=10");
  lines.push("DB_CONNECTION_TIMEOUT_MS=10000");
  lines.push("DB_RETRY_ATTEMPTS=10");
  lines.push("DB_RETRY_DELAY_MS=3000");
  lines.push("", "# HTTP security (L2). If CORS_ORIGIN is empty, CORS is OFF (prod-safe).");
  lines.push("# Comma-separated list of origins, e.g.: https://app.example.com,https://admin.example.com");
  lines.push("CORS_ORIGIN=");
  lines.push("BODY_LIMIT=1mb");
  lines.push("# Separate dev/docs CORS allowance for the Scalar /docs \"try it\" origin.");
  lines.push("# Additive to CORS_ORIGIN; leave empty in prod (does NOT loosen CORS_ORIGIN).");
  lines.push("DOCS_CORS_ORIGIN=");

  // ── Mimari altyapı env anahtarları (graph kind'larına göre, deterministik) ──
  appendInfraEnvKeys(lines, ctx, infra);

  return lines.join("\n");
}

/** Queue (Redis) + ExternalService env anahtarlarını .env.example'a ekler.
 *  external-service.emitter ile aynı PREFIX (snakeCase(name).toUpperCase()) ve
 *  anahtar adları (_BASE_URL/_TIMEOUT_SECONDS/_AUTH_TOKEN|_API_KEY). */
function appendInfraEnvKeys(lines: string[], ctx: EmitterContext, infra: InfraUsage): void {
  if (infra.usesQueue) {
    lines.push("", "# BullMQ Redis connection (queues)");
    lines.push("REDIS_HOST=localhost", "REDIS_PORT=6379");
  }

  for (const ext of ctx.graph.allOf("ExternalService")) {
    const p = ext.properties as Record<string, unknown>;
    const prefix = snakeUpper(ext.name);
    if (prefix.length === 0) continue;
    const desc = typeof p.Description === "string" ? p.Description : ext.name;
    lines.push("", `# ${desc} (external service ${ext.name})`);
    lines.push(`${prefix}_BASE_URL=`);
    lines.push(`${prefix}_TIMEOUT_SECONDS=`);
    const authType = p.AuthType;
    if (authType === "API_Key") {
      lines.push(`${prefix}_API_KEY=<your-secret-here>`);
    } else if (authType === "Bearer" || authType === "Basic") {
      lines.push(`${prefix}_AUTH_TOKEN=<your-secret-here>`);
    }
  }
}

/** snakeCase(name).toUpperCase() — external-service.emitter envPrefix ile birebir. */
function snakeUpper(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s\-_./]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toUpperCase())
    .join("_");
}

/** Bir env değişkeninin .env.example değeri. Secret ASLA gerçek değer almaz. */
function envValueFor(p: EnvProps): string {
  if (p.IsSecret) {
    return "<your-secret-here>";
  }
  if (p.DefaultValue !== undefined && p.DefaultValue !== "") {
    return p.DefaultValue;
  }
  switch (p.DataType) {
    case "Number":
      return "0";
    case "Boolean":
      return "false";
    default:
      return "";
  }
}

/* ── GeneratedFile yardımcıları (scaffold.ts ile aynı desen) ──────────────── */
function file(path: string, content: string, language: GeneratedFile["language"]): GeneratedFile {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  return { path, content: normalized, language, surgicalMarkers: countSurgicalMarkers(normalized) };
}
const ts = (p: string, c: string) => file(p, c, "typescript");
const json = (p: string, c: string) => file(p, c, "json");

/* ── package.json (GRAPH-FARKINDA dependency seçimi) ───────────────────────
 * Çekirdek deps daima; mimari altyapı deps KULLANILAN kind'lara göre eklenir.
 * Sürüm pin'leri SABİT (determinizm); deps anahtarları sıralı. */
function buildPackageJson(infra: InfraUsage): string {
  const deps: Record<string, string> = {
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    // @nestjs/swagger: builds the OpenAPI document from the @ApiTags/@ApiOperation/
    //   @ApiProperty decorators (main.ts SwaggerModule.createDocument). The generated
    //   app self-documents.
    "@nestjs/swagger": "^11.4.4",
    "@nestjs/typeorm": "^11.0.0",
    // @scalar/nestjs-api-reference: serves an interactive Scalar API reference at
    //   /docs from the in-memory OpenAPI document (main.ts apiReference middleware).
    "@scalar/nestjs-api-reference": "^1.1.17",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    // dotenv: data-source.ts (TypeORM CLI) loads .env manually outside NestFactory
    //   (H5). It is imported directly there, so it must be an explicit dependency.
    dotenv: "^17.0.0",
    // express: main.ts json/urlencoded body-limit + CORS için (L2). Platform
    //   altında zaten var; doğrudan import edildiği için açık dep yapılır.
    express: "^5.0.0",
    // helmet: güvenlik HTTP başlıkları (main.ts, L2).
    helmet: "^8.0.0",
    joi: "^17.13.0",
    // nestjs-pino + pino-http: yapılandırılmış JSON loglama (CoreModule, H2).
    "nestjs-pino": "^4.1.0",
    pg: "^8.13.1",
    "pino-http": "^10.0.0",
    "reflect-metadata": "^0.2.2",
    rxjs: "^7.8.1",
    typeorm: "^0.3.20",
    // typeorm-naming-strategies: SnakeNamingStrategy maps PascalCase/camelCase
    //   entity members to snake_case DB columns (#10). Used by BOTH the runtime
    //   (CoreModule forRootAsync) and the migration CLI (data-source.ts), so entity
    //   property names line up with the snake_case columns the migrations create.
    "typeorm-naming-strategies": "^4.1.0",
  };
  const devDeps: Record<string, string> = {
    // Test/CI iskeleti (H6): jest + ts-jest + @nestjs/testing + supertest.
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    // @types/express: main.ts daima express json/urlencoded import eder (L2);
    //   Middleware emitter'ı da Request/Response tiplerini kullanır.
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^22.10.0",
    "@types/supertest": "^6.0.0",
    jest: "^29.7.0",
    // pino-pretty: dev'de okunaklı log (production'da devre dışı).
    "pino-pretty": "^11.0.0",
    supertest: "^7.0.0",
    "ts-jest": "^29.2.0",
    "ts-node": "^10.9.0",
    typescript: "^5.7.0",
  };

  if (infra.usesCache) {
    deps["@nestjs/cache-manager"] = "^3.0.0";
    deps["cache-manager"] = "^6.0.0";
    if (infra.usesRedisCache) deps["@keyv/redis"] = "^4.0.0";
  }
  if (infra.usesQueue) {
    deps["@nestjs/bullmq"] = "^11.0.0";
    deps["bullmq"] = "^5.0.0";
  }
  if (infra.usesHttp) {
    deps["@nestjs/axios"] = "^4.0.0";
    deps["axios"] = "^1.7.0";
  }
  if (infra.usesSchedule) deps["@nestjs/schedule"] = "^5.0.0";
  if (infra.usesEventEmitter) deps["@nestjs/event-emitter"] = "^3.0.0";
  // Auth: gerçek AuthGuard Bearer JWT'yi doğrular (jsonwebtoken) + login servisi
  //   şifreyi bcrypt ile hash'ler/karşılaştırır (bcryptjs — saf JS, native derleme yok).
  if (infra.usesAuth) {
    deps["jsonwebtoken"] = "^9.0.0";
    deps["bcryptjs"] = "^2.4.3";
    devDeps["@types/jsonwebtoken"] = "^9.0.0";
    devDeps["@types/bcryptjs"] = "^2.4.6";
  }

  return jsonStringify({
    name: "solarch-generated",
    version: "0.1.0",
    private: true,
    // L4: paket-yöneticisi pin. README pnpm komutları kullanır; Corepack bu alanı
    //   okuyarak doğru pnpm sürümünü etkinleştirir (tutarlı kurulum). SABİT sürüm
    //   (determinizm); deterministik üretimde lockfile yazılmaz, pin yeterlidir.
    packageManager: "pnpm@10.0.0",
    scripts: {
      build: "nest build",
      start: "node dist/main.js",
      "start:dev": "nest start --watch",
      // H5: TypeORM CLI migration:run, data-source.ts üzerinden.
      "db:migrate": "typeorm migration:run -d dist/data-source.js",
      "db:migrate:revert": "typeorm migration:revert -d dist/data-source.js",
      // H6: jest unit + e2e.
      test: "jest",
      "test:e2e": "jest --config jest-e2e.json",
    },
    // H6: jest unit konfigürasyonu (ts-jest, src/ kökü, *.spec.ts).
    jest: {
      moduleFileExtensions: ["js", "json", "ts"],
      rootDir: "src",
      testRegex: ".*\\.spec\\.ts$",
      transform: { "^.+\\.(t|j)s$": "ts-jest" },
      collectCoverageFrom: ["**/*.(t|j)s"],
      coverageDirectory: "../coverage",
      testEnvironment: "node",
    },
    dependencies: sortObject(deps),
    devDependencies: sortObject(devDeps),
  });
}

/** Sunucu-tarafı DOĞRULANMIŞ fill için node_modules cache'inin kurulacağı KANONİK
 *  SÜPERSET package.json — buildPackageJson'ın TÜM koşullu deps'leri (cache/queue/
 *  http/schedule/event-emitter) açık. Cache bundan kurulur → codegen'in emit
 *  edebileceği HER import tsc tarafından çözülür. Tek kaynak buildPackageJson →
 *  yeni bir dep eklenince cache de otomatik kapsar (drift yok). */
export function fillDepsPackageJson(): string {
  const pkg = JSON.parse(
    buildPackageJson({
      usesCache: true,
      usesRedisCache: true,
      usesQueue: true,
      usesSchedule: true,
      usesEventEmitter: true,
      usesHttp: true,
      usesAuth: true,
      envNodes: [],
    }),
  ) as { devDependencies?: Record<string, string> };
  // tsgo (TypeScript 7.0 native): YALNIZ fill-deps cache'ine ekle → in-app DOĞRULANMIŞ fill,
  // SOLARCH_USE_TSGO=1 iken ~9x hızlı tsc geçidi için binary'yi bulur. Üretilen KULLANICI
  // projelerine GİRMEZ (buildPackageJson'a dokunulmadı) — pre-release araç shipped output'a
  // sızmasın. Flag yokken cache'te durur ama kullanılmaz. devDeps sıralı tutulur (determinizm).
  pkg.devDependencies = sortObject({
    ...(pkg.devDependencies ?? {}),
    "@typescript/native-preview": "latest",
  });
  return jsonStringify(pkg);
}

/** Deterministik 2-boşluk JSON (anahtar sırası verildiği gibi korunur). */
function jsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Bir Record'un anahtarlarını alfabetik sıralayıp yeniden kurar (deterministik). */
function sortObject(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(rec).sort()) out[k] = rec[k];
  return out;
}

/* ── src/config/env.validation.ts (Joi -> FAIL-FAST) ──────────────────────
 * ConfigModule.forRoot({ validationSchema }) ile kullanılan Joi object şeması.
 * Geçersiz/eksik bir env BOOT'ta fırlatır.
 *
 * Kurallar:
 *   - DATABASE_URL: DAİMA Joi.string().required() (TypeORM forRootAsync bunu okur).
 *   - PORT: Joi.number().default(3000) (main.ts kullanır).
 *   - EnvironmentVariable node'ları: DataType -> Joi tipi; IsRequired -> required();
 *     (secret OLMAYAN) DefaultValue -> default(...). İsme göre sıralı (determinizm).
 *   - usesQueue ise REDIS_HOST/REDIS_PORT (BullMQ bağlantısı) eklenir.
 * Hiçbir gerçek secret DEĞERİ gömülmez (yalnız tip/zorunluluk kuralları). ──── */
function buildEnvValidation(infra: InfraUsage): string {
  const imports = new ImportCollector();
  imports.addDefault("Joi", "joi");

  const entries = new Map<string, string>();
  entries.set("DATABASE_URL", "Joi.string().required()");
  entries.set("PORT", "Joi.number().default(3000)");
  // M1: TypeORM havuz/timeout/retry ayarları (CoreModule forRootAsync okur).
  entries.set("DB_POOL_MAX", "Joi.number().default(10)");
  entries.set("DB_CONNECTION_TIMEOUT_MS", "Joi.number().default(10000)");
  entries.set("DB_RETRY_ATTEMPTS", "Joi.number().default(10)");
  entries.set("DB_RETRY_DELAY_MS", "Joi.number().default(3000)");
  // L2: HTTP güvenliği. CORS_ORIGIN opsiyonel (boşsa CORS kapalı); BODY_LIMIT
  //   express body-parser limit dizesi (ör. "1mb").
  entries.set("CORS_ORIGIN", "Joi.string().allow(\"\").optional()");
  entries.set("BODY_LIMIT", "Joi.string().default(\"1mb\")");
  // Self-documenting app: separate dev/docs CORS allowance for the Scalar /docs
  //   origin (additive to CORS_ORIGIN; never loosens it).
  entries.set("DOCS_CORS_ORIGIN", "Joi.string().allow(\"\").optional()");
  if (infra.usesQueue) {
    entries.set("REDIS_HOST", 'Joi.string().default("localhost")');
    entries.set("REDIS_PORT", "Joi.number().default(6379)");
  }

  for (const node of [...infra.envNodes].sort(byName)) {
    const p = envPropsOf(node);
    const key = node.name;
    if (key.length === 0 || entries.has(key)) continue;
    entries.set(key, joiRuleFor(p));
  }

  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * Solarch-generated environment-variable validation schema (Joi).");
  lines.push(" * Used with ConfigModule.forRoot({ validationSchema }); an invalid or");
  lines.push(" * missing env throws at BOOT (fail-fast). No real secret value is embedded.");
  lines.push(" */");
  lines.push(`${imports.render()}`);
  lines.push("");
  lines.push("export const validationSchema = Joi.object({");
  for (const [key, rule] of entries) {
    lines.push(`  ${key}: ${rule},`);
  }
  lines.push("});");
  return lines.join("\n");
}

/** Bir EnvVar node'unun Joi kuralı (DataType + IsRequired + secret-olmayan
 *  DefaultValue). Secret değer ASLA gömülmez (yalnız tip/zorunluluk). */
function joiRuleFor(p: EnvProps): string {
  let base: string;
  switch (p.DataType) {
    case "Number":
      base = "Joi.number()";
      break;
    case "Boolean":
      base = "Joi.boolean()";
      break;
    default:
      base = "Joi.string()";
  }
  const hasDefault = !p.IsSecret && p.DefaultValue !== undefined && p.DefaultValue !== "";
  if (hasDefault) {
    if (p.DataType === "Number") base += `.default(${Number(p.DefaultValue)})`;
    else if (p.DataType === "Boolean") base += `.default(${p.DefaultValue === "true"})`;
    else base += `.default(${JSON.stringify(p.DefaultValue)})`;
  } else {
    base += p.IsRequired === false ? ".optional()" : ".required()";
  }
  return base;
}

/* ── src/config/configuration.ts (ENV -> TİPLİ CONFIG) ─────────────────────
 * EnvironmentVariable node'larından tipli bir config nesnesi üretir. */
function buildConfiguration(envNodes: CodeNode[]): string {
  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * Solarch-generated typed environment-variable configuration.");
  lines.push(" * Loaded via ConfigModule.forRoot({ load: [configuration] }) and accessed");
  lines.push(" * in a typed way through ConfigService<AppConfig>. Secret values are not");
  lines.push(" * embedded in code — they are only read from process.env.");
  lines.push(" */");
  lines.push("export default () => ({");
  for (const node of [...envNodes].sort(byName)) {
    const p = envPropsOf(node);
    const key = node.name;
    if (key.length === 0) continue;
    const field = camelCaseKey(key);
    lines.push(`  ${field}: ${envReadExpr(p, key)},`);
  }
  lines.push("});");
  return lines.join("\n");
}

/** Bir env değişkeninin process.env okuma ifadesi (DataType'a göre dönüşümlü). */
function envReadExpr(p: EnvProps, key: string): string {
  const raw = `process.env.${key}`;
  switch (p.DataType) {
    case "Number":
      return `${raw} === undefined ? undefined : Number(${raw})`;
    case "Boolean":
      return `${raw} === "true"`;
    default:
      return raw;
  }
}

/** Bir ENV anahtarını ("DATABASE_URL") camelCase alan adına ("databaseUrl"). */
function camelCaseKey(key: string): string {
  const words = key
    .split(/[\s\-_./]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
  if (words.length === 0) return "value";
  return words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
}

function byName(a: CodeNode, b: CodeNode): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/* ── src/data-source.ts (TypeORM CLI DataSource — H5) ──────────────────────
 * `typeorm migration:run -d dist/data-source.js` bunu yükler. Çalışma zamanı
 * uygulaması (TypeOrmModule.forRootAsync) ile AYNI bağlantı bilgisini paylaşır
 * (DATABASE_URL); entity'ler glob ile otomatik bulunur. migrations glob'u
 * src/migrations/*.ts TS migration sınıflarına bakar (orchestrator üretir).
 * synchronize:false KORUNUR — şema yalnız migration ile değişir. ──────────── */
function buildDataSource(): string {
  return `import "reflect-metadata";
import { config as loadEnv } from "dotenv";
import { DataSource } from "typeorm";
import { SnakeNamingStrategy } from "typeorm-naming-strategies";

// CLI context: load .env manually (NestFactory does not run here). The runtime
//   application connection is provided by TypeOrmModule.forRootAsync(ConfigService);
//   this DataSource is only for the migration CLI and reads the SAME DATABASE_URL.
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not defined; the migration CLI cannot run.");
}

/**
 * Solarch-generated TypeORM CLI DataSource. \`npm run db:migrate\`
 * (typeorm migration:run -d dist/data-source.js) uses it. The entity and
 * migration globs look at the compiled dist output; synchronize:false.
 */
export default new DataSource({
  type: "postgres",
  url: databaseUrl,
  entities: ["dist/**/*.entity.js"],
  migrations: ["dist/migrations/*.js"],
  // Same naming strategy as the runtime (CoreModule). Keeps entity members mapped
  //   to snake_case columns so the CLI sees the SAME schema the migrations create.
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
});`;
}

// NOT: baseUrl YOK — üretilen import'lar tamamen relative (ölüydü) + TS 7.0 (tsgo) baseUrl'i
// kaldırdı (TS5102). "types" AÇIK: baseUrl gidince @types global çözümü explicit olmalı
// (node = process/Buffer; jest = .spec.ts global'leri). Diğer @types (express/supertest/jwt)
// import edilir → module-scoped, listelenmez. "lib":["ES2022"] DOM-collision fix'i (korunur).
const TSCONFIG_JSON = `{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "types": ["node", "jest"],
    "outDir": "./dist",
    "declaration": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}`;

/* tsconfig.build.json (H6): nest build bunu kullanır — tsconfig'i extend eder,
 * test/spec dosyalarını derlemeden hariç tutar (dist temiz kalır). */
const TSCONFIG_BUILD_JSON = `{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts", "**/*.e2e-spec.ts"]
}`;

const NEST_CLI_JSON = `{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}`;

/* jest-e2e.json (H6): e2e testleri test/ kökünden, *.e2e-spec.ts ile çalıştırır. */
const JEST_E2E_JSON = `{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\\\.(t|j)s$": "ts-jest"
  }
}`;

/* .gitignore (H6): node_modules / dist / .env (secret sızıntısı önlenir). */
const GITIGNORE = `# Dependencies
node_modules

# Build output
dist

# Environment variables (secrets) — .env.example is committed, .env NEVER
.env
.env.*
!.env.example

# Test coverage + logs
coverage
*.log
`;

/* ── shared/filters/all-exceptions.filter.ts (GLOBAL EXCEPTION FILTER — H1) ──
 * @Catch() ile TÜM hataları yakalar; tutarlı JSON zarfı döner:
 *   { statusCode, error, message, requestId, timestamp }
 * HttpException -> kendi status'u + mesajı korunur; generic hata -> 500 +
 * jenerik mesaj (iç hata DETAYI sızdırılmaz, yalnız sunucu tarafında loglanır). */
const ALL_EXCEPTIONS_FILTER_TS = `import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";

/** Minimum HTTP surface the filter reads — INDEPENDENT of express/fastify (requires
 *  no type package). Carries the x-request-id request header / correlation id. */
interface HttpRequestLike {
  method: string;
  url: string;
  id?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface HttpResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Solarch-generated global exception filter. Every error is returned in a
 * consistent JSON envelope; the HttpException status/message is preserved, and on
 * unexpected 500s the internal error detail is NEVER LEAKED to the client (logged on the server only).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponseLike>();
    const request = ctx.getRequest<HttpRequestLike>();

    const isHttp = exception instanceof HttpException;
    const statusCode = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // HttpException -> message/error name is preserved; generic -> generic 500 (no leak).
    let error = "Internal Server Error";
    let message: string | string[] = "An unexpected error occurred.";
    if (isHttp) {
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
        error = exception.name;
      } else if (body && typeof body === "object") {
        const obj = body as { error?: string; message?: string | string[] };
        error = obj.error ?? exception.name;
        message = obj.message ?? exception.message;
      }
    }

    const requestId =
      (request.headers["x-request-id"] as string | undefined) ?? request.id ?? undefined;

    if (!isHttp || statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Unexpected/5xx error: log the full detail ON THE SERVER (not to the client).
      this.logger.error(
        \`\${request.method} \${request.url} -> \${statusCode}\`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(statusCode).json({
      statusCode,
      error,
      message,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}`;

/* ── shared/guards/auth.guard.ts (GERÇEK, capability-layer) ─────────────────
 * controller.emitter @UseGuards(AuthGuard) ürettiğinde import edilen dosya. Artık
 * PLACEHOLDER/surgical DEĞİL: deterministik GERÇEK guard — Bearer JWT'yi JWT_SECRET
 * ile doğrular, çözülen claim'leri request.user'a koyar (@CurrentUser + RolesGuard
 * okur), her başarısızlıkta 401 atar. Auth strateji = JWT; token'ı login servisi
 * gövdesi aynı JWT_SECRET ile imzalar (sub=user id, role=rol). 'as any' KULLANMAZ. */
const AUTH_GUARD_TS = `import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { verifyAccessToken } from "../auth/auth-token";

/**
 * Solarch-generated AuthGuard — verifies the Bearer JWT and populates request.user.
 * Deterministic (NOT a surgical area): it extracts "Authorization: Bearer <token>",
 * verifies it via verifyAccessToken (single source with the login service's
 * signAccessToken — same JWT_SECRET), and assigns the decoded claims to request.user
 * so @CurrentUser() and RolesGuard can read them. Throws 401 on any failure.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const [scheme, token] = (request.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("Missing or malformed Authorization header");
    }
    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    request.user = { ...claims, id: String(claims.sub ?? claims.id ?? "") };
    return true;
  }
}`;

/* ── shared/auth/auth-token.ts (JWT sign/verify — TEK KAYNAK) ────────────────
 * AuthGuard verifyAccessToken ile DOĞRULAR; login servisi signAccessToken ile
 * İMZALAR — aynı JWT_SECRET + algoritma. Login fill'i sahte 'token' yerine bunu
 * çağırır (apiSurface'te görünür; service.emitter auth servisine import eder). */
const AUTH_TOKEN_TS = `import { sign, verify, type JwtPayload } from "jsonwebtoken";

/** The JWT signing/verification secret (fail fast if not configured). */
function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error("JWT_SECRET is not configured");
  }
  return value;
}

/**
 * Sign an access token for an authenticated user. Put the user id in \`sub\` and the
 * role in \`role\` so AuthGuard / RolesGuard can read them. Default expiry: 1 hour.
 */
export function signAccessToken(
  claims: { sub: string; role?: string } & Record<string, unknown>,
  expiresInSeconds = 3600,
): string {
  return sign(claims, secret(), { expiresIn: expiresInSeconds });
}

/** Verify an access token and return its claims; throws if invalid or expired. */
export function verifyAccessToken(token: string): JwtPayload {
  const decoded = verify(token, secret());
  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }
  return decoded;
}`;

/* ── shared/auth/password.ts (bcrypt hash/compare) ──────────────────────────
 * Login/Register fill'i için: hashPassword (kullanıcı oluştururken passwordHash'e
 * yaz) + comparePassword (kimlik doğrularken). Düz-metin karşılaştırma yerine. */
const PASSWORD_TS = `import { hash, compare } from "bcryptjs";

/** Cost factor for bcrypt hashing. */
const ROUNDS = 10;

/** Hash a plaintext password — store the result in the user's passwordHash column. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ROUNDS);
}

/** Compare a plaintext password against a stored hash. Returns true when they match. */
export function comparePassword(plain: string, passwordHash: string): Promise<boolean> {
  return compare(plain, passwordHash);
}`;

/* ── shared/decorators/roles.decorator.ts (stub) ───────────────────────────
 * controller.emitter @Roles("admin", ...) ürettiğinde import edilen dosya.
 * Metadata yazan deterministik bir decorator (RolesGuard ile eşleşmek üzere). */
const ROLES_DECORATOR_TS = `import { SetMetadata } from "@nestjs/common";

/** Metadata key that marks the roles required for a handler. */
export const ROLES_KEY = "roles";

/**
 * Solarch-generated Roles decorator. Used like @Roles("admin", "owner"); it writes
 * the roles into the route metadata. RolesGuard (shared/guards/roles.guard.ts) reads
 * this metadata via Reflector and enforces it.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);`;

/* ── shared/guards/roles.guard.ts (GERÇEK guard, stub DEĞİL) ────────────────
 * RBAC WIRE (#39): @Roles(...) ile yazılan ROLES_KEY metadata'sını Reflector ile
 * OKUR ve enforce eder. Rol gerekmeyen route geçer; gerektiren route'ta
 * request.user.role gerekli rollerden biri olmalı. request.user'ı AuthGuard
 * (authentication) yerleştirir; RolesGuard yalnız authorization yapar. Reflector
 * NestJS çekirdeğinden otomatik enjekte edilir (provider kaydı gerekmez). */
const ROLES_GUARD_TS = `import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/roles.decorator";

/**
 * Solarch-generated RolesGuard. Reads the roles written by @Roles(...) and enforces
 * them: a route with no required roles passes; otherwise request.user.role must be one
 * of the required roles. request.user is populated by AuthGuard (authentication); this
 * guard only does authorization.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    const role = request.user?.role;
    if (role === undefined) return false;
    // CASE-INSENSITIVE rol eşleşmesi: graf'taki @Roles("ADMIN") ile enum/token'daki
    // "admin" casing'i uyuşmasa da RBAC çalışır (sessiz kırılma yok).
    const normalized = role.toLowerCase();
    return required.some((r) => r.toLowerCase() === normalized);
  }
}`;

/* ── shared/decorators/current-user.decorator.ts (stub) ────────────────────
 * controller.emitter @CurrentUser() user: AuthUser ürettiğinde (RequiresAuth)
 * VE login endpoint Promise<AuthResponse> döndüğünde import edilen dosya.
 * Tek dosyada üç export: AuthUser (request.user şekli), AuthResponse (login
 * token zarfı), CurrentUser (request.user'ı çıkaran param decorator). */
const CURRENT_USER_DECORATOR_TS = `import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/**
 * Shape of the authenticated user placed on the request by AuthGuard.
 * Extend this with your own claims (e.g. roles, email) as needed.
 */
export interface AuthUser {
  id: string;
}

/**
 * Consistent envelope returned by login/authenticate endpoints.
 * Fill in the real token issuing in the surgical service body.
 */
export interface AuthResponse {
  accessToken: string;
}

/**
 * Solarch-generated @CurrentUser() param decorator. Reads the authenticated
 * user that AuthGuard placed on request.user. Use it as:
 *   handler(@CurrentUser() user: AuthUser) { ... user.id ... }
 * If no user is present (guard not yet wired), this returns undefined — wire
 * the real guard so the user is always available on protected routes.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return request.user;
  },
);`;

const MAIN_TS = `import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { apiReference } from "@scalar/nestjs-api-reference";
import helmet from "helmet";
import { json, urlencoded } from "express";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap() {
  // bufferLogs: true -> early logs are buffered until Pino is ready; then
  //   app.useLogger(...) takes over the configured logger. abortOnError
  //   (the default) throws WITHOUT EVER STARTING the app if ConfigModule's Joi
  //   validation fails (e.g. DATABASE_URL missing) — fail-fast.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);

  // L2: security headers (helmet) — prod-safe defaults.
  app.use(helmet());

  // L2: request body size limit (narrows the DoS surface). ConfigService-gated.
  const bodyLimit = config.get<string>("BODY_LIMIT") ?? "1mb";
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  // L2: CORS — ConfigService-gated. CORS_ORIGIN is the prod allowlist (comma-
  //   separated, exact match). DOCS_CORS_ORIGIN is a SEPARATE dev/docs allowance
  //   (e.g. the origin that renders the Scalar reference and issues "try it"
  //   requests against this server) — it is purely additive and NEVER loosens the
  //   prod CORS_ORIGIN. If neither is set, CORS stays OFF (prod-safe default).
  const splitOrigins = (raw: string | undefined): string[] =>
    (raw ?? "").split(",").map((o) => o.trim()).filter((o) => o.length > 0);
  const corsOrigins = [
    ...splitOrigins(config.get<string>("CORS_ORIGIN")),
    ...splitOrigins(config.get<string>("DOCS_CORS_ORIGIN")),
  ];
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  }

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // Self-documenting API: build an OpenAPI document from the @nestjs/swagger
  //   decorators emitted on the controllers/DTOs, then serve an interactive Scalar
  //   API reference at /docs. Scalar renders straight from the in-memory document
  //   (no extra network hop). Point the reference's "try it" requests at this
  //   server; in dev, allow its origin via DOCS_CORS_ORIGIN (above).
  const openApiConfig = new DocumentBuilder()
    .setTitle("API")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);
  app.use("/docs", apiReference({ content: openApiDocument }));

  // L1: on SIGTERM/SIGINT, let Nest lifecycle hooks (onModuleDestroy / clean
  //   shutdown of the TypeORM pool) run -> graceful shutdown.
  app.enableShutdownHooks();

  const port = config.get<number>("PORT") ?? 3000;
  await app.listen(port);
}
void bootstrap();`;

/* ── test/app.e2e-spec.ts (SMOKE E2E — H6) ─────────────────────────────────
 * AppModule'ü gerçekten boot eder + bir HTTP isteği atar. Bilinmeyen bir rota
 * 404 döner (Nest varsayılan + AllExceptionsFilter zarfı); bu, uygulamanın DI
 * grafiğinin tam çözüldüğünü ve filter'ın bağlandığını KANITLAR. Strict altında
 * derlenir. Çalıştırmak için DATABASE_URL gerekir (TypeORM forRootAsync). */
const APP_E2E_SPEC_TS = `import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("AppModule (e2e smoke)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("boots and returns a consistent 404 envelope for an unknown route", async () => {
    const res = await request(app.getHttpServer()).get("/__solarch_healthcheck__");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("statusCode", 404);
    expect(res.body).toHaveProperty("timestamp");
  });
});`;

const README_MD = `# solarch-generated

This project was deterministically generated from a TechnicalGraph by the Solarch
Constructor. Method bodies are marked with \`@solarch:surgical\` markers; bodies that
throw \`NOT_IMPLEMENTED\` are the algorithm areas (filled in by Surgical AI or a
developer).

## Architecture

- \`src/core/core.module.ts\` — core infrastructure: Config + Pino logger + TypeORM +
  (depending on the graph) Cache/Queue/Schedule/Events + global exception filter. \`AppModule\`
  imports only this, plus \`CommonModule\` (if present) and the feature modules.
- \`src/shared/\` — cross-cutting primitives. \`filters/all-exceptions.filter.ts\`
  (global exception filter) is always present. \`guards/auth.guard.ts\` (a real JWT
  guard: verifies the Bearer token against JWT_SECRET and populates request.user) and
  \`decorators/current-user.decorator.ts\` (the \`@CurrentUser()\` param decorator plus
  \`AuthUser\`/\`AuthResponse\` types) are generated when an endpoint requires
  authentication or returns a login token, and \`guards/roles.guard.ts\` +
  \`decorators/roles.decorator.ts\` (RolesGuard reads the @Roles metadata and enforces
  it) only when an endpoint declares required roles.
- \`src/<feature>/\` — per feature: module + controller + service + repository +
  entity/dto/exception.
- \`src/migrations/\` — a TypeORM TS migration class per table/view (numbered by FK
  dependency order). The raw SQL under \`migrations/\` is for reference and readability;
  the TS migrations are the ones that actually run.

## Filling in surgical areas

The body immediately below each \`// @solarch:surgical id=<nodeId>#<member>\` comment
throws \`throw new Error("NOT_IMPLEMENTED: ...")\`. Fill in only that marked region;
do NOT change the signature, decorators, or file structure — the next generation
produces a byte-identical skeleton from the same graph, and any hand-written signature
change would be lost. The \`throws:\` and \`deps:\` hints on the marker line list the
available exceptions and DI dependencies.

## Running

\`\`\`bash
pnpm install
cp .env.example .env   # replace the <your-secret-here> placeholders with real values
pnpm build
pnpm run db:migrate    # apply the schema (TypeORM migration:run)
pnpm start
\`\`\`

## Tests

\`\`\`bash
pnpm test        # unit (jest)
pnpm run test:e2e  # smoke e2e (AppModule boot)
\`\`\`

## Environment variables

Copy \`.env.example\` to \`.env\`. Replace the \`<your-secret-here>\` placeholders with
real values; secret values are NEVER embedded in the generated code.`;
