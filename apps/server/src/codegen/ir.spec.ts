import { describe, it, expect } from "vitest";
import { buildCodeGraph, propsOf } from "./ir";
import type { StoredNode } from "../nodes/nodes.repository";
import type { StoredEdge } from "../edges/edges.repository";
import type { NodeKind } from "../nodes/schemas";
import type { EdgeKind } from "../edges/schemas/edge.schema";

let idSeq = 0;
function uuid(): string {
  idSeq++;
  return `00000000-0000-4000-8000-${String(idSeq).padStart(12, "0")}`;
}

function node(type: NodeKind, properties: Record<string, unknown>): StoredNode {
  return {
    id: uuid(),
    type,
    projectId: "11111111-1111-4111-8111-111111111111",
    positionX: 0,
    positionY: 0,
    homeTabId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function edge(kind: EdgeKind, source: StoredNode, target: StoredNode): StoredEdge {
  return {
    id: uuid(),
    projectId: "11111111-1111-4111-8111-111111111111",
    sourceNodeId: source.id,
    targetNodeId: target.id,
    kind,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: false },
  };
}

describe("buildCodeGraph — indeksler", () => {
  it("byId / byName / allOf / resolveRef cozer", () => {
    const svc = node("Service", { ServiceName: "UsersService", Description: "x", IsTransactionScoped: false, Methods: [{ MethodName: "m", ReturnType: "void" }], Dependencies: [] });
    const repo = node("Repository", { RepositoryName: "UsersRepository", Description: "x", EntityReference: "User", CustomQueries: [] });
    const g = buildCodeGraph([svc, repo], []);

    expect(g.byId(svc.id)?.name).toBe("UsersService");
    expect(g.byName("Service", "UsersService")?.id).toBe(svc.id);
    expect(g.allOf("Service")).toHaveLength(1);
    expect(g.resolveRef("Repository", "UsersRepository")?.id).toBe(repo.id);
    expect(g.resolveRef(["Service", "Repository"], "UsersRepository")?.id).toBe(repo.id);
  });

  it("kayip ref -> null (THROW ETMEZ)", () => {
    const g = buildCodeGraph([], []);
    expect(g.byId("nope")).toBeNull();
    expect(g.byName("Service", "Ghost")).toBeNull();
    expect(g.resolveRef("DTO", "Ghost")).toBeNull();
    expect(g.outEdges("nope")).toEqual([]);
    expect(g.inEdges("nope")).toEqual([]);
    expect(g.allOf("Table")).toEqual([]);
  });

  it("outEdges / inEdges kind filtresi", () => {
    const ctrl = node("Controller", { ControllerName: "UsersController", Description: "x", BaseRoute: "/users", Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false }] });
    const svc = node("Service", { ServiceName: "UsersService", Description: "x", IsTransactionScoped: false, Methods: [{ MethodName: "m", ReturnType: "void" }], Dependencies: [] });
    const calls = edge("CALLS", ctrl, svc);
    const g = buildCodeGraph([ctrl, svc], [calls]);

    expect(g.outEdges(ctrl.id, "CALLS")).toHaveLength(1);
    expect(g.outEdges(ctrl.id, "USES")).toHaveLength(0);
    expect(g.inEdges(svc.id, "CALLS")[0].id).toBe(calls.id);
  });

  it("propsOf tipli erisim", () => {
    const t = node("Table", { TableName: "users", Description: "x", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const g = buildCodeGraph([t], []);
    const props = propsOf<"Table">(g.byId(t.id)!);
    expect(props.TableName).toBe("users");
    expect(props.Columns[0].Name).toBe("id");
  });
});

describe("moduleOf heuristigi", () => {
  it("Service -> ExposedServices iceren Module", () => {
    const mod = node("Module", { ModuleName: "UsersModule", Description: "x", StrictBoundaries: false, ExposedServices: ["UsersService"], Dependencies: [] });
    const svc = node("Service", { ServiceName: "UsersService", Description: "x", IsTransactionScoped: false, Methods: [{ MethodName: "m", ReturnType: "void" }], Dependencies: [] });
    const g = buildCodeGraph([mod, svc], []);
    expect(g.moduleOf(g.byId(svc.id)!)?.id).toBe(mod.id);
  });

  it("Controller -> CALLS ettigi Service'in modulu", () => {
    const mod = node("Module", { ModuleName: "UsersModule", Description: "x", StrictBoundaries: false, ExposedServices: ["UsersService"], Dependencies: [] });
    const svc = node("Service", { ServiceName: "UsersService", Description: "x", IsTransactionScoped: false, Methods: [{ MethodName: "m", ReturnType: "void" }], Dependencies: [] });
    const ctrl = node("Controller", { ControllerName: "UsersController", Description: "x", BaseRoute: "/users", Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false }] });
    const g = buildCodeGraph([mod, svc, ctrl], [edge("CALLS", ctrl, svc)]);
    expect(g.moduleOf(g.byId(ctrl.id)!)?.id).toBe(mod.id);
  });

  it("Module bulunamazsa null", () => {
    const svc = node("Service", { ServiceName: "OrphanService", Description: "x", IsTransactionScoped: false, Methods: [{ MethodName: "m", ReturnType: "void" }], Dependencies: [] });
    const g = buildCodeGraph([svc], []);
    expect(g.moduleOf(g.byId(svc.id)!)).toBeNull();
  });

  it("Repository -> acik Service bagi yokken EntityReference'in Model'inin modulune duser", () => {
    // Repo'yu Dependencies/CALLS ile baglayan Service NONE; yalniz EntityReference.
    const mod = node("Module", { ModuleName: "UsersModule", Description: "x", StrictBoundaries: false, ExposedServices: ["UsersService"], Dependencies: [] });
    const svc = node("Service", { ServiceName: "UsersService", Description: "x", IsTransactionScoped: false, Methods: [{ MethodName: "m", ReturnType: "void" }], Dependencies: [] });
    const model = node("Model", { ClassName: "User", Description: "x", TableRef: "users", Properties: [{ Name: "id", Type: "uuid" }], Methods: [] });
    const repo = node("Repository", { RepositoryName: "UserRepository", Description: "x", EntityReference: "User", CustomQueries: [] });
    // Model'i module baglamak icin Service uzerinden degil; domain-sharing fallback (c)
    // ile UsersService'in modulune (UsersModule) dusmeli ("user" stem == "users" stem).
    const g = buildCodeGraph([mod, svc, model, repo], []);
    expect(g.moduleOf(g.byId(repo.id)!)?.id).toBe(mod.id);
  });

  it("Repository -> hic bag yokken domain-paylasan Service'in modulune duser", () => {
    const mod = node("Module", { ModuleName: "OrdersModule", Description: "x", StrictBoundaries: false, ExposedServices: ["OrdersService"], Dependencies: [] });
    const svc = node("Service", { ServiceName: "OrdersService", Description: "x", IsTransactionScoped: false, Methods: [{ MethodName: "m", ReturnType: "void" }], Dependencies: [] });
    // EntityReference cozulmez (Model yok) -> yalniz domain stem fallback kalir.
    const repo = node("Repository", { RepositoryName: "OrderRepository", Description: "x", EntityReference: "Order", CustomQueries: [] });
    const g = buildCodeGraph([mod, svc, repo], []);
    expect(g.moduleOf(g.byId(repo.id)!)?.id).toBe(mod.id);
  });
});

