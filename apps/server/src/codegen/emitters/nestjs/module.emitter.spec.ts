import { describe, it, expect } from "vitest";
import { emitFeatureModule } from "./module.emitter";
import { buildCodeGraph, type CodeGraph, type Feature } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { NodeKind } from "../../../nodes/schemas";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ────────────────────────────────────────────────────────────────────────
 * module.emitter.spec.ts — FEATURE-MODULE SENTEZİ.
 *
 * Yeni API: emitFeatureModule(feature, ctx). Girdi artık ham Module node DEĞİL,
 * ir.ts feature-inference'ın ürettiği bir `Feature` tanımıdır. Module node
 * OLMASA bile her çıkarılmış feature için bir <feature>/<feature>.module.ts
 * sentezlenir; app.module bunları import eder -> DI tam, uygulama BOOT EDER.
 * ──────────────────────────────────────────────────────────────────────── */

/* ── Fixture yardımcıları ──────────────────────────────────────────────── */
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
  if (!f) throw new Error(`feature '${slug}' bulunamadı: ${graph.features().map((x) => x.slug)}`);
  return f;
}

/* ── Gerçekçi "users" feature fixture'ı (Module node YOK -> sentez) ─────────
 * Controller -CALLS-> Service -CALLS-> Repository -WRITES-> Model(+Table).
 * Feature-inference: tek "users" feature; controller/service/repository/entity
 * hepsi bu feature'a atanır. */
