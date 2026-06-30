import { describe, it, expect } from "vitest";
import { emitApiGateway } from "./api-gateway.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ── Fixture yardımcıları ──────────────────────────────────────────────── */

const PROJECT = "00000000-0000-4000-8000-000000000000";
const HOME_TAB = "22222222-2222-4222-8222-222222222222";

function node(
  type: StoredNode["type"],
  properties: Record<string, unknown>,
  id: string,
): StoredNode {
  return {
    id,
    type,
    projectId: PROJECT,
    positionX: 0,
    positionY: 0,
    homeTabId: HOME_TAB,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function edge(
  kind: EdgeKind,
  sourceNodeId: string,
  targetNodeId: string,
  id: string,
): StoredEdge {
  return {
    id,
    projectId: PROJECT,
    sourceNodeId,
    targetNodeId,
    kind,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: false },
  };
}

function ctxFor(nodes: StoredNode[], edges: StoredEdge[] = []): { ctx: EmitterContext } {
  const graph = buildCodeGraph(nodes, edges);
  return { ctx: { graph, target: "nestjs" } };
}

/* ── id sabitleri ──────────────────────────────────────────────────────── */
const GW = "11111111-1111-4111-8111-111111111111";
const USERS_CTRL = "33333333-3333-4333-8333-333333333333";
const AUTH_SVC = "44444444-4444-4444-8444-444444444444";

/* ── Gateway fixture'ları ──────────────────────────────────────────────── */
function gatewayNode(props: Partial<Record<string, unknown>> = {}, id = GW): StoredNode {
  return node(
    "APIGateway",
    {
      GatewayName: "PublicApiGateway",
      Description: "Genel API girişi",
      Provider: "Kong",
      Routes: [],
      ...props,
    },
    id,
  );
}

function usersController(id = USERS_CTRL): StoredNode {
  return node(
    "Controller",
    { ControllerName: "UsersController", Description: "Kullanıcı uçları", BaseRoute: "users", Endpoints: [] },
    id,
  );
}

describe("emitApiGateway", () => {
  it("rol-tekrarsız .gateway.ts yolu (APIGateway eki düşer, base = Public)", () => {
    // B2: Gateway gerçek bir @Controller -> Controller gibi KENDİ feature'ını
    //   tohumlar (hedef çözülmese bile orphan kalmasın). "PublicApiGateway" en-
    //   spesifik "APIGateway" ekiyle eşleşir -> base "Public" -> feature "public".
    const gw = gatewayNode();
    const { ctx } = ctxFor([gw]);
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    expect(file.path).toBe("public/public.gateway.ts");
  });

  it("@Controller() sınıfı (Injectable DEĞİL) + Provider/Description doc-comment", () => {
    // B2: Gateway artık GERÇEK bir @Controller'dır (orphan @Injectable değil) ->
    //   feature module'ün controllers'ına girer; NestJS routing'i otomatik bağlar.
    const gw = gatewayNode();
    const { ctx } = ctxFor([gw]);
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    expect(file.content).toContain("@Controller()");
    expect(file.content).not.toContain("@Injectable()");
    expect(file.content).toContain("export class PublicApiGateway {");
    expect(file.content).toContain(" * Genel API girişi");
    expect(file.content).toContain(" * API Gateway (Provider: Kong).");
    expect(file.content).toContain('import { Controller');
    expect(file.content).toContain('from "@nestjs/common";');
  });

  it("Routes[].TargetRef Service'e çözülür -> DI + göreli import + @Get + delegasyon ipucu", () => {
    // B2: Gateway YALNIZ Service enjekte eder (Controller anti-pattern -> DI'a alınmaz).
    const gw = gatewayNode({
      Routes: [
        {
          Path: "/users/:id",
          TargetRef: "AuthService",
          Methods: ["GET"],
          AuthRequired: false,
        },
      ],
    });
    const svc = node("Service", { ServiceName: "AuthService", Methods: [] }, AUTH_SVC);
    // CALLS edge'i ile gateway, service'in feature'ına (auth) düşer.
    const { ctx } = ctxFor([gw, svc], [edge("CALLS", GW, AUTH_SVC, "55555555-5555-4555-8555-555555555555")]);
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    // DI: constructor'da AuthService (Service).
    expect(file.content).toContain("private readonly authService: AuthService,");
    // göreli import (feature=auth; gateway de auth altında).
    expect(file.content).toContain('import { AuthService } from "./auth.service";');
    // HTTP dekoratörlü route metodu + delegasyon ipucu marker'da.
    expect(file.content).toContain('@Get("users/:id")');
    expect(file.content).toContain("async dispatchGetUsersById(): Promise<unknown> {");
    expect(file.content).toContain("// Delegation hint: this.authService.<?>(...).");
  });

  it("wildcard route (api/auth/*) -> GEÇERLİ metot adı (`*` identifier'a sızmaz, TS1434/TS1003 önle)", () => {
    // Gerçek bug: route Path "/api/auth/*" -> metot adı "dispatchGetApiAuth*" üretiliyordu;
    // `*` geçersiz identifier -> sözdizimi hatası (derleme kırılır). Wildcard -> "All".
    const gw = gatewayNode({
      Routes: [{ Path: "/api/auth/*", TargetRef: "AuthService", Methods: ["GET"], AuthRequired: false }],
    });
    const svc = node("Service", { ServiceName: "AuthService", Methods: [] }, AUTH_SVC);
    const { ctx } = ctxFor([gw, svc], [edge("CALLS", GW, AUTH_SVC, "55555555-5555-4555-8555-555555555555")]);
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    // Metot adında `*` (veya başka identifier-dışı karakter) YOK.
    expect(file.content).not.toMatch(/async dispatch\w*[^A-Za-z0-9(]/);
    expect(file.content).toContain("async dispatchGetApiAuthAll(): Promise<unknown> {");
    // Route argümanı `*`'ı KORUR (Express wildcard'ı runtime'da geçerli).
    expect(file.content).toContain('@Get("api/auth/*")');
  });

  it("Controller hedefi DI'a ALINMAZ (anti-pattern); metot yine üretilir + marker'da not", () => {
    // B2: Bir route Controller'a işaret ederse DI ile enjekte edilmez (controller'a
    //   HTTP ile gidilir). Constructor boştur; route metodu marker'da not taşır.
    const gw = gatewayNode({
      Routes: [
        { Path: "/users/:id", TargetRef: "UsersController", Methods: ["GET"], AuthRequired: false },
      ],
    });
    const ctrl = usersController();
    const { ctx } = ctxFor([gw, ctrl], [edge("ROUTES_TO", GW, USERS_CTRL, "55555555-5555-4555-8555-555555555555")]);
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    expect(file.content).not.toContain("private readonly usersController");
    expect(file.content).not.toContain("constructor(");
    expect(file.content).toContain('// TODO: target "UsersController" did not resolve to a Service (Controller targets are not injected via DI).');
    expect(file.content).toContain("async dispatchGetUsersById(): Promise<unknown> {");
  });

  it("her route bir surgical-marker'lı @-dekoratörlü metot + NOT_IMPLEMENTED gövdesi", () => {
    const gw = gatewayNode({
      Routes: [
        { Path: "/login", TargetRef: "AuthService", Methods: ["POST"], AuthRequired: false },
      ],
    });
    const svc = node("Service", { ServiceName: "AuthService", Methods: [] }, AUTH_SVC);
    const { ctx } = ctxFor([gw, svc], [edge("CALLS", GW, AUTH_SVC, "66666666-6666-4666-8666-666666666666")]);
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    expect(file.surgicalMarkers).toBe(1);
    expect(file.content).toContain('@Post("login")');
    expect(file.content).toContain(`// @solarch:surgical id=${GW}#dispatchPostLogin`);
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: PublicApiGateway.dispatchPostLogin");');
    expect(file.content).toContain("private readonly authService: AuthService,");
  });

  it("AuthRequired + RateLimit ipuçları marker açıklamasında", () => {
    const gw = gatewayNode({
      Routes: [
        {
          Path: "/admin",
          TargetRef: "AuthService",
          Methods: ["GET"],
          AuthRequired: true,
          RateLimit: { Requests: 100, WindowSeconds: 60 },
        },
      ],
    });
    const svc = node("Service", { ServiceName: "AuthService", Methods: [] }, AUTH_SVC);
    const { ctx } = ctxFor([gw, svc], [edge("CALLS", GW, AUTH_SVC, "66666666-6666-4666-8666-666666666666")]);
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    expect(file.content).toContain("// Requires auth (AuthRequired=true).");
    expect(file.content).toContain("// Rate limit: 100 requests / 60s.");
  });

  it("kayıp TargetRef -> THROW yok, DI yok, marker'da TODO ipucu", () => {
    const gw = gatewayNode({
      Routes: [
        { Path: "/ghost", TargetRef: "GhostService", Methods: ["GET"], AuthRequired: false },
      ],
    });
    const { ctx } = ctxFor([gw]);
    expect(() => emitApiGateway(ctx.graph.byId(GW)!, ctx)).not.toThrow();
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    expect(file.content).not.toContain("constructor(");
    expect(file.content).toContain('// TODO: target "GhostService" did not resolve to a Service');
    expect(file.content).toContain("async dispatchGetGhost(): Promise<unknown> {");
  });

  it("aynı dispatch adı -> deterministik tekilleştirme (2, 3)", () => {
    const gw = gatewayNode({
      Routes: [
        { Path: "/users", TargetRef: "AuthService", Methods: ["GET"], AuthRequired: false },
        { Path: "/users", TargetRef: "AuthService", Methods: ["GET"], AuthRequired: false },
      ],
    });
    const svc = node("Service", { ServiceName: "AuthService", Methods: [] }, AUTH_SVC);
    const { ctx } = ctxFor([gw, svc], [edge("CALLS", GW, AUTH_SVC, "66666666-6666-4666-8666-666666666666")]);
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    expect(file.content).toContain("async dispatchGetUsers(): Promise<unknown> {");
    expect(file.content).toContain("async dispatchGetUsers2(): Promise<unknown> {");
  });

  it("DI hedefleri SADECE Service + DEDUP + isme göre sıralı (Routes ∪ ROUTES_TO ∪ CALLS)", () => {
    const gw = gatewayNode({
      Routes: [
        { Path: "/a", TargetRef: "BillingService", Methods: ["GET"], AuthRequired: false },
        { Path: "/b", TargetRef: "AuthService", Methods: ["GET"], AuthRequired: false },
      ],
    });
    const auth = node("Service", { ServiceName: "AuthService", Methods: [] }, AUTH_SVC);
    const billing = node("Service", { ServiceName: "BillingService", Methods: [] }, "88888888-8888-4888-8888-888888888888");
    // CALLS ayrıca AuthService'e -> DEDUP (tek alan kalmalı).
    const { ctx } = ctxFor(
      [gw, auth, billing],
      [edge("CALLS", GW, AUTH_SVC, "77777777-7777-4777-8777-777777777777")],
    );
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    // İsme göre sıralı: AuthService önce, BillingService sonra.
    const authIdx = file.content.indexOf("authService: AuthService");
    const billingIdx = file.content.indexOf("billingService: BillingService");
    expect(authIdx).toBeGreaterThan(-1);
    expect(billingIdx).toBeGreaterThan(authIdx);
    // DEDUP: AuthService constructor'da bir kez.
    expect(file.content.match(/authService: AuthService/g)?.length).toBe(1);
  });

  it("rol eki adın tamamıysa orijinal ad korunur (Gateway -> gateway/gateway.gateway.ts)", () => {
    // B2: Hedefsiz gateway de kendi feature'ını tohumlar (orphan değil). Rol eki
    //   ("Gateway") adın tamamı -> base "gateway" -> feature "gateway".
    const gw = gatewayNode({ GatewayName: "Gateway" });
    const { ctx } = ctxFor([gw]);
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    expect(file.path).toBe("gateway/gateway.gateway.ts");
    expect(file.content).toContain("export class Gateway {");
  });

  it("içerik tek satır sonu ile biter", () => {
    const gw = gatewayNode();
    const { ctx } = ctxFor([gw]);
    const [file] = emitApiGateway(ctx.graph.byId(GW)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMİNİZM: aynı node iki kez -> byte-identical", () => {
    const gw = gatewayNode({
      Routes: [
        { Path: "/users/:id", TargetRef: "UsersController", Methods: ["GET"], AuthRequired: false },
        { Path: "/login", TargetRef: "AuthService", Methods: ["POST"], AuthRequired: true },
      ],
    });
    const svc = node("Service", { ServiceName: "AuthService", Methods: [] }, AUTH_SVC);
    const { ctx } = ctxFor([gw, usersController(), svc]);
    const a = emitApiGateway(ctx.graph.byId(GW)!, ctx)[0].content;
    const b = emitApiGateway(ctx.graph.byId(GW)!, ctx)[0].content;
    expect(a).toBe(b);
  });
});