describe("karsilikli feature import'u (circular module) DETERMINISTIC kirilir", () => {
  /** auth <-> image karsilikli CALLS: iki feature birbirini import etmek ister.
   *  Beklenen: kucuk slug (auth) image'i import etmeye DEVAM eder; buyuk slug
   *  (image) auth'a dogru geri-kenarini DUSURUR -> boot'ta dongu yok. */
  function mutualFixture() {
    const authCtrl = node("Controller", { ControllerName: "AuthController", Description: "x", BaseRoute: "auth", Endpoints: [] });
    const authSvc = node("Service", { ServiceName: "AuthService", Description: "x", Dependencies: [], Methods: [] });
    const imageCtrl = node("Controller", { ControllerName: "ImageController", Description: "x", BaseRoute: "image", Endpoints: [] });
    const imageSvc = node("Service", { ServiceName: "ImageService", Description: "x", Dependencies: [], Methods: [] });
    const edges = [
      edge("CALLS", authCtrl, authSvc),
      edge("CALLS", imageCtrl, imageSvc),
      edge("CALLS", imageSvc, authSvc), // image -> auth
      edge("CALLS", authSvc, imageSvc), // auth -> image (karsilikli)
    ];
    return buildCodeGraph([authCtrl, authSvc, imageCtrl, imageSvc], edges);
  }

  it("geri-kenar forwardRef ile isaretlenir: kenar KORUNUR, lazy emit edilir", () => {
    const g = mutualFixture();
    const auth = g.features().find((f) => f.slug === "auth")!;
    const image = g.features().find((f) => f.slug === "image")!;
    // Iki yon de dependsOn'da KALIR (kenar SILINMEZ → provider import'u kaybolmaz);
    //   (to, from) en kucuk geri-kenar = image->auth → image.forwardRefDeps=["auth"].
    expect(auth.dependsOn).toContain("image");
    expect(image.dependsOn).toContain("auth");
    expect(image.forwardRefDeps).toContain("auth");
    expect(auth.forwardRefDeps).not.toContain("image");
  });

  it("export'lar KORUNUR (DI bozulmaz): iki yon de export eder", () => {
    const g = mutualFixture();
    const auth = g.features().find((f) => f.slug === "auth")!;
    const image = g.features().find((f) => f.slug === "image")!;
    // Iki servis de cross-feature inject hedefi -> export edilir (import kirilsa da).
    expect(auth.exports.map((e) => e.name)).toContain("AuthService");
    expect(image.exports.map((e) => e.name)).toContain("ImageService");
  });

  it("uyari uretilir (forwardRef ile kirildi)", () => {
    const g = mutualFixture();
    expect(g.warnings()).toHaveLength(1);
    const w = g.warnings()[0];
    expect(w).toContain("ImageModule");
    expect(w).toContain("AuthModule");
    expect(w).toContain("forwardRef");
  });

  it("dongu yoksa uyari yok + dependsOn degismez", () => {
    // image -> auth tek yonlu (karsilik yok).
    const authCtrl = node("Controller", { ControllerName: "AuthController", Description: "x", BaseRoute: "auth", Endpoints: [] });
    const authSvc = node("Service", { ServiceName: "AuthService", Description: "x", Dependencies: [], Methods: [] });
    const imageCtrl = node("Controller", { ControllerName: "ImageController", Description: "x", BaseRoute: "image", Endpoints: [] });
    const imageSvc = node("Service", { ServiceName: "ImageService", Description: "x", Dependencies: [], Methods: [] });
    const g = buildCodeGraph(
      [authCtrl, authSvc, imageCtrl, imageSvc],
      [edge("CALLS", authCtrl, authSvc), edge("CALLS", imageCtrl, imageSvc), edge("CALLS", imageSvc, authSvc)],
    );
    expect(g.warnings()).toHaveLength(0);
    const image = g.features().find((f) => f.slug === "image")!;
    expect(image.dependsOn).toEqual(["auth"]);
  });

  it("DETERMINISM: warnings + dependsOn iki kez ayni (cache)", () => {
    const g = mutualFixture();
    expect(g.warnings()).toEqual(g.warnings());
    expect(g.features().find((f) => f.slug === "image")!.dependsOn).toEqual(
      g.features().find((f) => f.slug === "image")!.dependsOn,
    );
  });
});

