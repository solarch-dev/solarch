import { describe, it, expect } from "vitest";
import { emitFeatureModule } from "./module.emitter";
import { buildCodeGraph, type CodeGraph, type Feature } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { NodeKind } from "../../../nodes/schemas";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ────────────────────────────────────────────────────────────────────────
 * module.emitter.spec.ts — FEATURE-MODULE SENTEZI.
 *
 * Yeni API: emitFeatureModule(feature, ctx). Girdi artik ham Module node NOT,
 * ir.ts feature-inference'in urettigi bir `Feature` tanimidir. Module node
 * OLMASA bile her cikarilmis feature icin bir <feature>/<feature>.module.ts
 * sentezlenir; app.module bunlari import eder -> DI tam, uygulama BOOT BOOTS.
 * ──────────────────────────────────────────────────────────────────────── */

/* ── Fixture helpers ──────────────────────────────────────────────── */
let nodeSeq = 0;
function node(type: NodeKind, properties: Record<string, unknown>, id?: string): StoredNode {
  const n = (nodeSeq += 1);
  return {
    id: id ?? `0000000${n}-0000-4000-8000-000000000000`.slice(-36),
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

let edgeSeq = 0;
function edge(kind: EdgeKind, sourceNodeId: string, targetNodeId: string): StoredEdge {
  const n = (edgeSeq += 1);
  return {
    id: `e000000${n}-0000-4000-8000-000000000000`.slice(-36),
    projectId: "00000000-0000-4000-8000-000000000000",
    sourceNodeId,
    targetNodeId,
    kind,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: false },
  };
}

function ctxFor(nodes: StoredNode[], edges: StoredEdge[]): EmitterContext {
  return { graph: buildCodeGraph(nodes, edges), target: "nestjs" };
}

function featureBySlug(graph: CodeGraph, slug: string): Feature {
  const f = graph.features().find((x) => x.slug === slug);
  if (!f) throw new Error(`feature '${slug}' not found: ${graph.features().map((x) => x.slug)}`);
  return f;
}

/* ── Gercekci "users" feature fixture'i (Module node NONE -> sentez) ─────────
 * Controller -CALLS-> Service -CALLS-> Repository -WRITES-> Model(+Table).
 * Feature-inference: tek "users" feature; controller/service/repository/entity
 * hepsi bu feature'a atanir. */
function usersFixture() {
  const userModel = node("Model", {
    ClassName: "User",
    Description: "User varligi",
    TableRef: "users",
    Properties: [{ Name: "id", Type: "uuid", IsNullable: false, IsCollection: false }],
    Methods: [],
  });
  const usersTable = node("Table", {
    TableName: "users",
    Description: "User table",
    Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true }],
  });
  const usersRepo = node("Repository", {
    RepositoryName: "UserRepository",
    Description: "User veri erisimi",
    EntityReference: "User",
    IsCached: false,
    CustomQueries: [],
  });
  const usersService = node("Service", {
    ServiceName: "UsersService",
    Description: "User is mantigi",
    IsTransactionScoped: false,
    Methods: [{ MethodName: "findAll", ReturnType: "User[]", IsAsync: true }],
    Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }],
  });
  const usersController = node("Controller", {
    ControllerName: "UsersController",
    Description: "User uclari",
    BaseRoute: "users",
    Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false }],
  });

  const edges: StoredEdge[] = [
    edge("CALLS", usersController.id, usersService.id),
    edge("CALLS", usersService.id, usersRepo.id),
    edge("WRITES", usersRepo.id, usersTable.id),
  ];

  return {
    nodes: [userModel, usersTable, usersRepo, usersService, usersController],
    edges,
  };
}

