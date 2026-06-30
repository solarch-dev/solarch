import { describe, it, expect } from "vitest";
import { emitScaffoldProject, fillDepsPackageJson } from "./scaffold.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { NodeKind } from "../../../nodes/schemas";

/* ── Fixture yardımcıları ──────────────────────────────────────────────── */
let seq = 0;
function uuid(): string {
  seq += 1;
  const tail = String(seq).padStart(12, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

function node(type: NodeKind, properties: Record<string, unknown>, id = uuid()): StoredNode {
  return {
    id,
    type,
    projectId: "00000000-0000-4000-8000-000000000000",
    positionX: 0,
    positionY: 0,
    homeTabId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function edge(kind: StoredEdge["kind"], sourceNodeId: string, targetNodeId: string): StoredEdge {
  return {
    id: uuid(),
    projectId: "00000000-0000-4000-8000-000000000000",
    sourceNodeId,
    targetNodeId,
    kind,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: false },
  };
}

function ctxFor(nodes: StoredNode[], edges: StoredEdge[] = []): EmitterContext {
  return { graph: buildCodeGraph(nodes, edges), target: "nestjs" };
}

function fileByPath(files: ReturnType<typeof emitScaffoldProject>, path: string) {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`expected file ${path}`);
  return f;
}

/* ── Gerçekçi küçük graph ──────────────────────────────────────────────── */
function richGraph() {
  const usersModule = node("Module", {
    ModuleName: "UsersModule",
    Description: "Kullanıcı yönetimi",
    StrictBoundaries: true,
    ExposedServices: ["UsersService"],
    Dependencies: [],
  });
  const usersService = node("Service", {
    ServiceName: "UsersService",
    Description: "Kullanıcı iş mantığı",
    IsTransactionScoped: false,
    Methods: [{ MethodName: "findAll", ReturnType: "User[]" }],
    Dependencies: [],
  });
  const usersController = node("Controller", {
    ControllerName: "UsersController",
    Description: "Kullanıcı uçları",
    BaseRoute: "users",
    Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false }],
  });
  // Module'e bağlanamayan loose node'lar (moduleOf === null).
  const healthController = node("Controller", {
    ControllerName: "HealthController",
    Description: "Sağlık kontrolü",
    BaseRoute: "health",
    Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false }],
  });
  const clockService = node("Service", {
    ServiceName: "ClockService",
    Description: "Zaman servisi",
    IsTransactionScoped: false,
    Methods: [{ MethodName: "now", ReturnType: "Date" }],
    Dependencies: [],
  });
  // EnvironmentVariable node'ları.
  const dbUrl = node("EnvironmentVariable", {
    Key: "DATABASE_URL",
    Description: "Postgres bağlantı dizesi",
    DataType: "String",
    IsSecret: false,
    Environment: ["Dev", "Prod"],
    DefaultValue: "postgres://user:password@localhost:5432/app",
    IsRequired: true,
  });
  const jwtSecret = node("EnvironmentVariable", {
    Key: "JWT_SECRET",
    Description: "JWT imzalama anahtarı",
    DataType: "String",
    IsSecret: true,
    Environment: ["Dev", "Staging", "Prod"],
    IsRequired: true,
  });
  const port = node("EnvironmentVariable", {
    Key: "PORT",
    Description: "HTTP portu",
    DataType: "Number",
    IsSecret: false,
    Environment: ["Dev"],
    DefaultValue: "3000",
    IsRequired: false,
  });

  const edges = [
    // Controller -> Service yalnız CALLS edge'inden gelir (modül bağı buradan).
    edge("CALLS", usersController.id, usersService.id),
  ];

  return {
    nodes: [usersModule, usersService, usersController, healthController, clockService, dbUrl, jwtSecret, port],
    edges,
  };
}