describe("N-CYCLE (3'lu+) module import'u DETERMINISTIC kirilir (Bug 1 regresyon)", () => {
  /** auth -> chat -> messaging -> auth UCLU dongu (cross-feature CALLS). Eski
   *  breakCircularImports yalniz IKILI ciftleri tariyordu → hicbir cift mutual
   *  olmadigi icin dongu KACIYORDU ve NestJS boot'ta UndefinedModuleException
   *  veriyordu. Tarjan SCC ucluyu yakalar; bir geri-kenar forwardRef olur. */
  function threeCycleFixture() {
    const authCtrl = node("Controller", { ControllerName: "AuthController", Description: "x", BaseRoute: "auth", Endpoints: [] });
    const authSvc = node("Service", { ServiceName: "AuthService", Description: "x", Dependencies: [], Methods: [] });
    const chatCtrl = node("Controller", { ControllerName: "ChatController", Description: "x", BaseRoute: "chat", Endpoints: [] });
    const chatSvc = node("Service", { ServiceName: "ChatService", Description: "x", Dependencies: [], Methods: [] });
    const msgCtrl = node("Controller", { ControllerName: "MessagingController", Description: "x", BaseRoute: "messaging", Endpoints: [] });
    const msgSvc = node("Service", { ServiceName: "MessagingService", Description: "x", Dependencies: [], Methods: [] });
    const edges = [
      edge("CALLS", authCtrl, authSvc),
      edge("CALLS", chatCtrl, chatSvc),
      edge("CALLS", msgCtrl, msgSvc),
      edge("CALLS", authSvc, chatSvc), // auth -> chat
      edge("CALLS", chatSvc, msgSvc), // chat -> messaging
      edge("CALLS", msgSvc, authSvc), // messaging -> auth (donguyu kapatir)
    ];
    return buildCodeGraph([authCtrl, authSvc, chatCtrl, chatSvc, msgCtrl, msgSvc], edges);
  }

  it("uclu dongu YAKALANIR: tam bir geri-kenar forwardRef olur (eskiden 0 uyari)", () => {
    const g = threeCycleFixture();
    // (to, from) en kucuk geri-kenar = messaging->auth (to="auth") → forwardRef.
    const auth = g.features().find((f) => f.slug === "auth")!;
    const chat = g.features().find((f) => f.slug === "chat")!;
    const messaging = g.features().find((f) => f.slug === "messaging")!;
    expect(messaging.forwardRefDeps).toEqual(["auth"]);
    expect(auth.forwardRefDeps).toEqual([]);
    expect(chat.forwardRefDeps).toEqual([]);
  });

  it("kenarlar KORUNUR (provider import'u kaybolmaz): dependsOn degismez", () => {
    const g = threeCycleFixture();
    expect(g.features().find((f) => f.slug === "auth")!.dependsOn).toEqual(["chat"]);
    expect(g.features().find((f) => f.slug === "chat")!.dependsOn).toEqual(["messaging"]);
    expect(g.features().find((f) => f.slug === "messaging")!.dependsOn).toEqual(["auth"]);
  });

  it("tek uyari uretilir (forwardRef ile kirildi)", () => {
    const g = threeCycleFixture();
    expect(g.warnings()).toHaveLength(1);
    const w = g.warnings()[0];
    expect(w).toContain("MessagingModule");
    expect(w).toContain("AuthModule");
    expect(w).toContain("forwardRef");
  });

  it("kirilan grafik DAG'dir: kalan eager kenarlar arasinda dongu kalmaz", () => {
    const g = threeCycleFixture();
    // forwardRef kenari cikarinca: auth->chat, chat->messaging = DAG (messaging->auth lazy).
    const features = g.features();
    const eager = new Map(features.map((f) => [f.slug, f.dependsOn.filter((d) => !f.forwardRefDeps.includes(d))]));
    expect(eager.get("messaging")).toEqual([]); // tek eager-disi kenar buradaydi
    expect(eager.get("auth")).toEqual(["chat"]);
    expect(eager.get("chat")).toEqual(["messaging"]);
  });
});