describe("emitFeatureModule", () => {
  it("tam users modulu (Module node NONE -> sentez) — snapshot", () => {
    const fx = usersFixture();
    const ctx = ctxFor(fx.nodes, fx.edges);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { Module } from "@nestjs/common";
      import { TypeOrmModule } from "@nestjs/typeorm";
      import { User } from "./entities/user.entity";
      import { UserRepository } from "./user.repository";
      import { UsersController } from "./users.controller";
      import { UsersService } from "./users.service";

      /** Users feature module (synthesized by Solarch). */
      @Module({
        imports: [TypeOrmModule.forFeature([User])],
        controllers: [UsersController],
        providers: [UsersService, UserRepository],
      })
      export class UsersModule {}
      ",
        "language": "typescript",
        "path": "users/users.module.ts",
        "surgicalMarkers": 0,
      }
    `);
  });

  it("dosya yolu <feature>/<feature>.module.ts (feature basina TEK module)", () => {
    const fx = usersFixture();
    const ctx = ctxFor(fx.nodes, fx.edges);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx);
    expect(file.path).toBe("users/users.module.ts");
  });

  it("@Module dekoratoru + DI: controllers/providers + TypeOrmModule.forFeature", () => {
    const fx = usersFixture();
    const ctx = ctxFor(fx.nodes, fx.edges);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx);
    expect(file.content).toContain("@Module({");
    expect(file.content).toContain("controllers: [UsersController],");
    // providers = service'ler + repository'ler (DI tam; repository kayitli).
    expect(file.content).toContain("providers: [UsersService, UserRepository],");
    expect(file.content).toContain("imports: [TypeOrmModule.forFeature([User])],");
    expect(file.content).toContain("export class UsersModule {}");
  });

  it("import cozumleme: @nestjs/common + @nestjs/typeorm + feature-ici goreli importlar", () => {
    const fx = usersFixture();
    const ctx = ctxFor(fx.nodes, fx.edges);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx);
    expect(file.content).toContain('import { Module } from "@nestjs/common";');
    expect(file.content).toContain('import { TypeOrmModule } from "@nestjs/typeorm";');
    expect(file.content).toContain('import { UsersService } from "./users.service";');
    expect(file.content).toContain('import { UserRepository } from "./user.repository";');
    expect(file.content).toContain('import { User } from "./entities/user.entity";');
    // Paketler once, goreli sonra (import siralamasi).
    const pkgIdx = file.content.indexOf("@nestjs/common");
    const relIdx = file.content.indexOf("./users.service");
    expect(pkgIdx).toBeGreaterThanOrEqual(0);
    expect(pkgIdx).toBeLessThan(relIdx);
  });

  it("content ends with single newline, surgical marker yok", () => {
    const fx = usersFixture();
    const ctx = ctxFor(fx.nodes, fx.edges);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx);
    expect(file.content.endsWith("{}\n")).toBe(true);
    expect(file.content.endsWith("{}\n\n")).toBe(false);
    expect(file.surgicalMarkers).toBe(0);
  });

  it("DETERMINISM: ayni feature iki kez -> byte-identical", () => {
    const fx = usersFixture();
    const ctx = ctxFor(fx.nodes, fx.edges);
    const a = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx)[0].content;
    const b = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx)[0].content;
    expect(a).toBe(b);
  });

  /* ── CROSS-FEATURE: bir feature baska feature'in service'ini cagirirsa ──── */
  it("cross-feature bagimlilik: dependsOn modulu import + kaynak feature service'i export eder", () => {
    // image feature ImageService -CALLS-> AuthService (auth feature). Beklenen:
    //   - auth modulu AuthService'i EXPORT eder (baska feature kullaniyor).
    //   - image modulu AuthModule'u IMPORT eder (dependsOn=[auth]).
    const authCtrl = node("Controller", {
      ControllerName: "AuthController",
      Description: "Kimlik uclari",
      BaseRoute: "auth",
      Endpoints: [],
    });
    const authSvc = node("Service", {
      ServiceName: "AuthService",
      Description: "Kimlik mantigi",
      Dependencies: [],
      Methods: [],
    });
    const imageCtrl = node("Controller", {
      ControllerName: "ImageController",
      Description: "Gorsel uclari",
      BaseRoute: "image",
      Endpoints: [],
    });
    const imageSvc = node("Service", {
      ServiceName: "ImageService",
      Description: "Gorsel mantigi",
      Dependencies: [],
      Methods: [],
    });
    const edges = [
      edge("CALLS", authCtrl.id, authSvc.id),
      edge("CALLS", imageCtrl.id, imageSvc.id),
      edge("CALLS", imageSvc.id, authSvc.id), // cross-feature
    ];
    const ctx = ctxFor([authCtrl, authSvc, imageCtrl, imageSvc], edges);

    const authFile = emitFeatureModule(featureBySlug(ctx.graph, "auth"), ctx)[0];
    expect(authFile.content).toContain("exports: [AuthService],");

    const imageFile = emitFeatureModule(featureBySlug(ctx.graph, "image"), ctx)[0];
    expect(imageFile.content).toContain("imports: [AuthModule],");
    expect(imageFile.content).toContain('import { AuthModule } from "../auth/auth.module";');
  });

  /* ── KARSILIKLI (circular) import: geri-kenar forwardRef ile emit edilir ── */
  it("karsilikli cross-feature: geri-kenar forwardRef(() => X) ile emit edilir (boot circular yok)", () => {
    // auth <-> image karsilikli CALLS. ir.ts geri-kenari ((to,from) en kucuk =
    // image -> auth) forwardRef ile isaretler -> image modulu AuthModule'u
    // forwardRef(() => AuthModule) ile import BOOTS (kenar KORUNUR); auth duz import BOOTS.
    const authCtrl = node("Controller", { ControllerName: "AuthController", Description: "x", BaseRoute: "auth", Endpoints: [] });
    const authSvc = node("Service", { ServiceName: "AuthService", Description: "x", Dependencies: [], Methods: [] });
    const imageCtrl = node("Controller", { ControllerName: "ImageController", Description: "x", BaseRoute: "image", Endpoints: [] });
    const imageSvc = node("Service", { ServiceName: "ImageService", Description: "x", Dependencies: [], Methods: [] });
    const edges = [
      edge("CALLS", authCtrl.id, authSvc.id),
      edge("CALLS", imageCtrl.id, imageSvc.id),
      edge("CALLS", imageSvc.id, authSvc.id), // image -> auth
      edge("CALLS", authSvc.id, imageSvc.id), // auth -> image (karsilikli)
    ];
    const ctx = ctxFor([authCtrl, authSvc, imageCtrl, imageSvc], edges);

    const authFile = emitFeatureModule(featureBySlug(ctx.graph, "auth"), ctx)[0];
    const imageFile = emitFeatureModule(featureBySlug(ctx.graph, "image"), ctx)[0];

    // Eager yon (auth -> image) duz import KORUNUR (forwardRef NONE bu yonde).
    expect(authFile.content).toContain("imports: [ImageModule],");
    expect(authFile.content).toContain('import { ImageModule } from "../image/image.module";');
    expect(authFile.content).not.toContain("forwardRef");
    // Geri-kenar (image -> auth) forwardRef ile emit edilir; KENAR KORUNUR (provider import'u kaybolmaz).
    expect(imageFile.content).toContain("imports: [forwardRef(() => AuthModule)],");
    expect(imageFile.content).toContain('import { Module, forwardRef } from "@nestjs/common";');
    expect(imageFile.content).toContain('import { AuthModule } from "../auth/auth.module";');
    // DI yine saglam: iki servis de export edilir.
    expect(authFile.content).toContain("exports: [AuthService],");
    expect(imageFile.content).toContain("exports: [ImageService],");
  });

  /* ── Acik Module node feature'i tohumlarsa Description KORUNUR ──────────── */
  it("acik Module node varsa: feature slug'i tohumlar + Description korunur", () => {
    const mod = node("Module", {
      ModuleName: "AuthModule",
      Description: "Kimlik dogrulama modulu",
      StrictBoundaries: true,
      ExposedServices: ["AuthService"],
      Dependencies: [],
    });
    const ctrl = node("Controller", {
      ControllerName: "AuthController",
      Description: "Kimlik uclari",
      BaseRoute: "auth",
      Endpoints: [],
    });
    const svc = node("Service", {
      ServiceName: "AuthService",
      Description: "Kimlik mantigi",
      Dependencies: [],
      Methods: [],
    });
    const edges = [edge("CALLS", ctrl.id, svc.id), edge("USES", mod.id, svc.id)];
    const ctx = ctxFor([mod, ctrl, svc], edges);
    const feature = featureBySlug(ctx.graph, "auth");
    expect(feature.module?.id).toBe(mod.id);
    const [file] = emitFeatureModule(feature, ctx);
    // Module.Description -> dosya basi yorumu (sentez varsayilan metni NOT).
    expect(file.content).toContain("/** Kimlik dogrulama modulu */");
    expect(file.content).toContain("export class AuthModule {}");
    expect(file.path).toBe("auth/auth.module.ts");
  });

  /* ── CROSS-FEATURE Service->Repository: owner modul Repository'yi EXPORT eder ── */
  it("cross-feature Service->Repository: owner modul Repository'yi EXPORT eder, tuketici dependsOn", () => {
    // image feature ImageGenerationService -CALLS-> UserRepository (auth feature).
    // Beklenen: AuthModule UserRepository'yi EXPORT eder (NestJS'te export edilmeyen
    // provider modul-disi gorunmez -> bootta DI hatasi); ImageModule AuthModule import.
    const authCtrl = node("Controller", { ControllerName: "AuthController", Description: "x", BaseRoute: "auth", Endpoints: [] });
    const authSvc = node("Service", { ServiceName: "AuthService", Description: "x", Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }], Methods: [] });
    const userRepo = node("Repository", { RepositoryName: "UserRepository", Description: "x", EntityReference: "User", CustomQueries: [] });
    const userModel = node("Model", { ClassName: "User", Description: "x", Properties: [{ Name: "id", Type: "uuid" }], Methods: [] });
    const imageCtrl = node("Controller", { ControllerName: "ImageController", Description: "x", BaseRoute: "image", Endpoints: [] });
    const imageSvc = node("Service", { ServiceName: "ImageGenerationService", Description: "x", Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }], Methods: [] });
    const edges = [
      edge("CALLS", authCtrl.id, authSvc.id),
      edge("CALLS", authSvc.id, userRepo.id),
      edge("CALLS", imageCtrl.id, imageSvc.id),
      edge("CALLS", imageSvc.id, userRepo.id), // CROSS-FEATURE Service->Repository
    ];
    const ctx = ctxFor([authCtrl, authSvc, userRepo, userModel, imageCtrl, imageSvc], edges);

    // UserRepository hangi feature'a dustu? (firstSourceFeature isimce ilk = auth.)
    const authFeature = ctx.graph.features().find((f) => f.repositories.some((r) => r.name === "UserRepository"));
    expect(authFeature?.slug).toBe("auth");

    const authFile = emitFeatureModule(featureBySlug(ctx.graph, "auth"), ctx)[0];
    // Repository EXPORT edilir (Service degil sadece -> Repository de aday).
    expect(authFile.content).toContain("exports: [UserRepository],");

    const imageFile = emitFeatureModule(featureBySlug(ctx.graph, "image"), ctx)[0];
    expect(imageFile.content).toContain("imports: [AuthModule],");
  });

  /* ── Enjekte edilen Cache/ExternalService TAM provider'lari module'da ───── */
  it("CACHES_IN/REQUESTS edge'li Service -> Cache/ExternalService TAM provider + module import'lari", () => {
    const ctrl = node("Controller", { ControllerName: "ImageController", Description: "x", BaseRoute: "image", Endpoints: [] });
    const svc = node("Service", {
      ServiceName: "ImageService",
      Description: "x",
      Dependencies: [{ Kind: "Cache", Ref: "ImageCache" }, { Kind: "ExternalService", Ref: "SdApi" }],
      Methods: [],
    });
    const cache = node("Cache", { CacheName: "ImageCache", Description: "x", KeyPattern: "img:{id}", TTL_Seconds: 60, Engine: "Redis" });
    const ext = node("ExternalService", { ServiceName: "SdApi", Description: "x", BaseURL: "https://sd.example.com", AuthType: "None", TimeoutSeconds: 10, Endpoints: [] });
    const edges = [
      edge("CALLS", ctrl.id, svc.id),
      edge("CACHES_IN", svc.id, cache.id),
      edge("REQUESTS", svc.id, ext.id),
    ];
    const ctx = ctxFor([ctrl, svc, cache, ext], edges);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "image"), ctx);
    // Cache/ExternalService artik TAM emitter -> gercek sinif adi (Stub eki NONE).
    expect(file.content).toContain("providers: [ImageService, ImageCache, SdApi],");
    expect(file.content).not.toContain("Stub");
    expect(file.content).toContain('import { ImageCache } from "./image.cache";');
    expect(file.content).toContain('import { SdApi } from "./sd.client";');
    // Module-seviyesi altyapi import'lari: CacheModule + HttpModule + ConfigModule.
    expect(file.content).toContain("CacheModule.register()");
    expect(file.content).toContain("HttpModule");
    expect(file.content).toContain("ConfigModule");
  });

  /* ── Table-only (Model'siz) feature: sentetik entity forFeature'a girer ──── */
  it("Model'siz Table feature: sentetik entity TypeOrmModule.forFeature'a eklenir", () => {
    const ctrl = node("Controller", { ControllerName: "ImageController", Description: "x", BaseRoute: "image", Endpoints: [] });
    const svc = node("Service", { ServiceName: "ImageService", Description: "x", Dependencies: [{ Kind: "Repository", Ref: "ImageRepository" }], Methods: [] });
    const repo = node("Repository", { RepositoryName: "ImageRepository", Description: "x", EntityReference: "GeneratedImages", CustomQueries: [] });
    const table = node("Table", { TableName: "GeneratedImages", Description: "x", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }] });
    const edges = [edge("CALLS", ctrl.id, svc.id), edge("CALLS", svc.id, repo.id), edge("WRITES", repo.id, table.id)];
    const ctx = ctxFor([ctrl, svc, repo, table], edges);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "image"), ctx);
    // Model NONE ama sentetik GeneratedImage entity forFeature'a girer -> DI tam.
    expect(file.content).toContain("TypeOrmModule.forFeature([GeneratedImage])");
    expect(file.content).toContain('import { GeneratedImage } from "./entities/generated-image.entity";');
    expect(file.content).toContain("providers: [ImageService, ImageRepository],");
  });

  /* ── #7 cross-feature infra provider TEK module'de provider (singleton) ──── */
  it("cift-inject: PaymentGateway YALNIZ payment module'unde provider; order import eder", () => {
    // payment + order IKISI de PaymentGateway (ExternalService) enjekte eder.
    // Eski hata: gateway iki module'un de providers'inda -> iki ornek (singleton kirik).
    // Beklenen: yalniz PaymentModule provider+export eder; OrderModule PaymentModule import.
    const payCtrl = node("Controller", { ControllerName: "PaymentController", Description: "x", BaseRoute: "payment", Endpoints: [] });
    const paySvc = node("Service", { ServiceName: "PaymentService", Description: "x", Dependencies: [{ Kind: "ExternalService", Ref: "PaymentGateway" }], Methods: [] });
    const orderCtrl = node("Controller", { ControllerName: "OrderController", Description: "x", BaseRoute: "order", Endpoints: [] });
    const orderSvc = node("Service", { ServiceName: "OrderService", Description: "x", Dependencies: [{ Kind: "ExternalService", Ref: "PaymentGateway" }], Methods: [] });
    const gw = node("ExternalService", { ServiceName: "PaymentGateway", Description: "x", BaseURL: "https://pg.example.com", AuthType: "None", TimeoutSeconds: 10, Endpoints: [] });
    const edges = [
      edge("CALLS", payCtrl.id, paySvc.id),
      edge("CALLS", orderCtrl.id, orderSvc.id),
      edge("REQUESTS", paySvc.id, gw.id),
      edge("REQUESTS", orderSvc.id, gw.id),
      edge("CALLS", orderSvc.id, paySvc.id),
    ];
    const ctx = ctxFor([payCtrl, paySvc, orderCtrl, orderSvc, gw], edges);

    const paymentFile = emitFeatureModule(featureBySlug(ctx.graph, "payment"), ctx)[0];
    const orderFile = emitFeatureModule(featureBySlug(ctx.graph, "order"), ctx)[0];

    // Sahip (payment): PaymentGateway providers + exports + import edilen sinif.
    expect(paymentFile.content).toContain("providers: [PaymentService, PaymentGateway],");
    expect(paymentFile.content).toContain("exports: [PaymentService, PaymentGateway],");
    expect(paymentFile.content).toContain('import { PaymentGateway } from "./payment-gateway.client";');

    // Sahip-DISI (order): PaymentGateway'i providers'a YAZMAZ, sinifi import ETMEZ.
    expect(orderFile.content).not.toContain("PaymentGateway");
    expect(orderFile.content).toContain("providers: [OrderService],");
    // PaymentModule'u import eder (gateway + PaymentService oradan gelir).
    expect(orderFile.content).toContain("imports: [PaymentModule],");
    expect(orderFile.content).toContain('import { PaymentModule } from "../payment/payment.module";');

    // forwardRef ASLA uretilmez; dongu yok.
    expect(paymentFile.content).not.toContain("forwardRef");
    expect(orderFile.content).not.toContain("forwardRef");
  });

  it("entity yoksa imports alani atlanir (bos @Module alanlari yazilmaz)", () => {
    // Controller + Service var ama Model/Table NONE -> TypeOrmModule.forFeature yok,
    // cross-feature bagimlilik yok -> imports alani tamamen atlanir.
    const ctrl = node("Controller", {
      ControllerName: "PingController",
      Description: "Saglik",
      BaseRoute: "ping",
      Endpoints: [],
    });
    const svc = node("Service", {
      ServiceName: "PingService",
      Description: "Saglik mantigi",
      Dependencies: [],
      Methods: [],
    });
    const ctx = ctxFor([ctrl, svc], [edge("CALLS", ctrl.id, svc.id)]);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "ping"), ctx);
    expect(file.content).not.toContain("imports:");
    expect(file.content).not.toContain("TypeOrmModule");
    expect(file.content).not.toContain("exports:");
    expect(file.content).toContain("controllers: [PingController],");
    expect(file.content).toContain("providers: [PingService],");
    expect(file.content).toContain("export class PingModule {}");
  });
});