function usersFixture() {
  const userModel = node("Model", {
    ClassName: "User",
    Description: "Kullanıcı varlığı",
    TableRef: "users",
    Properties: [{ Name: "id", Type: "uuid", IsNullable: false, IsCollection: false }],
    Methods: [],
  });
  const usersTable = node("Table", {
    TableName: "users",
    Description: "Kullanıcı tablosu",
    Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true }],
  });
  const usersRepo = node("Repository", {
    RepositoryName: "UserRepository",
    Description: "Kullanıcı veri erişimi",
    EntityReference: "User",
    IsCached: false,
    CustomQueries: [],
  });
  const usersService = node("Service", {
    ServiceName: "UsersService",
    Description: "Kullanıcı iş mantığı",
    IsTransactionScoped: false,
    Methods: [{ MethodName: "findAll", ReturnType: "User[]", IsAsync: true }],
    Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }],
  });
  const usersController = node("Controller", {
    ControllerName: "UsersController",
    Description: "Kullanıcı uçları",
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
  it("tam users modülü (Module node YOK -> sentez) — snapshot", () => {
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

  it("dosya yolu <feature>/<feature>.module.ts (feature başına TEK module)", () => {
    const fx = usersFixture();
    const ctx = ctxFor(fx.nodes, fx.edges);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx);
    expect(file.path).toBe("users/users.module.ts");
  });

  it("@Module dekoratörü + DI: controllers/providers + TypeOrmModule.forFeature", () => {
    const fx = usersFixture();
    const ctx = ctxFor(fx.nodes, fx.edges);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx);
    expect(file.content).toContain("@Module({");
    expect(file.content).toContain("controllers: [UsersController],");
    // providers = service'ler + repository'ler (DI tam; repository kayıtlı).
    expect(file.content).toContain("providers: [UsersService, UserRepository],");
    expect(file.content).toContain("imports: [TypeOrmModule.forFeature([User])],");
    expect(file.content).toContain("export class UsersModule {}");
  });

  it("import çözümleme: @nestjs/common + @nestjs/typeorm + feature-içi göreli importlar", () => {
    const fx = usersFixture();
    const ctx = ctxFor(fx.nodes, fx.edges);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx);
    expect(file.content).toContain('import { Module } from "@nestjs/common";');
    expect(file.content).toContain('import { TypeOrmModule } from "@nestjs/typeorm";');
    expect(file.content).toContain('import { UsersService } from "./users.service";');
    expect(file.content).toContain('import { UserRepository } from "./user.repository";');
    expect(file.content).toContain('import { User } from "./entities/user.entity";');
    // Paketler önce, göreli sonra (import sıralaması).
    const pkgIdx = file.content.indexOf("@nestjs/common");
    const relIdx = file.content.indexOf("./users.service");
    expect(pkgIdx).toBeGreaterThanOrEqual(0);
    expect(pkgIdx).toBeLessThan(relIdx);
  });

  it("içerik tek satır sonu ile biter, surgical marker yok", () => {
    const fx = usersFixture();
    const ctx = ctxFor(fx.nodes, fx.edges);
    const [file] = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx);
    expect(file.content.endsWith("{}\n")).toBe(true);
    expect(file.content.endsWith("{}\n\n")).toBe(false);
    expect(file.surgicalMarkers).toBe(0);
  });

  it("DETERMİNİZM: aynı feature iki kez -> byte-identical", () => {
    const fx = usersFixture();
    const ctx = ctxFor(fx.nodes, fx.edges);
    const a = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx)[0].content;
    const b = emitFeatureModule(featureBySlug(ctx.graph, "users"), ctx)[0].content;
    expect(a).toBe(b);
  });

  /* ── CROSS-FEATURE: bir feature başka feature'ın service'ini çağırırsa ──── */
  it("cross-feature bağımlılık: dependsOn modülü import + kaynak feature service'i export eder", () => {
    // image feature ImageService -CALLS-> AuthService (auth feature). Beklenen:
    //   - auth modülü AuthService'i EXPORT eder (başka feature kullanıyor).
    //   - image modülü AuthModule'ü IMPORT eder (dependsOn=[auth]).
    const authCtrl = node("Controller", {
      ControllerName: "AuthController",
      Description: "Kimlik uçları",
      BaseRoute: "auth",
      Endpoints: [],
    });
    const authSvc = node("Service", {
      ServiceName: "AuthService",
      Description: "Kimlik mantığı",
      Dependencies: [],
      Methods: [],
    });
    const imageCtrl = node("Controller", {
      ControllerName: "ImageController",
      Description: "Görsel uçları",
      BaseRoute: "image",
      Endpoints: [],
    });
    const imageSvc = node("Service", {
      ServiceName: "ImageService",
      Description: "Görsel mantığı",
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

  /* ── KARŞILIKLI (circular) import: geri-kenar forwardRef ile emit edilir ── */
  it("karşılıklı cross-feature: geri-kenar forwardRef(() => X) ile emit edilir (boot circular yok)", () => {
    // auth <-> image karşılıklı CALLS. ir.ts geri-kenarı ((to,from) en küçük =
    // image -> auth) forwardRef ile işaretler -> image modülü AuthModule'ü
    // forwardRef(() => AuthModule) ile import EDER (kenar KORUNUR); auth düz import EDER.
    const authCtrl = node("Controller", { ControllerName: "AuthController", Description: "x", BaseRoute: "auth", Endpoints: [] });
    const authSvc = node("Service", { ServiceName: "AuthService", Description: "x", Dependencies: [], Methods: [] });
    const imageCtrl = node("Controller", { ControllerName: "ImageController", Description: "x", BaseRoute: "image", Endpoints: [] });
    const imageSvc = node("Service", { ServiceName: "ImageService", Description: "x", Dependencies: [], Methods: [] });
    const edges = [
      edge("CALLS", authCtrl.id, authSvc.id),
      edge("CALLS", imageCtrl.id, imageSvc.id),
      edge("CALLS", imageSvc.id, authSvc.id), // image -> auth
      edge("CALLS", authSvc.id, imageSvc.id), // auth -> image (karşılıklı)
    ];
    const ctx = ctxFor([authCtrl, authSvc, imageCtrl, imageSvc], edges);

    const authFile = emitFeatureModule(featureBySlug(ctx.graph, "auth"), ctx)[0];
    const imageFile = emitFeatureModule(featureBySlug(ctx.graph, "image"), ctx)[0];

    // Eager yön (auth -> image) düz import KORUNUR (forwardRef YOK bu yönde).
    expect(authFile.content).toContain("imports: [ImageModule],");
    expect(authFile.content).toContain('import { ImageModule } from "../image/image.module";');
    expect(authFile.content).not.toContain("forwardRef");
    // Geri-kenar (image -> auth) forwardRef ile emit edilir; KENAR KORUNUR (provider import'u kaybolmaz).
    expect(imageFile.content).toContain("imports: [forwardRef(() => AuthModule)],");
    expect(imageFile.content).toContain('import { Module, forwardRef } from "@nestjs/common";');
    expect(imageFile.content).toContain('import { AuthModule } from "../auth/auth.module";');
    // DI yine sağlam: iki servis de export edilir.
    expect(authFile.content).toContain("exports: [AuthService],");
    expect(imageFile.content).toContain("exports: [ImageService],");
  });

  /* ── Açık Module node feature'ı tohumlarsa Description KORUNUR ──────────── */
  it("açık Module node varsa: feature slug'ı tohumlar + Description korunur", () => {
    const mod = node("Module", {
      ModuleName: "AuthModule",
      Description: "Kimlik doğrulama modülü",
      StrictBoundaries: true,
      ExposedServices: ["AuthService"],
      Dependencies: [],
    });
    const ctrl = node("Controller", {
      ControllerName: "AuthController",
      Description: "Kimlik uçları",
      BaseRoute: "auth",
      Endpoints: [],
    });
    const svc = node("Service", {
      ServiceName: "AuthService",
      Description: "Kimlik mantığı",
      Dependencies: [],
      Methods: [],
    });
    const edges = [edge("CALLS", ctrl.id, svc.id), edge("USES", mod.id, svc.id)];
    const ctx = ctxFor([mod, ctrl, svc], edges);
    const feature = featureBySlug(ctx.graph, "auth");
    expect(feature.module?.id).toBe(mod.id);
    const [file] = emitFeatureModule(feature, ctx);
    // Module.Description -> dosya başı yorumu (sentez varsayılan metni DEĞİL).
    expect(file.content).toContain("/** Kimlik doğrulama modülü */");
    expect(file.content).toContain("export class AuthModule {}");
    expect(file.path).toBe("auth/auth.module.ts");
  });

  /* ── CROSS-FEATURE Service->Repository: owner modül Repository'yi EXPORT eder ── */
  it("cross-feature Service->Repository: owner modül Repository'yi EXPORT eder, tüketici dependsOn", () => {
    // image feature ImageGenerationService -CALLS-> UserRepository (auth feature).
    // Beklenen: AuthModule UserRepository'yi EXPORT eder (NestJS'te export edilmeyen
    // provider modül-dışı görünmez -> bootta DI hatası); ImageModule AuthModule import.
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

    // UserRepository hangi feature'a düştü? (firstSourceFeature isimce ilk = auth.)
    const authFeature = ctx.graph.features().find((f) => f.repositories.some((r) => r.name === "UserRepository"));
    expect(authFeature?.slug).toBe("auth");

    const authFile = emitFeatureModule(featureBySlug(ctx.graph, "auth"), ctx)[0];
    // Repository EXPORT edilir (Service değil sadece -> Repository de aday).
    expect(authFile.content).toContain("exports: [UserRepository],");

    const imageFile = emitFeatureModule(featureBySlug(ctx.graph, "image"), ctx)[0];
    expect(imageFile.content).toContain("imports: [AuthModule],");
  });

  /* ── Enjekte edilen Cache/ExternalService TAM provider'ları module'da ───── */
  it("CACHES_IN/REQUESTS edge'li Service -> Cache/ExternalService TAM provider + module import'ları", () => {
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
    // Cache/ExternalService artık TAM emitter -> gerçek sınıf adı (Stub eki YOK).
    expect(file.content).toContain("providers: [ImageService, ImageCache, SdApi],");
    expect(file.content).not.toContain("Stub");
    expect(file.content).toContain('import { ImageCache } from "./image.cache";');
    expect(file.content).toContain('import { SdApi } from "./sd.client";');
    // Module-seviyesi altyapı import'ları: CacheModule + HttpModule + ConfigModule.
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
    // Model YOK ama sentetik GeneratedImage entity forFeature'a girer -> DI tam.
    expect(file.content).toContain("TypeOrmModule.forFeature([GeneratedImage])");
    expect(file.content).toContain('import { GeneratedImage } from "./entities/generated-image.entity";');
    expect(file.content).toContain("providers: [ImageService, ImageRepository],");
  });

  /* ── #7 cross-feature infra provider TEK module'de provider (singleton) ──── */
  it("çift-inject: PaymentGateway YALNIZ payment module'ünde provider; order import eder", () => {
    // payment + order İKİSİ de PaymentGateway (ExternalService) enjekte eder.
    // Eski hata: gateway iki module'ün de providers'ında -> iki örnek (singleton kırık).
    // Beklenen: yalnız PaymentModule provider+export eder; OrderModule PaymentModule import.
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

    // Sahip (payment): PaymentGateway providers + exports + import edilen sınıf.
    expect(paymentFile.content).toContain("providers: [PaymentService, PaymentGateway],");
    expect(paymentFile.content).toContain("exports: [PaymentService, PaymentGateway],");
    expect(paymentFile.content).toContain('import { PaymentGateway } from "./payment-gateway.client";');

    // Sahip-DIŞI (order): PaymentGateway'i providers'a YAZMAZ, sınıfı import ETMEZ.
    expect(orderFile.content).not.toContain("PaymentGateway");
    expect(orderFile.content).toContain("providers: [OrderService],");
    // PaymentModule'ü import eder (gateway + PaymentService oradan gelir).
    expect(orderFile.content).toContain("imports: [PaymentModule],");
    expect(orderFile.content).toContain('import { PaymentModule } from "../payment/payment.module";');

    // forwardRef ASLA üretilmez; döngü yok.
    expect(paymentFile.content).not.toContain("forwardRef");
    expect(orderFile.content).not.toContain("forwardRef");
  });

  it("entity yoksa imports alanı atlanır (boş @Module alanları yazılmaz)", () => {
    // Controller + Service var ama Model/Table YOK -> TypeOrmModule.forFeature yok,
    // cross-feature bağımlılık yok -> imports alanı tamamen atlanır.
    const ctrl = node("Controller", {
      ControllerName: "PingController",
      Description: "Sağlık",
      BaseRoute: "ping",
      Endpoints: [],
    });
    const svc = node("Service", {
      ServiceName: "PingService",
      Description: "Sağlık mantığı",
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