describe("#4 cross-feature Repository DI (domain co-location)", () => {
  /** order feature'i (OrderController->OrderService) ile payment feature'i
   *  (PaymentService->PaymentRepository). OrderService CROSS-FEATURE olarak
   *  PaymentRepository'yi de CALLS eder. Beklenen: PaymentRepository PAYMENT
   *  feature'inda durur (domain-stem "payment" PaymentService ile co-locate),
   *  order'a KAYMAZ. Boylece PaymentModule onu provider/export eder ve
   *  PaymentService bootta cozebilir; OrderModule da PaymentModule'u import eder. */
  function crossFeatureFixture() {
    const orderCtrl = node("Controller", { ControllerName: "OrderController", Description: "x", BaseRoute: "orders", Endpoints: [] });
    const orderSvc = node("Service", { ServiceName: "OrderService", Description: "x", Dependencies: [], Methods: [] });
    const orderRepo = node("Repository", { RepositoryName: "OrderRepository", Description: "x", EntityReference: "orders", CustomQueries: [] });
    const paymentSvc = node("Service", { ServiceName: "PaymentService", Description: "x", Dependencies: [], Methods: [] });
    const paymentRepo = node("Repository", { RepositoryName: "PaymentRepository", Description: "x", EntityReference: "payments", CustomQueries: [] });
    const edges = [
      edge("CALLS", orderCtrl, orderSvc),
      edge("CALLS", orderSvc, orderRepo),
      edge("CALLS", paymentSvc, paymentRepo),
      // CROSS-FEATURE: OrderService -> PaymentRepository (+ PaymentService).
      edge("CALLS", orderSvc, paymentRepo),
      edge("CALLS", orderSvc, paymentSvc),
    ];
    const g = buildCodeGraph([orderCtrl, orderSvc, orderRepo, paymentSvc, paymentRepo], edges);
    return { g, paymentRepo, orderSvc };
  }

  it("PaymentRepository PAYMENT feature'inda durur (order'a kaymaz)", () => {
    const { g, paymentRepo } = crossFeatureFixture();
    // Domain co-location: PaymentRepository, PaymentService ile ayni feature.
    expect(g.featureOf(g.byId(paymentRepo.id)!)).toBe("payment");
  });

  it("PaymentModule PaymentRepository'yi provider + export eder (cross-feature inject hedefi)", () => {
    const { g, paymentRepo } = crossFeatureFixture();
    const payment = g.features().find((f) => f.slug === "payment")!;
    // Provider: kendi feature'ina ait repository.
    expect(payment.repositories.map((r) => r.name)).toContain("PaymentRepository");
    // Export: OrderService (order) onu cross-feature CALLS eder -> export ZORUNLU.
    expect(payment.exports.map((e) => e.name)).toContain("PaymentRepository");
    void paymentRepo;
  });

  it("OrderModule payment feature'ini import eder (dependsOn payment)", () => {
    const { g } = crossFeatureFixture();
    const order = g.features().find((f) => f.slug === "order")!;
    expect(order.dependsOn).toContain("payment");
    // OrderModule PaymentRepository'yi KENDI provider'i olarak tasimaz (payment'in).
    expect(order.repositories.map((r) => r.name)).not.toContain("PaymentRepository");
  });

  it("DETERMINISM: feature atamasi iki kez ayni", () => {
    const { g, paymentRepo } = crossFeatureFixture();
    expect(g.featureOf(g.byId(paymentRepo.id)!)).toBe(g.featureOf(g.byId(paymentRepo.id)!));
  });
});