describe("emitScaffoldProject (graph-farkında scaffold)", () => {
  it("proje dosyalarını üretir (CoreModule + shared filter + data-source + test/CI iskeleti dahil)", () => {
    const { nodes, edges } = richGraph();
    const files = emitScaffoldProject(ctxFor(nodes, edges));
    // richGraph EnvironmentVariable node'ları içerir -> src/config/configuration.ts
    // de üretilir (ENV -> tipli config). env.validation.ts (Joi) DAİMA üretilir.
    // H1-H6: core.module + shared/filters + data-source + tsconfig.build + jest-e2e
    // + .gitignore + test/app.e2e-spec. .env.example KÖKTE (H4).
    expect(files.map((f) => f.path).sort()).toEqual(
      [
        ".env.example",
        ".gitignore",
        "README.md",
        "jest-e2e.json",
        "nest-cli.json",
        "package.json",
        "src/app.module.ts",
        "src/config/configuration.ts",
        "src/config/env.validation.ts",
        "src/core/core.module.ts",
        "src/data-source.ts",
        "src/main.ts",
        "src/shared/filters/all-exceptions.filter.ts",
        "test/app.e2e-spec.ts",
        "tsconfig.build.json",
        "tsconfig.json",
      ].sort(),
    );
  });

  it("app.module.ts — İNCE: CoreModule + feature modülleri (root forRoot/register CoreModule'de)", () => {
    const { nodes, edges } = richGraph();
    const files = emitScaffoldProject(ctxFor(nodes, edges));
    const app = fileByPath(files, "src/app.module.ts");

    // Sıralı import bloku: paketler önce, göreli sonra.
    expect(app.content).toContain('import { Module } from "@nestjs/common";');
    // H3: app.module artık CoreModule'ü import eder (tüm root altyapı orada).
    expect(app.content).toContain('import { CoreModule } from "./core/core.module";');
    expect(app.content).toContain("    CoreModule,");
    // Her feature -> bir sentezlenmiş <feature>.module.ts.
    expect(app.content).toContain('import { UsersModule } from "./users/users.module";');
    expect(app.content).toContain('import { HealthModule } from "./health/health.module";');
    expect(app.content).toContain('import { ClockModule } from "./clock/clock.module";');

    // Feature modülleri @Module.imports'a girer (slug'a göre sıralı).
    expect(app.content).toContain("    UsersModule,");
    expect(app.content).toContain("    HealthModule,");
    expect(app.content).toContain("    ClockModule,");
    // H3: app.module ROOT forRoot/register İÇERMEZ (hepsi CoreModule'de).
    expect(app.content).not.toContain("TypeOrmModule.forRootAsync");
    expect(app.content).not.toContain("ConfigModule.forRoot");
    // app.module HAM controller/provider içermez (hepsi feature modüllerinde).
    expect(app.content).not.toContain("controllers:");
    expect(app.content).not.toContain("providers:");
    expect(app.content).not.toContain("UsersController");
    expect(app.content).not.toContain("UsersService");
    expect(app.content.endsWith("export class AppModule {}\n")).toBe(true);

    // CoreModule TÜM root altyapıyı taşır (H1/H2/H3).
    const core = fileByPath(files, "src/core/core.module.ts");
    expect(core.content).toContain("ConfigModule.forRoot({ isGlobal: true, load: [configuration], validationSchema })");
    expect(core.content).toContain("TypeOrmModule.forRootAsync({");
    expect(core.content).toContain('type: "postgres" as const,');
    expect(core.content).toContain('config.getOrThrow<string>("DATABASE_URL")');
    // #10: snake_case naming strategy on the runtime connection (same as CLI).
    expect(core.content).toContain('import { SnakeNamingStrategy } from "typeorm-naming-strategies";');
    expect(core.content).toContain("namingStrategy: new SnakeNamingStrategy(),");
    // H2: Pino logger CoreModule'de kurulur.
    expect(core.content).toContain('import { LoggerModule } from "nestjs-pino";');
    expect(core.content).toContain("LoggerModule.forRoot({");
    // H1: global exception filter APP_FILTER ile bağlanır.
    expect(core.content).toContain('import { APP_FILTER } from "@nestjs/core";');
    expect(core.content).toContain("provide: APP_FILTER, useClass: AllExceptionsFilter");
    expect(core.content.endsWith("export class CoreModule {}\n")).toBe(true);
  });

  it("all-exceptions.filter.ts — tutarlı zarf + generic 500'de sızıntı yok (H1)", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes, richGraph().edges));
    const filter = fileByPath(files, "src/shared/filters/all-exceptions.filter.ts");
    expect(filter.content).toContain("@Catch()");
    expect(filter.content).toContain("implements ExceptionFilter");
    // Tutarlı zarf alanları.
    for (const field of ["statusCode", "error", "message", "requestId", "timestamp"]) {
      expect(filter.content).toContain(field);
    }
    // HttpException status'u korunur; generic -> 500 + jenerik mesaj.
    expect(filter.content).toContain("exception instanceof HttpException");
    expect(filter.content).toContain("HttpStatus.INTERNAL_SERVER_ERROR");
    expect(filter.language).toBe("typescript");
  });

  it("data-source.ts + db:migrate script (H5)", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes, richGraph().edges));
    const ds = fileByPath(files, "src/data-source.ts");
    expect(ds.content).toContain("new DataSource({");
    expect(ds.content).toContain('migrations: ["dist/migrations/*.js"]');
    expect(ds.content).toContain("synchronize: false");
    // M1: data-source SADECE type/url/synchronize taşır — havuz/retry runtime'a
    //   (CoreModule forRootAsync) ait; CLI DataSource bunlardan ÖZGÜN kalır.
    expect(ds.content).not.toContain("extra:");
    expect(ds.content).not.toContain("retryAttempts");
    // #2: data-source imports dotenv to load .env in the CLI context — dotenv MUST
    //   therefore be an explicit dependency (otherwise compile fails: TS2307).
    expect(ds.content).toContain('import { config as loadEnv } from "dotenv";');
    // #10: same SnakeNamingStrategy as the runtime, so the CLI sees the same
    //   snake_case schema the migrations create.
    expect(ds.content).toContain('import { SnakeNamingStrategy } from "typeorm-naming-strategies";');
    expect(ds.content).toContain("namingStrategy: new SnakeNamingStrategy(),");
    const pkg = fileByPath(files, "package.json");
    expect(pkg.content).toContain('"db:migrate": "typeorm migration:run -d dist/data-source.js"');
    // #2 + #10: the new direct imports are declared as dependencies.
    expect(pkg.content).toContain('"dotenv":');
    expect(pkg.content).toContain('"typeorm-naming-strategies":');
  });

  it("test/CI iskeleti: tsconfig.build + jest config + e2e smoke + .gitignore (H6)", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes, richGraph().edges));
    const gitignore = fileByPath(files, ".gitignore");
    for (const ignore of ["node_modules", "dist", ".env"]) {
      expect(gitignore.content).toContain(ignore);
    }
    const tsBuild = fileByPath(files, "tsconfig.build.json");
    expect(tsBuild.content).toContain('"extends": "./tsconfig.json"');
    const e2e = fileByPath(files, "test/app.e2e-spec.ts");
    expect(e2e.content).toContain("Test.createTestingModule");
    expect(e2e.content).toContain("import { AppModule }");
    const pkg = fileByPath(files, "package.json");
    expect(pkg.content).toContain('"jest"');
    expect(pkg.content).toContain('"@nestjs/testing"');
  });

  it("tsconfig.json: TS7-uyumlu — baseUrl YOK (kaldırıldı), types açık [node, jest], lib ES2022", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes, richGraph().edges));
    const tsconfig = fileByPath(files, "tsconfig.json");
    // baseUrl ölüydü (import'lar relative) + TS 7.0 (tsgo) onu reddeder (TS5102) → OLMAMALI.
    expect(tsconfig.content).not.toContain("baseUrl");
    // @types global çözümü explicit (baseUrl gidince tsgo otomatik taramayı kaybeder).
    expect(tsconfig.content).toContain('"types": ["node", "jest"]');
    // DOM-collision fix'i korunur.
    expect(tsconfig.content).toContain('"lib": ["ES2022"]');
    // Geçerli JSON kalmalı.
    expect(() => JSON.parse(tsconfig.content)).not.toThrow();
  });

  it(".env.example — KÖKTE (H4); env node'larından; secret ASLA gerçek değer almaz", () => {
    const { nodes, edges } = richGraph();
    const files = emitScaffoldProject(ctxFor(nodes, edges));
    const env = fileByPath(files, ".env.example");

    // DefaultValue olan public değişken değerini alır.
    expect(env.content).toContain("DATABASE_URL=postgres://user:password@localhost:5432/app");
    expect(env.content).toContain("PORT=3000");
    // Secret placeholder — gerçek değer yok.
    expect(env.content).toContain("JWT_SECRET=<your-secret-here>");
    // Açıklama + required/optional meta satırı.
    expect(env.content).toContain("# Postgres bağlantı dizesi (Dev/Prod; required)");
    expect(env.content).toContain("# HTTP portu (Dev; optional)");
    // M1: DB havuz/timeout/retry örnek değerleri.
    expect(env.content).toContain("DB_POOL_MAX=10");
    expect(env.content).toContain("DB_CONNECTION_TIMEOUT_MS=10000");
    // L2: CORS + body-limit (CORS boş = kapalı).
    expect(env.content).toContain("CORS_ORIGIN=");
    expect(env.content).toContain("BODY_LIMIT=1mb");
    expect(env.language).toBe("env");
  });

  it("README.md — surgical doldurma talimatı + üretim notu", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes, richGraph().edges));
    const readme = fileByPath(files, "README.md");
    expect(readme.content).toContain("@solarch:surgical");
    expect(readme.content).toContain("NOT_IMPLEMENTED");
    expect(readme.content).toContain("Filling in surgical areas");
    expect(readme.language).toBe("markdown");
  });

  it("#12 README — describes only really-emitted folders (shared guards/decorators conditional)", () => {
    // A graph with NO auth/roles endpoints: shared/guards + shared/decorators are
    //   NOT emitted. README must not claim they unconditionally exist; it states
    //   they are generated only when an endpoint requires auth / declares roles.
    const noAuth = node("Controller", {
      ControllerName: "PublicController",
      Description: "public",
      BaseRoute: "public",
      Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false }],
    });
    const files = emitScaffoldProject(ctxFor([noAuth], []));
    // Guard/decorator stubs are NOT emitted for this graph.
    expect(files.find((f) => f.path === "src/shared/guards/auth.guard.ts")).toBeUndefined();
    expect(files.find((f) => f.path === "src/shared/decorators/roles.decorator.ts")).toBeUndefined();
    // current-user.decorator is also conditional (RequiresAuth / login endpoint).
    expect(
      files.find((f) => f.path === "src/shared/decorators/current-user.decorator.ts"),
    ).toBeUndefined();

    const readme = fileByPath(files, "README.md");
    // filters/ is always present -> always described.
    expect(readme.content).toContain("filters/all-exceptions.filter.ts");
    // guards/decorators are described as CONDITIONAL ("when ...") — kaydırma-toleranslı.
    expect(readme.content).toMatch(/generated when an endpoint\s+requires\s+authentication/);
    expect(readme.content).toMatch(/only when an endpoint\s+declares\s+required roles/);
    // README mentions the (conditional) current-user decorator (Finding #8).
    expect(readme.content).toContain("current-user.decorator.ts");

    // With auth endpoints, ALL three stubs ARE emitted (guard + roles + current-user).
    const withAuth = node("Controller", {
      ControllerName: "SecureController",
      Description: "secure",
      BaseRoute: "secure",
      Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: true, RequiredRoles: ["admin"] }],
    });
    const authFiles = emitScaffoldProject(ctxFor([withAuth], []));
    expect(authFiles.find((f) => f.path === "src/shared/guards/auth.guard.ts")).toBeDefined();
    expect(authFiles.find((f) => f.path === "src/shared/decorators/roles.decorator.ts")).toBeDefined();
    expect(
      authFiles.find((f) => f.path === "src/shared/decorators/current-user.decorator.ts"),
    ).toBeDefined();
  });

  /* ── RBAC WIRE (#39): usesRoles -> GERÇEK RolesGuard emit edilir ──────────
   * Eskiden yalnız roles.decorator (metadata yazan) üretiliyordu; onu OKUYAN guard
   * yoktu -> @Roles ölüydü. Artık roles.guard.ts de üretilir: Reflector ile ROLES_KEY
   * metadata'sını okuyup request.user.role'ü gerekli rollere göre enforce eder. */
  it("usesRoles -> roles.guard.ts (RolesGuard: Reflector + ROLES_KEY metadata okur)", () => {
    const withRoles = node("Controller", {
      ControllerName: "SecureController",
      Description: "secure",
      BaseRoute: "secure",
      Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: true, RequiredRoles: ["admin"] }],
    });
    const files = emitScaffoldProject(ctxFor([withRoles], []));
    const guard = files.find((f) => f.path === "src/shared/guards/roles.guard.ts");
    expect(guard).toBeDefined();
    expect(guard!.content).toContain("export class RolesGuard");
    expect(guard!.content).toContain("Reflector");
    expect(guard!.content).toContain("ROLES_KEY");
    expect(guard!.content).toContain("getAllAndOverride");
    // Rol gerekmiyorsa geçer; aksi halde user.role gerekli rollerden biri olmalı.
    // #58: rol karşılaştırması CASE-INSENSITIVE (graf "ADMIN" ↔ enum "admin" casing
    // uyuşmazlığına dayanıklı; RBAC sessizce kırılmasın).
    expect(guard!.content).toContain("toLowerCase()");
    expect(guard!.content).toMatch(/required\.some\(/);
  });

  /* ── CAPABILITY-LAYER AUTH (#37/#38): AuthGuard GERÇEK JWT doğrular ───────
   * Eskiden AuthGuard `return true` placeholder'dı (surgical, AI dolduruyor -> sahte
   * JWT). Artık deterministik GERÇEK guard: Bearer token'ı JWT_SECRET ile doğrular,
   * request.user'a çözülen claim'leri koyar (@CurrentUser + RolesGuard okur), 401 atar.
   * Artık surgical DEĞİL -> fill dokunmaz; auth strateji = JWT (env JWT_SECRET kullanılır). */
  it("AuthGuard GERÇEK JWT doğrular (deterministik, surgical değil) + jsonwebtoken dep", () => {
    const withAuth = node("Controller", {
      ControllerName: "SecureController",
      Description: "secure",
      BaseRoute: "secure",
      Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: true, RequiredRoles: [] }],
    });
    const files = emitScaffoldProject(ctxFor([withAuth], []));
    const guard = files.find((f) => f.path === "src/shared/guards/auth.guard.ts");
    expect(guard).toBeDefined();
    // Token doğrulama tek-kaynak verifyAccessToken'a delege (auth-token.ts; JWT_SECRET orada).
    expect(guard!.content).toContain("verifyAccessToken");
    expect(guard!.content).toContain("../auth/auth-token");
    expect(guard!.content).toContain("request.user =");
    expect(guard!.content).toContain("UnauthorizedException");
    // Placeholder gitti + artık surgical DEĞİL (fill dokunmaz) + cast yok.
    // (Gerçek guard DA doğrulamadan SONRA return true yapar — koşulsuz değil.)
    expect(guard!.content).not.toContain("@solarch:surgical");
    expect(guard!.surgicalMarkers).toBe(0);
    expect(guard!.content).not.toContain("as any");
    // package.json auth deps (yalnız auth kullanılınca).
    const pkg = files.find((f) => f.path === "package.json");
    expect(pkg!.content).toContain('"jsonwebtoken"');
    expect(pkg!.content).toContain('"@types/jsonwebtoken"');
  });

  /* ── AUTH HELPER'LARI: password (bcrypt) + token (tek-kaynak) ────────────
   * Login/Register fill'i için deterministik primitive'ler: comparePassword/
   * hashPassword (düz-metin karşılaştırma yerine) + signAccessToken/verifyAccessToken
   * (sahte 'token' yerine; AuthGuard ile TEK KAYNAK). usesAuth iken üretilir. */
  it("auth helper'ları üretilir: password.ts (bcrypt) + auth-token.ts (sign/verify)", () => {
    const withAuth = node("Controller", {
      ControllerName: "SecureController",
      Description: "secure",
      BaseRoute: "secure",
      Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: true, RequiredRoles: [] }],
    });
    const files = emitScaffoldProject(ctxFor([withAuth], []));
    const pw = files.find((f) => f.path === "src/shared/auth/password.ts");
    expect(pw, "password.ts üretilmedi").toBeDefined();
    expect(pw!.content).toContain("bcryptjs");
    expect(pw!.content).toContain("export function hashPassword");
    expect(pw!.content).toContain("export function comparePassword");
    const tok = files.find((f) => f.path === "src/shared/auth/auth-token.ts");
    expect(tok, "auth-token.ts üretilmedi").toBeDefined();
    expect(tok!.content).toContain("export function signAccessToken");
    expect(tok!.content).toContain("export function verifyAccessToken");
    expect(tok!.content).toContain("JWT_SECRET");
    // AuthGuard artık tek-kaynak verifyAccessToken'ı kullanır (inline verify değil).
    const guard = files.find((f) => f.path === "src/shared/guards/auth.guard.ts")!;
    expect(guard.content).toContain("verifyAccessToken");
    expect(guard.content).toContain("../auth/auth-token");
    // bcryptjs dep (auth kullanılınca).
    const pkg = files.find((f) => f.path === "package.json")!;
    expect(pkg.content).toContain('"bcryptjs"');
    expect(pkg.content).toContain('"@types/bcryptjs"');
  });

  it("auth YOKKEN jsonwebtoken dep EKLENMEZ (koşullu)", () => {
    const noAuth = node("Controller", {
      ControllerName: "PublicController",
      Description: "public",
      BaseRoute: "public",
      Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false, RequiredRoles: [] }],
    });
    const pkg = emitScaffoldProject(ctxFor([noAuth], [])).find((f) => f.path === "package.json");
    expect(pkg!.content).not.toContain("jsonwebtoken");
  });

  it("package.json — gerekli bağımlılıklar pinlenmiş", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes));
    const pkg = fileByPath(files, "package.json");
    for (const dep of [
      "@nestjs/common",
      "@nestjs/config",
      "@nestjs/core",
      "@nestjs/platform-express",
      "@nestjs/typeorm",
      "class-validator",
      "class-transformer",
      "joi",
      "typeorm",
      "pg",
      "reflect-metadata",
      // L2: helmet + express (main.ts body-limit/CORS) daima.
      "helmet",
      "express",
      // #2 dotenv (data-source CLI) + #10 SnakeNamingStrategy (runtime + CLI).
      "dotenv",
      "typeorm-naming-strategies",
    ]) {
      expect(pkg.content).toContain(`"${dep}"`);
    }
    // L4: paket-yöneticisi pin (README pnpm komutları ile tutarlı; Corepack okur).
    expect(pkg.content).toContain('"packageManager": "pnpm@10.0.0"');
    expect(pkg.language).toBe("json");
  });

  it("main.ts — NestFactory (bufferLogs + Pino logger) + ValidationPipe + ConfigService port", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes));
    const main = fileByPath(files, "src/main.ts");
    // H2: bufferLogs + Pino logger devralır (fail-fast abortOnError varsayılan).
    expect(main.content).toContain("NestFactory.create(AppModule, { bufferLogs: true })");
    expect(main.content).toContain('import { Logger } from "nestjs-pino";');
    expect(main.content).toContain("app.useLogger(app.get(Logger))");
    // #66: whitelist + forbidNonWhitelisted -> bilinmeyen body alanları 400 ile reddedilir
    // (sessizce strip değil); transform -> DTO tip dönüşümü.
    expect(main.content).toContain("whitelist: true");
    expect(main.content).toContain("forbidNonWhitelisted: true");
    expect(main.content).toContain("transform: true");
    // Port ConfigService'ten okunur (env doğrulamasından sonra).
    expect(main.content).toContain("const config = app.get(ConfigService);");
    expect(main.content).toContain('config.get<number>("PORT")');
  });

  it("main.ts — L1 graceful shutdown + L2 helmet/CORS/body-limit (ConfigService-gated)", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes));
    const main = fileByPath(files, "src/main.ts");
    // L1: SIGTERM'de lifecycle hook'ları (TypeORM havuzu temiz kapanır).
    expect(main.content).toContain("app.enableShutdownHooks();");
    // L2: helmet güvenlik başlıkları.
    expect(main.content).toContain('import helmet from "helmet";');
    expect(main.content).toContain("app.use(helmet());");
    // L2: gövde sınırı (ConfigService-gated, makul default).
    expect(main.content).toContain('import { json, urlencoded } from "express";');
    expect(main.content).toContain('config.get<string>("BODY_LIMIT") ?? "1mb"');
    expect(main.content).toContain("app.use(json({ limit: bodyLimit }));");
    // L2: CORS yalnız CORS_ORIGIN tanımlıysa açılır (yoksa kapalı — prod-güvenli).
    expect(main.content).toContain('config.get<string>("CORS_ORIGIN")');
    expect(main.content).toContain("app.enableCors({");
  });

  /* ── Self-documenting app: @nestjs/swagger document + Scalar /docs ────────
   * Generated main.ts builds an OpenAPI document from the swagger decorators and
   * serves an interactive Scalar reference at /docs. A SEPARATE DOCS_CORS_ORIGIN
   * flag lets the Solarch app issue "try it" requests at the running server
   * WITHOUT loosening the prod CORS_ORIGIN allowlist. */
  it("main.ts — SwaggerModule document + Scalar /docs + separate DOCS_CORS_ORIGIN", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes));
    const main = fileByPath(files, "src/main.ts");
    // OpenAPI document built from the @nestjs/swagger decorators.
    expect(main.content).toContain('from "@nestjs/swagger";');
    expect(main.content).toContain("SwaggerModule.createDocument");
    // Scalar interactive reference served at /docs.
    expect(main.content).toContain('from "@scalar/nestjs-api-reference";');
    expect(main.content).toContain("apiReference(");
    expect(main.content).toContain('app.use("/docs"');
    // DOCS_CORS_ORIGIN is a SEPARATE dev/docs allowance (never folded into the
    //   prod CORS_ORIGIN); prod CORS_ORIGIN handling stays intact.
    expect(main.content).toContain('config.get<string>("DOCS_CORS_ORIGIN")');
    expect(main.content).toContain('config.get<string>("CORS_ORIGIN")');
  });

  it("package.json — self-documenting deps (@nestjs/swagger + @scalar/nestjs-api-reference)", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes));
    const pkg = fileByPath(files, "package.json");
    expect(pkg.content).toContain('"@nestjs/swagger"');
    expect(pkg.content).toContain('"@scalar/nestjs-api-reference"');
  });

  it("env.validation.ts — Joi şeması DAİMA üretilir (DATABASE_URL required, fail-fast)", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes));
    const v = fileByPath(files, "src/config/env.validation.ts");
    expect(v.content).toContain('import Joi from "joi";');
    expect(v.content).toContain("export const validationSchema = Joi.object({");
    // DATABASE_URL daima zorunlu (TypeORM forRootAsync bunu getOrThrow ile okur).
    expect(v.content).toContain("DATABASE_URL: Joi.string().required(),");
    // DefaultValue olan public değişken default() alır (required ile çelişmez).
    expect(v.content).toContain("PORT: Joi.number().default(3000),");
    // Secret + required (default'suz) -> required().
    expect(v.content).toContain("JWT_SECRET: Joi.string().required(),");
    // M1: DB havuz/timeout/retry knob'ları (default'lu opsiyonel sayılar).
    expect(v.content).toContain("DB_POOL_MAX: Joi.number().default(10),");
    expect(v.content).toContain("DB_CONNECTION_TIMEOUT_MS: Joi.number().default(10000),");
    expect(v.content).toContain("DB_RETRY_ATTEMPTS: Joi.number().default(10),");
    expect(v.content).toContain("DB_RETRY_DELAY_MS: Joi.number().default(3000),");
    // L2: CORS_ORIGIN opsiyonel (boşsa kapalı), BODY_LIMIT default'lu.
    expect(v.content).toContain('CORS_ORIGIN: Joi.string().allow("").optional(),');
    expect(v.content).toContain('BODY_LIMIT: Joi.string().default("1mb"),');
  });

  it("tüm içerikler tek satır sonu ile biter", () => {
    const files = emitScaffoldProject(ctxFor(richGraph().nodes, richGraph().edges));
    for (const f of files) {
      expect(f.content.endsWith("\n")).toBe(true);
      expect(f.content.endsWith("\n\n")).toBe(false);
    }
  });

  it("DETERMİNİZM: aynı graph iki kez -> byte-identical", () => {
    const { nodes, edges } = richGraph();
    const a = emitScaffoldProject(ctxFor(nodes, edges));
    const b = emitScaffoldProject(ctxFor(nodes, edges));
    expect(a.map((f) => f.content)).toEqual(b.map((f) => f.content));
  });

  it("snapshot — app.module.ts tam içerik (İNCE; CoreModule + feature'lar)", () => {
    const { nodes, edges } = richGraph();
    const app = fileByPath(emitScaffoldProject(ctxFor(nodes, edges)), "src/app.module.ts");
    expect(app.content).toMatchInlineSnapshot(`
      "import { Module } from "@nestjs/common";
      import { ClockModule } from "./clock/clock.module";
      import { CoreModule } from "./core/core.module";
      import { HealthModule } from "./health/health.module";
      import { UsersModule } from "./users/users.module";

      @Module({
        imports: [
          CoreModule,
          ClockModule,
          HealthModule,
          UsersModule,
        ],
      })
      export class AppModule {}
      "
    `);
  });

  it("snapshot — core.module.ts tam içerik (TÜM root altyapı + APP_FILTER + Pino)", () => {
    const { nodes, edges } = richGraph();
    const core = fileByPath(emitScaffoldProject(ctxFor(nodes, edges)), "src/core/core.module.ts");
    expect(core.content).toMatchInlineSnapshot(`
      "import { Module } from "@nestjs/common";
      import { ConfigModule, ConfigService } from "@nestjs/config";
      import { APP_FILTER } from "@nestjs/core";
      import { TypeOrmModule } from "@nestjs/typeorm";
      import { LoggerModule } from "nestjs-pino";
      import { SnakeNamingStrategy } from "typeorm-naming-strategies";
      import configuration from "../config/configuration";
      import { validationSchema } from "../config/env.validation";
      import { AllExceptionsFilter } from "../shared/filters/all-exceptions.filter";

      /**
       * Solarch-generated core infrastructure module. It gathers everything that is
       * registered exactly ONCE across the application (Config/Logger/TypeORM and, per
       * the graph, Cache/Queue/Schedule/Events) + the global exception filter. AppModule
       * imports only this; root forRoot/register is never repeated anywhere else.
       */
      @Module({
        imports: [
          ConfigModule.forRoot({ isGlobal: true, load: [configuration], validationSchema }),
          LoggerModule.forRoot({
            pinoHttp: {
              level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
              transport:
                process.env.NODE_ENV === "production"
                  ? undefined
                  : { target: "pino-pretty", options: { singleLine: true } },
            },
          }),
          TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
              type: "postgres" as const,
              url: config.getOrThrow<string>("DATABASE_URL"),
              autoLoadEntities: true,
              synchronize: false,
              // Map PascalCase/camelCase entity members to snake_case DB columns
              //   (same strategy as data-source.ts, consistent with the migrations).
              namingStrategy: new SnakeNamingStrategy(),
              // Pool + timeout (passed to the pg driver via \`extra\`).
              extra: {
                max: config.get<number>("DB_POOL_MAX") ?? 10,
                connectionTimeoutMillis: config.get<number>("DB_CONNECTION_TIMEOUT_MS") ?? 10000,
              },
              // Bounded retry (NO infinite retry; it stops at boot sooner or later).
              retryAttempts: config.get<number>("DB_RETRY_ATTEMPTS") ?? 10,
              retryDelay: config.get<number>("DB_RETRY_DELAY_MS") ?? 3000,
            }),
          }),
        ],
        providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
      })
      export class CoreModule {}
      "
    `);
  });

  /* ── Edge-case: boş graph / kayıp env ──────────────────────────────── */
  it("EDGE-CASE: boş graph -> sabit iskelet, app.module ince, env varsayılan", () => {
    const files = emitScaffoldProject(ctxFor([], []));
    // 15 dosya: temel iskelet (package/tsconfig x2/nest-cli/jest-e2e/.gitignore/
    //   main/app.module/core.module/filter/env.validation/data-source/e2e/.env.example/
    //   README). EnvVar node yok -> configuration.ts YOK; auth/roles stub YOK.
    expect(files).toHaveLength(15);

    const app = fileByPath(files, "src/app.module.ts");
    // İNCE app.module: yalnız CoreModule; root forRoot CoreModule'de.
    expect(app.content).toContain("    CoreModule,");
    expect(app.content).not.toContain("TypeOrmModule.forRootAsync");
    expect(app.content).not.toContain("controllers:");
    expect(app.content).not.toContain("providers:");

    const core = fileByPath(files, "src/core/core.module.ts");
    // EnvVar yok -> load: [configuration] YOK.
    expect(core.content).toContain("ConfigModule.forRoot({ isGlobal: true, validationSchema })");
    expect(core.content).toContain("TypeOrmModule.forRootAsync({");
    // env.validation.ts daima var (DATABASE_URL zorunlu).
    const v = fileByPath(files, "src/config/env.validation.ts");
    expect(v.content).toContain("DATABASE_URL: Joi.string().required(),");

    const env = fileByPath(files, ".env.example");
    // Env node yok -> makul varsayılanlara düşer.
    expect(env.content).toContain("PORT=3000");
    expect(env.content).toContain("DATABASE_URL=postgres://user:password@localhost:5432/app");
    // Üretilen hiçbir env satırı yok (env node'u yok), ama dosya geçerli.
    expect(env.content).not.toContain("<your-secret-here>");
  });

  it("EDGE-CASE: Module node'suz tek Controller bile kendi feature modülünü alır (sahipsiz kalmaz)", () => {
    // Yalnız bir Controller (hiç Module / CALLS edge yok) -> kendi feature'ı
    // ("ping") + sentezlenmiş PingModule; app.module ham controller DEĞİL,
    // PingModule'ü import eder -> DI tam.
    const lone = node("Controller", {
      ControllerName: "PingController",
      Description: "ping",
      BaseRoute: "ping",
      Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false }],
    });
    const files = emitScaffoldProject(ctxFor([lone], []));
    const app = fileByPath(files, "src/app.module.ts");
    expect(app.content).toContain("    PingModule,");
    expect(app.content).toContain('import { PingModule } from "./ping/ping.module";');
    // Ham controller app.module'e GİRMEZ (feature modülüne kapsüllendi).
    expect(app.content).not.toContain("controllers:");
    expect(app.content).not.toContain("PingController");
  });
});

