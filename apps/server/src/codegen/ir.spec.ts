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
  it("byId / byName / allOf / resolveRef çözer", () => {
    const svc = node("Service", { ServiceName: "UsersService", Description: "x", IsTransactionScoped: false, Methods: [{ MethodName: "m", ReturnType: "void" }], Dependencies: [] });
    const repo = node("Repository", { RepositoryName: "UsersRepository", Description: "x", EntityReference: "User", CustomQueries: [] });
    const g = buildCodeGraph([svc, repo], []);

    expect(g.byId(svc.id)?.name).toBe("UsersService");
    expect(g.byName("Service", "UsersService")?.id).toBe(svc.id);
    expect(g.allOf("Service")).toHaveLength(1);
    expect(g.resolveRef("Repository", "UsersRepository")?.id).toBe(repo.id);
    expect(g.resolveRef(["Service", "Repository"], "UsersRepository")?.id).toBe(repo.id);
  });

  it("kayıp ref -> null (THROW ETMEZ)", () => {
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

  it("propsOf tipli erişim", () => {
    const t = node("Table", { TableName: "users", Description: "x", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const g = buildCodeGraph([t], []);
    const props = propsOf<"Table">(g.byId(t.id)!);
    expect(props.TableName).toBe("users");
    expect(props.Columns[0].Name).toBe("id");
  });
});

describe("moduleOf heuristiği", () => {
  it("Service -> ExposedServices içeren Module", () => {
    const mod = node("Module", { ModuleName: "UsersModule", Description: "x", StrictBoundaries: false, ExposedServices: ["UsersService"], Dependencies: [] });
    const svc = node("Service", { ServiceName: "UsersService", Description: "x", IsTransactionScoped: false, Methods: [{ MethodName: "m", ReturnType: "void" }], Dependencies: [] });
    const g = buildCodeGraph([mod, svc], []);
    expect(g.moduleOf(g.byId(svc.id)!)?.id).toBe(mod.id);
  });

  it("Controller -> CALLS ettiği Service'in modülü", () => {
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

  it("Repository -> açık Service bağı yokken EntityReference'ın Model'inin modülüne düşer", () => {
    // Repo'yu Dependencies/CALLS ile bağlayan Service YOK; yalnız EntityReference.
    const mod = node("Module", { ModuleName: "UsersModule", Description: "x", StrictBoundaries: false, ExposedServices: ["UsersService"], Dependencies: [] });
    const svc = node("Service", { ServiceName: "UsersService", Description: "x", IsTransactionScoped: false, Methods: [{ MethodName: "m", ReturnType: "void" }], Dependencies: [] });
    const model = node("Model", { ClassName: "User", Description: "x", TableRef: "users", Properties: [{ Name: "id", Type: "uuid" }], Methods: [] });
    const repo = node("Repository", { RepositoryName: "UserRepository", Description: "x", EntityReference: "User", CustomQueries: [] });
    // Model'i modüle bağlamak için Service üzerinden değil; domain-sharing fallback (c)
    // ile UsersService'in modülüne (UsersModule) düşmeli ("user" stem == "users" stem).
    const g = buildCodeGraph([mod, svc, model, repo], []);
    expect(g.moduleOf(g.byId(repo.id)!)?.id).toBe(mod.id);
  });

  it("Repository -> hiç bağ yokken domain-paylaşan Service'in modülüne düşer", () => {
    const mod = node("Module", { ModuleName: "OrdersModule", Description: "x", StrictBoundaries: false, ExposedServices: ["OrdersService"], Dependencies: [] });
    const svc = node("Service", { ServiceName: "OrdersService", Description: "x", IsTransactionScoped: false, Methods: [{ MethodName: "m", ReturnType: "void" }], Dependencies: [] });
    // EntityReference çözülmez (Model yok) -> yalnız domain stem fallback kalır.
    const repo = node("Repository", { RepositoryName: "OrderRepository", Description: "x", EntityReference: "Order", CustomQueries: [] });
    const g = buildCodeGraph([mod, svc, repo], []);
    expect(g.moduleOf(g.byId(repo.id)!)?.id).toBe(mod.id);
  });
});

describe("karşılıklı feature import'u (circular module) DETERMİNİSTİK kırılır", () => {
  /** auth <-> image karşılıklı CALLS: iki feature birbirini import etmek ister.
   *  Beklenen: küçük slug (auth) image'i import etmeye DEVAM eder; büyük slug
   *  (image) auth'a doğru geri-kenarını DÜŞÜRÜR -> boot'ta döngü yok. */
  function mutualFixture() {
    const authCtrl = node("Controller", { ControllerName: "AuthController", Description: "x", BaseRoute: "auth", Endpoints: [] });
    const authSvc = node("Service", { ServiceName: "AuthService", Description: "x", Dependencies: [], Methods: [] });
    const imageCtrl = node("Controller", { ControllerName: "ImageController", Description: "x", BaseRoute: "image", Endpoints: [] });
    const imageSvc = node("Service", { ServiceName: "ImageService", Description: "x", Dependencies: [], Methods: [] });
    const edges = [
      edge("CALLS", authCtrl, authSvc),
      edge("CALLS", imageCtrl, imageSvc),
      edge("CALLS", imageSvc, authSvc), // image -> auth
      edge("CALLS", authSvc, imageSvc), // auth -> image (karşılıklı)
    ];
    return buildCodeGraph([authCtrl, authSvc, imageCtrl, imageSvc], edges);
  }

  it("geri-kenar forwardRef ile işaretlenir: kenar KORUNUR, lazy emit edilir", () => {
    const g = mutualFixture();
    const auth = g.features().find((f) => f.slug === "auth")!;
    const image = g.features().find((f) => f.slug === "image")!;
    // İki yön de dependsOn'da KALIR (kenar SİLİNMEZ → provider import'u kaybolmaz);
    //   (to, from) en küçük geri-kenar = image->auth → image.forwardRefDeps=["auth"].
    expect(auth.dependsOn).toContain("image");
    expect(image.dependsOn).toContain("auth");
    expect(image.forwardRefDeps).toContain("auth");
    expect(auth.forwardRefDeps).not.toContain("image");
  });

  it("export'lar KORUNUR (DI bozulmaz): iki yön de export eder", () => {
    const g = mutualFixture();
    const auth = g.features().find((f) => f.slug === "auth")!;
    const image = g.features().find((f) => f.slug === "image")!;
    // İki servis de cross-feature inject hedefi -> export edilir (import kırılsa da).
    expect(auth.exports.map((e) => e.name)).toContain("AuthService");
    expect(image.exports.map((e) => e.name)).toContain("ImageService");
  });

  it("uyarı üretilir (forwardRef ile kırıldı)", () => {
    const g = mutualFixture();
    expect(g.warnings()).toHaveLength(1);
    const w = g.warnings()[0];
    expect(w).toContain("ImageModule");
    expect(w).toContain("AuthModule");
    expect(w).toContain("forwardRef");
  });

  it("döngü yoksa uyarı yok + dependsOn değişmez", () => {
    // image -> auth tek yönlü (karşılık yok).
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

  it("DETERMİNİZM: warnings + dependsOn iki kez aynı (cache)", () => {
    const g = mutualFixture();
    expect(g.warnings()).toEqual(g.warnings());
    expect(g.features().find((f) => f.slug === "image")!.dependsOn).toEqual(
      g.features().find((f) => f.slug === "image")!.dependsOn,
    );
  });
});

describe("N-CYCLE (3'lü+) module import'u DETERMİNİSTİK kırılır (Bug 1 regresyon)", () => {
  /** auth -> chat -> messaging -> auth ÜÇLÜ döngü (cross-feature CALLS). Eski
   *  breakCircularImports yalnız İKİLİ çiftleri tarıyordu → hiçbir çift mutual
   *  olmadığı için döngü KAÇIYORDU ve NestJS boot'ta UndefinedModuleException
   *  veriyordu. Tarjan SCC üçlüyü yakalar; bir geri-kenar forwardRef olur. */
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
      edge("CALLS", msgSvc, authSvc), // messaging -> auth (döngüyü kapatır)
    ];
    return buildCodeGraph([authCtrl, authSvc, chatCtrl, chatSvc, msgCtrl, msgSvc], edges);
  }

  it("üçlü döngü YAKALANIR: tam bir geri-kenar forwardRef olur (eskiden 0 uyarı)", () => {
    const g = threeCycleFixture();
    // (to, from) en küçük geri-kenar = messaging->auth (to="auth") → forwardRef.
    const auth = g.features().find((f) => f.slug === "auth")!;
    const chat = g.features().find((f) => f.slug === "chat")!;
    const messaging = g.features().find((f) => f.slug === "messaging")!;
    expect(messaging.forwardRefDeps).toEqual(["auth"]);
    expect(auth.forwardRefDeps).toEqual([]);
    expect(chat.forwardRefDeps).toEqual([]);
  });

  it("kenarlar KORUNUR (provider import'u kaybolmaz): dependsOn değişmez", () => {
    const g = threeCycleFixture();
    expect(g.features().find((f) => f.slug === "auth")!.dependsOn).toEqual(["chat"]);
    expect(g.features().find((f) => f.slug === "chat")!.dependsOn).toEqual(["messaging"]);
    expect(g.features().find((f) => f.slug === "messaging")!.dependsOn).toEqual(["auth"]);
  });

  it("tek uyarı üretilir (forwardRef ile kırıldı)", () => {
    const g = threeCycleFixture();
    expect(g.warnings()).toHaveLength(1);
    const w = g.warnings()[0];
    expect(w).toContain("MessagingModule");
    expect(w).toContain("AuthModule");
    expect(w).toContain("forwardRef");
  });

  it("kırılan grafik DAG'dır: kalan eager kenarlar arasında döngü kalmaz", () => {
    const g = threeCycleFixture();
    // forwardRef kenarı çıkarınca: auth->chat, chat->messaging = DAG (messaging->auth lazy).
    const features = g.features();
    const eager = new Map(features.map((f) => [f.slug, f.dependsOn.filter((d) => !f.forwardRefDeps.includes(d))]));
    expect(eager.get("messaging")).toEqual([]); // tek eager-dışı kenar buradaydı
    expect(eager.get("auth")).toEqual(["chat"]);
    expect(eager.get("chat")).toEqual(["messaging"]);
  });
});

describe("#4 cross-feature Repository DI (domain co-location)", () => {
  /** order feature'ı (OrderController->OrderService) ile payment feature'ı
   *  (PaymentService->PaymentRepository). OrderService CROSS-FEATURE olarak
   *  PaymentRepository'yi de CALLS eder. Beklenen: PaymentRepository PAYMENT
   *  feature'ında durur (domain-stem "payment" PaymentService ile co-locate),
   *  order'a KAYMAZ. Böylece PaymentModule onu provider/export eder ve
   *  PaymentService bootta çözebilir; OrderModule da PaymentModule'ü import eder. */
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

  it("PaymentRepository PAYMENT feature'ında durur (order'a kaymaz)", () => {
    const { g, paymentRepo } = crossFeatureFixture();
    // Domain co-location: PaymentRepository, PaymentService ile aynı feature.
    expect(g.featureOf(g.byId(paymentRepo.id)!)).toBe("payment");
  });

  it("PaymentModule PaymentRepository'yi provider + export eder (cross-feature inject hedefi)", () => {
    const { g, paymentRepo } = crossFeatureFixture();
    const payment = g.features().find((f) => f.slug === "payment")!;
    // Provider: kendi feature'ına ait repository.
    expect(payment.repositories.map((r) => r.name)).toContain("PaymentRepository");
    // Export: OrderService (order) onu cross-feature CALLS eder -> export ZORUNLU.
    expect(payment.exports.map((e) => e.name)).toContain("PaymentRepository");
    void paymentRepo;
  });

  it("OrderModule payment feature'ını import eder (dependsOn payment)", () => {
    const { g } = crossFeatureFixture();
    const order = g.features().find((f) => f.slug === "order")!;
    expect(order.dependsOn).toContain("payment");
    // OrderModule PaymentRepository'yi KENDİ provider'ı olarak taşımaz (payment'in).
    expect(order.repositories.map((r) => r.name)).not.toContain("PaymentRepository");
  });

  it("DETERMİNİZM: feature ataması iki kez aynı", () => {
    const { g, paymentRepo } = crossFeatureFixture();
    expect(g.featureOf(g.byId(paymentRepo.id)!)).toBe(g.featureOf(g.byId(paymentRepo.id)!));
  });
});

describe("cross-feature Repository PROPERTY-dep (EDGE YOK) wiring (Bug 2 regresyon)", () => {
  /** token feature'ı (TokenController->TokenService) UserRepository'yi YALNIZ
   *  Service.Dependencies property'si ile enjekte eder — graf'ta CALLS EDGE YOK.
   *  Eski derivasyon property-dep'te Service/Repository'yi ATLIYORDU (yalnız edge
   *  taranıyordu) → TokenModule, UserModule'ü import etmiyor + UserModule export
   *  etmiyordu → boot'ta "Nest can't resolve UserRepository" (UnknownDependencies).
   *  Beklenen: token.dependsOn ⊇ user (import) VE user.exports ⊇ UserRepository. */
  function propDepFixture() {
    const userCtrl = node("Controller", { ControllerName: "UserController", Description: "x", BaseRoute: "users", Endpoints: [] });
    const userSvc = node("Service", { ServiceName: "UserService", Description: "x", Dependencies: [], Methods: [] });
    const userRepo = node("Repository", { RepositoryName: "UserRepository", Description: "x", EntityReference: "users", CustomQueries: [] });
    const tokenCtrl = node("Controller", { ControllerName: "TokenController", Description: "x", BaseRoute: "tokens", Endpoints: [] });
    // TokenService UserRepository'yi PROPERTY ile enjekte eder — CALLS edge YOK.
    const tokenSvc = node("Service", { ServiceName: "TokenService", Description: "x", Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }], Methods: [] });
    const edges = [
      edge("CALLS", userCtrl, userSvc),
      edge("CALLS", userSvc, userRepo),
      edge("CALLS", tokenCtrl, tokenSvc),
      // DİKKAT: tokenSvc -> userRepo CALLS edge'i BİLEREK YOK (yalnız property-dep).
    ];
    return buildCodeGraph([userCtrl, userSvc, userRepo, tokenCtrl, tokenSvc], edges);
  }

  it("UserRepository USER feature'ında durur", () => {
    const g = propDepFixture();
    const userRepo = g.byName("Repository", "UserRepository")!;
    expect(g.featureOf(userRepo)).toBe("user");
  });

  it("TokenModule UserModule'ü import eder (dependsOn ⊇ user) — property-dep'ten", () => {
    const g = propDepFixture();
    const token = g.features().find((f) => f.slug === "token")!;
    expect(token.dependsOn).toContain("user");
    // TokenModule UserRepository'yi KENDİ provider'ı olarak TAŞIMAZ (user'ın).
    expect(token.repositories.map((r) => r.name)).not.toContain("UserRepository");
  });

  it("UserModule UserRepository'yi EXPORT eder (cross-feature property-inject hedefi)", () => {
    const g = propDepFixture();
    const user = g.features().find((f) => f.slug === "user")!;
    expect(user.repositories.map((r) => r.name)).toContain("UserRepository");
    expect(user.exports.map((e) => e.name)).toContain("UserRepository");
  });
});

describe("#7 cross-feature infra provider TEK SAHİP (singleton korunur)", () => {
  /** payment (PaymentService) + order (OrderService) İKİSİ de PaymentGateway
   *  (ExternalService) enjekte eder; order ayrıca payment'i CALLS eder. Eski
   *  davranış: PaymentGateway hem payment hem order'ın infraProviders'ına girer ->
   *  iki module'de provider -> iki örnek (singleton kırık). Beklenen: PaymentGateway
   *  TEK feature'da (payment) provider+export; order onu KENDİ provider'ı olarak
   *  TAŞIMAZ, PaymentModule'ü import eder (dependsOn=payment); "common"a düşmez. */
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

  it("PaymentGateway YALNIZ payment feature'ının provider'ı (order'da YOK)", () => {
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

  it("sahip seçimi DÖNGÜSÜZ: payment seçilir (order zaten payment'a bağımlı) + uyarı yok", () => {
    const { g, gw } = doubleInjectFixture();
    // order->payment service-call'u zaten var -> in-degree(payment)=1 > order=0 -> payment sahip.
    expect(g.featureOf(g.byId(gw.id)!)).toBe("payment");
    // Sahip seçimi yeni geri-kenar (payment->order) yaratmadı -> döngü kırma uyarısı yok.
    expect(g.warnings()).toHaveLength(0);
  });

  it("PaymentGateway 'common'a DÜŞMEZ (CommonModule onu tekrar yazmaz)", () => {
    const { g } = doubleInjectFixture();
    const common = g.commonFeature();
    const commonInfra = common?.infraProviders.map((n) => n.name) ?? [];
    expect(commonInfra).not.toContain("PaymentGateway");
  });

  it("DETERMİNİZM: sahip ataması iki kez aynı", () => {
    const { g, gw } = doubleInjectFixture();
    expect(g.featureOf(g.byId(gw.id)!)).toBe(g.featureOf(g.byId(gw.id)!));
  });

  it("simetrik enjekte (injectorlar arası service-call YOK): isimce ilk slug sahip, döngü yok", () => {
    // billing + report İKİSİ de RateCache enjekte eder, aralarında çağrı YOK.
    const billCtrl = node("Controller", { ControllerName: "BillingController", Description: "x", BaseRoute: "billing", Endpoints: [] });
    const billSvc = node("Service", { ServiceName: "BillingService", Description: "x", Dependencies: [{ Kind: "Cache", Ref: "RateCache" }], Methods: [] });
    const repCtrl = node("Controller", { ControllerName: "ReportController", Description: "x", BaseRoute: "report", Endpoints: [] });
    const repSvc = node("Service", { ServiceName: "ReportService", Description: "x", Dependencies: [{ Kind: "Cache", Ref: "RateCache" }], Methods: [] });
    const cache = node("Cache", { CacheName: "RateCache", Description: "x", KeyPattern: "r:{id}", TTL_Seconds: 60, Engine: "Redis" });
    const g = buildCodeGraph(
      [billCtrl, billSvc, repCtrl, repSvc, cache],
      [edge("CALLS", billCtrl, billSvc), edge("CALLS", repCtrl, repSvc), edge("CACHES_IN", billSvc, cache), edge("CACHES_IN", repSvc, cache)],
    );
    // Eşit in-degree (0/0) -> isimce ilk = billing sahip.
    expect(g.featureOf(g.byId(cache.id)!)).toBe("billing");
    const billing = g.features().find((f) => f.slug === "billing")!;
    const report = g.features().find((f) => f.slug === "report")!;
    expect(billing.infraProviders.map((n) => n.name)).toContain("RateCache");
    expect(report.infraProviders.map((n) => n.name)).not.toContain("RateCache");
    expect(report.dependsOn).toContain("billing");
    expect(g.warnings()).toHaveLength(0);
  });

  it("tek feature enjekte ediyorsa SAHİPLİK KURALI DEVREYE GİRMEZ (eski davranış)", () => {
    // Yalnız payment PaymentGateway enjekte eder -> doğrudan payment'ın infraProviders'ı.
    const payCtrl = node("Controller", { ControllerName: "PaymentController", Description: "x", BaseRoute: "payment", Endpoints: [] });
    const paySvc = node("Service", { ServiceName: "PaymentService", Description: "x", Dependencies: [{ Kind: "ExternalService", Ref: "PaymentGateway" }], Methods: [] });
    const gw = node("ExternalService", { ServiceName: "PaymentGateway", Description: "x", BaseURL: "https://pg.example.com", AuthType: "None", TimeoutSeconds: 10, Endpoints: [] });
    const g = buildCodeGraph([payCtrl, paySvc, gw], [edge("CALLS", payCtrl, paySvc), edge("REQUESTS", paySvc, gw)]);
    const payment = g.features().find((f) => f.slug === "payment")!;
    expect(payment.infraProviders.map((n) => n.name)).toContain("PaymentGateway");
    expect(g.featureOf(g.byId(gw.id)!)).toBe("payment");
  });

  /** REGRESYON (b4f3 GERÇEĞİ): order, PaymentGateway'i YALNIZ property-Dependency
   *  ile enjekte eder (REQUESTS EDGE YOK); payment ise edge ile enjekte eder. Eski
   *  computeInfraOwners SADECE inject-edge'lere bakıyordu -> order injector SAYILMAZ,
   *  injectorSlugs.size=1 -> tek-sahip kuralı atlanır -> PaymentGateway hem order hem
   *  payment module'üne provider olur (singleton kırık). Düzeltme: computeInfraOwners
   *  artık property-Dependency'leri de sayar -> injector=2 -> tek sahip (payment). */
  it("property-Dependency ile enjekte (EDGE YOK) de tek-sahip kuralını tetikler", () => {
    const payCtrl = node("Controller", { ControllerName: "PaymentController", Description: "x", BaseRoute: "payment", Endpoints: [] });
    const paySvc = node("Service", { ServiceName: "PaymentService", Description: "x", Dependencies: [{ Kind: "ExternalService", Ref: "PaymentGateway" }], Methods: [] });
    const orderCtrl = node("Controller", { ControllerName: "OrderController", Description: "x", BaseRoute: "order", Endpoints: [] });
    // order: PaymentGateway SADECE property-dep (REQUESTS edge YOK) + order->payment service-call.
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
    // PaymentGateway TEK feature'da (payment) provider+export; order onu TAŞIMAZ.
    expect(payment.infraProviders.map((n) => n.name)).toContain("PaymentGateway");
    expect(order.infraProviders.map((n) => n.name)).not.toContain("PaymentGateway");
    expect(payment.exports.map((e) => e.name)).toContain("PaymentGateway");
    expect(order.dependsOn).toContain("payment");
    expect(g.featureOf(g.byId(gw.id)!)).toBe("payment");
    expect(g.warnings()).toHaveLength(0);
  });
});

describe("migration sırası (FK topolojisi + isim)", () => {
  it("referans verilen tablo önce gelir", () => {
    const users = node("Table", { TableName: "users", Description: "x", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const orders = node("Table", { TableName: "orders", Description: "x", Columns: [{ Name: "user_id", DataType: "UUID", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [{ Columns: ["user_id"], ReferencesTable: "users", ReferencesColumns: ["id"], OnDelete: "CASCADE", OnUpdate: "NO_ACTION" }], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const g = buildCodeGraph([orders, users], []);
    const usersIdx = g.migrationIndexOf(g.byName("Table", "users")!);
    const ordersIdx = g.migrationIndexOf(g.byName("Table", "orders")!);
    expect(usersIdx).toBeLessThan(ordersIdx);
  });

  it("FK döngüsü patlatmaz (kalanlar isim sırasında)", () => {
    const a = node("Table", { TableName: "a_tbl", Description: "x", Columns: [{ Name: "b_id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [{ Columns: ["b_id"], ReferencesTable: "b_tbl", ReferencesColumns: ["id"], OnDelete: "NO_ACTION", OnUpdate: "NO_ACTION" }], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const b = node("Table", { TableName: "b_tbl", Description: "x", Columns: [{ Name: "a_id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [{ Columns: ["a_id"], ReferencesTable: "a_tbl", ReferencesColumns: ["id"], OnDelete: "NO_ACTION", OnUpdate: "NO_ACTION" }], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const g = buildCodeGraph([a, b], []);
    expect(() => g.migrationIndexOf(g.byName("Table", "a_tbl")!)).not.toThrow();
  });
});

describe("#4 orphan join tablosu entity'si forFeature'a kaydedilir (boot regresyonu)", () => {
  /** Gerçek e-ticaret deseni: products tablosunu bir Repository gösterir (sentetik
   *  entity ÇEKİRDEK), order_items ise hiçbir repo göstermez ama products'a FK
   *  verir (orphan join tablosu). entity-synthesis order_items için @Entity +
   *  @ManyToOne(Product) üretir; Product entity'sinde @OneToMany(OrderItem) doğar.
   *  Eğer order_items HİÇBİR feature'ın TypeOrmModule.forFeature'ına girmezse
   *  TypeORM bootta "Entity metadata for Product#orderItems not found" fırlatır.
   *  Bu test, IR'ın order_items'i bir feature'a (FK co-location -> products'ın
   *  feature'ı) atadığını ve o feature'ın syntheticEntityTables'ında durduğunu
   *  doğrular -> module.emitter onu forFeature'a kaydeder -> uygulama BOOT EDER. */
  function joinFixture() {
    const products = node("Table", { TableName: "products", Description: "x", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }], ForeignKeys: [], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const productSvc = node("Service", { ServiceName: "ProductService", Description: "x", Dependencies: [], Methods: [] });
    const productRepo = node("Repository", { RepositoryName: "ProductRepository", Description: "x", EntityReference: "products", CustomQueries: [] });
    const orderItems = node("Table", { TableName: "order_items", Description: "join", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }, { Name: "product_id", DataType: "UUID", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false }], ForeignKeys: [{ Columns: ["product_id"], ReferencesTable: "products", ReferencesColumns: ["id"], OnDelete: "CASCADE", OnUpdate: "NO_ACTION" }], UniqueConstraints: [], CheckConstraints: [], Indexes: [] });
    const g = buildCodeGraph([products, productSvc, productRepo, orderItems], [edge("CALLS", productSvc, productRepo), edge("WRITES", productRepo, products)]);
    return { g, orderItems, products };
  }

  it("order_items bir feature'a atanır (kendi orphan slug'ında ASILI KALMAZ)", () => {
    const { g, orderItems } = joinFixture();
    const slug = g.featureOf(g.byId(orderItems.id)!);
    // FK co-location: products'ın feature'ı (product). Orphan "order-items"e DÜŞMEZ.
    expect(slug).toBe("product");
  });

  it("atandığı feature'ın syntheticEntityTables'ında durur (forFeature kaydı)", () => {
    const { g, orderItems, products } = joinFixture();
    const product = g.features().find((f) => f.slug === "product")!;
    const synthNames = product.syntheticEntityTables.map((t) => t.name);
    // Hem çekirdek (products) hem FK-kapanış (order_items) AYNI feature'da -> ikisi de forFeature'a.
    expect(synthNames).toContain("products");
    expect(synthNames).toContain("order_items");
    void orderItems;
    void products;
  });

  it("DETERMİNİZM: atama iki kez aynı", () => {
    const { g, orderItems } = joinFixture();
    expect(g.featureOf(g.byId(orderItems.id)!)).toBe(g.featureOf(g.byId(orderItems.id)!));
  });
});