describe("cross-feature Repository PROPERTY-dep (EDGE NONE) wiring (Bug 2 regresyon)", () => {
  /** token feature'i (TokenController->TokenService) UserRepository'yi YALNIZ
   *  Service.Dependencies property'si ile enjekte eder — graf'ta CALLS EDGE NONE.
   *  Eski derivasyon property-dep'te Service/Repository'yi ATLIYORDU (yalniz edge
   *  taraniyordu) → TokenModule, UserModule'u import etmiyor + UserModule export
   *  etmiyordu → boot'ta "Nest can't resolve UserRepository" (UnknownDependencies).
   *  Beklenen: token.dependsOn ⊇ user (import) VE user.exports ⊇ UserRepository. */
  function propDepFixture() {
    const userCtrl = node("Controller", { ControllerName: "UserController", Description: "x", BaseRoute: "users", Endpoints: [] });
    const userSvc = node("Service", { ServiceName: "UserService", Description: "x", Dependencies: [], Methods: [] });
    const userRepo = node("Repository", { RepositoryName: "UserRepository", Description: "x", EntityReference: "users", CustomQueries: [] });
    const tokenCtrl = node("Controller", { ControllerName: "TokenController", Description: "x", BaseRoute: "tokens", Endpoints: [] });
    // TokenService UserRepository'yi PROPERTY ile enjekte eder — CALLS edge NONE.
    const tokenSvc = node("Service", { ServiceName: "TokenService", Description: "x", Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }], Methods: [] });
    const edges = [
      edge("CALLS", userCtrl, userSvc),
      edge("CALLS", userSvc, userRepo),
      edge("CALLS", tokenCtrl, tokenSvc),
      // DIKKAT: tokenSvc -> userRepo CALLS edge'i BILEREK NONE (yalniz property-dep).
    ];
    return buildCodeGraph([userCtrl, userSvc, userRepo, tokenCtrl, tokenSvc], edges);
  }

  it("UserRepository USER feature'inda durur", () => {
    const g = propDepFixture();
    const userRepo = g.byName("Repository", "UserRepository")!;
    expect(g.featureOf(userRepo)).toBe("user");
  });

  it("TokenModule UserModule'u import eder (dependsOn ⊇ user) — property-dep'ten", () => {
    const g = propDepFixture();
    const token = g.features().find((f) => f.slug === "token")!;
    expect(token.dependsOn).toContain("user");
    // TokenModule UserRepository'yi KENDI provider'i olarak TASIMAZ (user'in).
    expect(token.repositories.map((r) => r.name)).not.toContain("UserRepository");
  });

  it("UserModule UserRepository'yi EXPORT eder (cross-feature property-inject hedefi)", () => {
    const g = propDepFixture();
    const user = g.features().find((f) => f.slug === "user")!;
    expect(user.repositories.map((r) => r.name)).toContain("UserRepository");
    expect(user.exports.map((e) => e.name)).toContain("UserRepository");
  });
});