describe("fillDepsPackageJson (doğrulanmış in-app fill deps SÜPERSET)", () => {
  it("buildPackageJson'ın TÜM koşullu deps'lerini + test toolchain'ini içerir", () => {
    const pkg = JSON.parse(fillDepsPackageJson()) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // Koşullu deps (cache/queue/http/schedule/event-emitter/redis) hepsi açık olmalı:
    // cache node_modules'ün üretilen HER import'u çözmesi gerekir.
    for (const dep of ["@nestjs/cache-manager", "cache-manager", "@keyv/redis", "@nestjs/bullmq", "bullmq", "@nestjs/axios", "axios", "@nestjs/schedule", "@nestjs/event-emitter"]) {
      expect(pkg.dependencies[dep], `eksik dep: ${dep}`).toBeDefined();
    }
    // Çekirdek runtime + tsc/jest (doğrulama bunlarsız koşamaz).
    expect(pkg.dependencies["typeorm"]).toBeDefined();
    expect(pkg.dependencies["@nestjs/typeorm"]).toBeDefined();
    expect(pkg.devDependencies["typescript"]).toBeDefined();
    expect(pkg.devDependencies["jest"]).toBeDefined();
    expect(pkg.devDependencies["ts-jest"]).toBeDefined();
  });

  it("tsgo (native-preview) YALNIZ fill-deps cache'inde — kullanıcı projesine sızmaz", () => {
    const fillDeps = JSON.parse(fillDepsPackageJson()) as { devDependencies: Record<string, string> };
    // Cache: in-app SOLARCH_USE_TSGO=1 geçidi için tsgo binary'sini bulur.
    expect(fillDeps.devDependencies["@typescript/native-preview"]).toBeDefined();
    // Üretilen kullanıcı projesi (emitScaffoldProject package.json): pre-release araç GİRMEZ.
    const userPkg = fileByPath(emitScaffoldProject(ctxFor(richGraph().nodes, richGraph().edges)), "package.json");
    expect(userPkg.content).not.toContain("native-preview");
  });
});