describe("#7 cross-feature infra provider TEK SAHIP (singleton korunur)", () => {
  /** payment (PaymentService) + order (OrderService) IKISI de PaymentGateway
   *  (ExternalService) enjekte eder; order ayrica payment'i CALLS eder. Eski
   *  davranis: PaymentGateway hem payment hem order'in infraProviders'ina girer ->
   *  iki module'de provider -> iki ornek (singleton kirik). Beklenen: PaymentGateway
   *  TEK feature'da (payment) provider+export; order onu KENDI provider'i olarak
   *  TASIMAZ, PaymentModule'u import eder (dependsOn=payment); "common"a dusmez. */
  function doubleInjectFixture() {
    const payCtrl = node("Controller", { ControllerName: "PaymentController", Description: "x", BaseRoute: "payment", Endpoints: [] });
    const paySvc = node("Service", { ServiceName: "PaymentService", Description: "x", Dependencies: [{ Kind: "ExternalService", Ref: "PaymentGateway" }], Methods: [] });
    const orderCtrl = node("Controller", { ControllerName: "OrderController", Description: "x", BaseRoute: "order", Endpoints: [] });
    const orderSvc = node("Service", { ServiceName: "OrderService", Description: "x", Dependencies: [{ Kind: "ExternalService", Ref: "PaymentGateway" }], Methods: [] });
    const gw = node("ExternalService", { ServiceName: "PaymentGateway", Description: "x", BaseURL: "https://pg.example.com", AuthType: "None", TimeoutSeconds: 10, Endpoints: [] });
    const edges = [
      edge("CALLS", payCtrl, paySvc),
      edge("CALLS", orderCtrl, orderSvc),
      edge("REQUESTS", paySvc, gw),
      edge("REQUESTS", orderSvc, gw),
      edge("CALLS", orderSvc, paySvc), // order -> payment (service-call)
    ];
    const g = buildCodeGraph([payCtrl, paySvc, orderCtrl, orderSvc, gw], edges);
    return { g, gw };
  }

  it("PaymentGateway YALNIZ payment feature'inin provider'i (order'da NONE)", () => {
    const { g } = doubleInjectFixture();
    const payment = g.features().find((f) => f.slug === "payment")!;
    const order = g.features().find((f) => f.slug === "order")!;
    expect(payment.infraProviders.map((n) => n.name)).toContain("PaymentGateway");
    expect(order.infraProviders.map((n) => n.name)).not.toContain("PaymentGateway");
  });

  it("sahip feature (payment) PaymentGateway'i EXPORT eder; order import eder (dependsOn)", () => {
    const { g } = doubleInjectFixture();
    const payment = g.features().find((f) => f.slug === "payment")!;
    const order = g.features().find((f) => f.slug === "order")!;
    expect(payment.exports.map((e) => e.name)).toContain("PaymentGateway");
    expect(order.exports.map((e) => e.name)).not.toContain("PaymentGateway");
    expect(order.dependsOn).toContain("payment");
  });

  it("sahip secimi DONGUSUZ: payment secilir (order zaten payment'a bagimli) + uyari yok", () => {
    const { g, gw } = doubleInjectFixture();
    // order->payment service-call'u zaten var -> in-degree(payment)=1 > order=0 -> payment sahip.
    expect(g.featureOf(g.byId(gw.id)!)).toBe("payment");
    // Sahip secimi yeni geri-kenar (payment->order) yaratmadi -> dongu kirma uyarisi yok.
    expect(g.warnings()).toHaveLength(0);
  });

  it("PaymentGateway 'common'a DUSMEZ (CommonModule onu tekrar yazmaz)", () => {
    const { g } = doubleInjectFixture();
    const common = g.commonFeature();
    const commonInfra = common?.infraProviders.map((n) => n.name) ?? [];
    expect(commonInfra).not.toContain("PaymentGateway");
  });

  it("DETERMINISM: sahip atamasi iki kez ayni", () => {
    const { g, gw } = doubleInjectFixture();
    expect(g.featureOf(g.byId(gw.id)!)).toBe(g.featureOf(g.byId(gw.id)!));
  });

  it("simetrik enjekte (injectorlar arasi service-call NONE): isimce ilk slug sahip, dongu yok", () => {
    // billing + report IKISI de RateCache enjekte eder, aralarinda cagri NONE.
    const billCtrl = node("Controller", { ControllerName: "BillingController", Description: "x", BaseRoute: "billing", Endpoints: [] });
    const billSvc = node("Service", { ServiceName: "BillingService", Description: "x", Dependencies: [{ Kind: "Cache", Ref: "RateCache" }], Methods: [] });
    const repCtrl = node("Controller", { ControllerName: "ReportController", Description: "x", BaseRoute: "report", Endpoints: [] });
    const repSvc = node("Service", { ServiceName: "ReportService", Description: "x", Dependencies: [{ Kind: "Cache", Ref: "RateCache" }], Methods: [] });
    const cache = node("Cache", { CacheName: "RateCache", Description: "x", KeyPattern: "r:{id}", TTL_Seconds: 60, Engine: "Redis" });
    const g = buildCodeGraph(
      [billCtrl, billSvc, repCtrl, repSvc, cache],
      [edge("CALLS", billCtrl, billSvc), edge("CALLS", repCtrl, repSvc), edge("CACHES_IN", billSvc, cache), edge("CACHES_IN", repSvc, cache)],
    );
    // Esit in-degree (0/0) -> isimce ilk = billing sahip.
    expect(g.featureOf(g.byId(cache.id)!)).toBe("billing");
    const billing = g.features().find((f) => f.slug === "billing")!;
    const report = g.features().find((f) => f.slug === "report")!;
    expect(billing.infraProviders.map((n) => n.name)).toContain("RateCache");
    expect(report.infraProviders.map((n) => n.name)).not.toContain("RateCache");
    expect(report.dependsOn).toContain("billing");
    expect(g.warnings()).toHaveLength(0);
  });

  it("tek feature enjekte ediyorsa SAHIPLIK KURALI DEVREYE GIRMEZ (eski davranis)", () => {
    // Yalniz payment PaymentGateway enjekte eder -> dogrudan payment'in infraProviders'i.
    const payCtrl = node("Controller", { ControllerName: "PaymentController", Description: "x", BaseRoute: "payment", Endpoints: [] });
    const paySvc = node("Service", { ServiceName: "PaymentService", Description: "x", Dependencies: [{ Kind: "ExternalService", Ref: "PaymentGateway" }], Methods: [] });
    const gw = node("ExternalService", { ServiceName: "PaymentGateway", Description: "x", BaseURL: "https://pg.example.com", AuthType: "None", TimeoutSeconds: 10, Endpoints: [] });
    const g = buildCodeGraph([payCtrl, paySvc, gw], [edge("CALLS", payCtrl, paySvc), edge("REQUESTS", paySvc, gw)]);
    const payment = g.features().find((f) => f.slug === "payment")!;
    expect(payment.infraProviders.map((n) => n.name)).toContain("PaymentGateway");
    expect(g.featureOf(g.byId(gw.id)!)).toBe("payment");
  });

  /** REGRESYON (b4f3 GERCEGI): order, PaymentGateway'i YALNIZ property-Dependency
   *  ile enjekte eder (REQUESTS EDGE NONE); payment ise edge ile enjekte eder. Eski
   *  computeInfraOwners SADECE inject-edge'lere bakiyordu -> order injector SAYILMAZ,
   *  injectorSlugs.size=1 -> tek-sahip kurali atlanir -> PaymentGateway hem order hem
   *  payment module'une provider olur (singleton kirik). Duzeltme: computeInfraOwners
   *  artik property-Dependency'leri de sayar -> injector=2 -> tek sahip (payment). */
  it("property-Dependency ile enjekte (EDGE NONE) de tek-sahip kuralini tetikler", () => {
    const payCtrl = node("Controller", { ControllerName: "PaymentController", Description: "x", BaseRoute: "payment", Endpoints: [] });
    const paySvc = node("Service", { ServiceName: "PaymentService", Description: "x", Dependencies: [{ Kind: "ExternalService", Ref: "PaymentGateway" }], Methods: [] });
    const orderCtrl = node("Controller", { ControllerName: "OrderController", Description: "x", BaseRoute: "order", Endpoints: [] });
    // order: PaymentGateway SADECE property-dep (REQUESTS edge NONE) + order->payment service-call.
    const orderSvc = node("Service", { ServiceName: "OrderService", Description: "x", Dependencies: [{ Kind: "ExternalService", Ref: "PaymentGateway" }], Methods: [] });
    const gw = node("ExternalService", { ServiceName: "PaymentGateway", Description: "x", BaseURL: "https://pg.example.com", AuthType: "None", TimeoutSeconds: 10, Endpoints: [] });
    const g = buildCodeGraph(
      [payCtrl, paySvc, orderCtrl, orderSvc, gw],
      [
        edge("CALLS", payCtrl, paySvc),
        edge("CALLS", orderCtrl, orderSvc),
        edge("REQUESTS", paySvc, gw), // YALNIZ payment'in edge'i var
        edge("CALLS", orderSvc, paySvc), // order -> payment (service-call)
      ],
    );
    const payment = g.features().find((f) => f.slug === "payment")!;
    const order = g.features().find((f) => f.slug === "order")!;
    // PaymentGateway TEK feature'da (payment) provider+export; order onu TASIMAZ.
    expect(payment.infraProviders.map((n) => n.name)).toContain("PaymentGateway");
    expect(order.infraProviders.map((n) => n.name)).not.toContain("PaymentGateway");
    expect(payment.exports.map((e) => e.name)).toContain("PaymentGateway");
    expect(order.dependsOn).toContain("payment");
    expect(g.featureOf(g.byId(gw.id)!)).toBe("payment");
    expect(g.warnings()).toHaveLength(0);
  });
});

describe("migration sirasi (FK topolojisi + isim)", () => {
  it("referans verilen tablo once gelir", () => {
    const users = node("Table", { TableName: "users", Description: "x", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const orders = node("Table", { TableName: "orders", Description: "x", Columns: [{ Name: "user_id", DataType: "UUID", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [{ Columns: ["user_id"], ReferencesTable: "users", ReferencesColumns: ["id"], OnDelete: "CASCADE", OnUpdate: "NO_ACTION" }], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const g = buildCodeGraph([orders, users], []);
    const usersIdx = g.migrationIndexOf(g.byName("Table", "users")!);
    const ordersIdx = g.migrationIndexOf(g.byName("Table", "orders")!);
    expect(usersIdx).toBeLessThan(ordersIdx);
  });

  it("FK dongusu patlatmaz (kalanlar isim sirasinda)", () => {
    const a = node("Table", { TableName: "a_tbl", Description: "x", Columns: [{ Name: "b_id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [{ Columns: ["b_id"], ReferencesTable: "b_tbl", ReferencesColumns: ["id"], OnDelete: "NO_ACTION", OnUpdate: "NO_ACTION" }], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const b = node("Table", { TableName: "b_tbl", Description: "x", Columns: [{ Name: "a_id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [{ Columns: ["a_id"], ReferencesTable: "a_tbl", ReferencesColumns: ["id"], OnDelete: "NO_ACTION", OnUpdate: "NO_ACTION" }], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const g = buildCodeGraph([a, b], []);
    expect(() => g.migrationIndexOf(g.byName("Table", "a_tbl")!)).not.toThrow();
  });
});

describe("#4 orphan join tablosu entity'si forFeature'a kaydedilir (boot regresyonu)", () => {
  /** Gercek e-ticaret deseni: products tablosunu bir Repository gosterir (sentetik
   *  entity CEKIRDEK), order_items ise hicbir repo gostermez ama products'a FK
   *  verir (orphan join tablosu). entity-synthesis order_items icin @Entity +
   *  @ManyToOne(Product) uretir; Product entity'sinde @OneToMany(OrderItem) dogar.
   *  Eger order_items HICBIR feature'in TypeOrmModule.forFeature'ina girmezse
   *  TypeORM bootta "Entity metadata for Product#orderItems not found" firlatir.
   *  Bu test, IR'in order_items'i bir feature'a (FK co-location -> products'in
   *  feature'i) atadigini ve o feature'in syntheticEntityTables'inda durdugunu
   *  dogrular -> module.emitter onu forFeature'a kaydeder -> uygulama BOOT BOOTS. */
  function joinFixture() {
    const products = node("Table", { TableName: "products", Description: "x", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }], ForeignKeys: [], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const productSvc = node("Service", { ServiceName: "ProductService", Description: "x", Dependencies: [], Methods: [] });
    const productRepo = node("Repository", { RepositoryName: "ProductRepository", Description: "x", EntityReference: "products", CustomQueries: [] });
    const orderItems = node("Table", { TableName: "order_items", Description: "join", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }, { Name: "product_id", DataType: "UUID", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [{ Columns: ["product_id"], ReferencesTable: "products", ReferencesColumns: ["id"], OnDelete: "CASCADE", OnUpdate: "NO_ACTION" }], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const g = buildCodeGraph([products, productSvc, productRepo, orderItems], [edge("CALLS", productSvc, productRepo), edge("WRITES", productRepo, products)]);
    return { g, orderItems, products };
  }

  it("order_items bir feature'a atanir (kendi orphan slug'inda ASILI KALMAZ)", () => {
    const { g, orderItems } = joinFixture();
    const slug = g.featureOf(g.byId(orderItems.id)!);
    // FK co-location: products'in feature'i (product). Orphan "order-items"e DUSMEZ.
    expect(slug).toBe("product");
  });

  it("atandigi feature'in syntheticEntityTables'inda durur (forFeature kaydi)", () => {
    const { g, orderItems, products } = joinFixture();
    const product = g.features().find((f) => f.slug === "product")!;
    const synthNames = product.syntheticEntityTables.map((t) => t.name);
    // Hem cekirdek (products) hem FK-kapanis (order_items) AYNI feature'da -> ikisi de forFeature'a.
    expect(synthNames).toContain("products");
    expect(synthNames).toContain("order_items");
    void orderItems;
    void products;
  });

  it("DETERMINISM: atama iki kez ayni", () => {
    const { g, orderItems } = joinFixture();
    expect(g.featureOf(g.byId(orderItems.id)!)).toBe(g.featureOf(g.byId(orderItems.id)!));
  });
});
