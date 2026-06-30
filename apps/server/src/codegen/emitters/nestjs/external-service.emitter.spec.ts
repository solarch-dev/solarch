import { describe, it, expect } from "vitest";
import { emitExternalService } from "./external-service.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";

/* ── Fixture yardımcıları ──────────────────────────────────────────────── */
const PROJECT_ID = "00000000-0000-4000-8000-000000000000";
const TAB_ID = "22222222-2222-4222-8222-222222222222";

function extNode(
  properties: Record<string, unknown>,
  id = "11111111-1111-4111-8111-111111111111",
): StoredNode {
  return {
    id,
    type: "ExternalService",
    projectId: PROJECT_ID,
    positionX: 0,
    positionY: 0,
    homeTabId: TAB_ID,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function serviceNode(
  properties: Record<string, unknown>,
  id = "33333333-3333-4333-8333-333333333333",
): StoredNode {
  return {
    id,
    type: "Service",
    projectId: PROJECT_ID,
    positionX: 0,
    positionY: 0,
    homeTabId: TAB_ID,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function callsEdge(
  sourceNodeId: string,
  targetNodeId: string,
  id = "44444444-4444-4444-8444-444444444444",
): StoredEdge {
  return {
    id,
    projectId: PROJECT_ID,
    sourceNodeId,
    targetNodeId,
    kind: "CALLS",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: true },
  };
}

function ctxFor(nodes: StoredNode[], edges: StoredEdge[] = []): { ctx: EmitterContext } {
  const graph = buildCodeGraph(nodes, edges);
  return { ctx: { graph, target: "nestjs" } };
}

/** Tipik dış servis: Stripe-benzeri Bearer auth + iki endpoint. */
const STRIPE = {
  ServiceName: "StripeClient",
  Description: "Stripe ödeme API istemcisi",
  BaseURL: "https://api.stripe.com",
  AuthType: "Bearer",
  TimeoutSeconds: 30,
  Endpoints: [
    { Name: "CreateCharge", Method: "POST", Path: "/v1/charges" },
    { Name: "RefundCharge", Method: "POST", Path: "/v1/refunds" },
  ],
};

describe("emitExternalService", () => {
  it("@Injectable HTTP client snapshot (gerçek kod, stub değil)", () => {
    const node = extNode(STRIPE);
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { HttpService } from "@nestjs/axios";
      import { Injectable } from "@nestjs/common";
      import { ConfigService } from "@nestjs/config";

      /** Stripe ödeme API istemcisi */
      @Injectable()
      export class StripeClient {
        private readonly baseUrl: string;
        private readonly timeoutMs: number;

        constructor(
          private readonly http: HttpService,
          private readonly config: ConfigService,
        ) {
          this.baseUrl = this.config.get<string>("STRIPE_CLIENT_BASE_URL") ?? "";
          this.timeoutMs = (this.config.get<number>("STRIPE_CLIENT_TIMEOUT_SECONDS") ?? 30) * 1000;
        }

        async createCharge(payload?: unknown): Promise<unknown> {
          // @solarch:surgical id=11111111-1111-4111-8111-111111111111#createCharge
          // POST /v1/charges — external service call. Call this.authHeaders() for the headers.
          // deps: this.http.post, this.baseUrl, this.timeoutMs, this.authHeaders()
          // "/v1/charges" -> this.http.post(this.baseUrl + "/v1/charges")
          throw new Error("NOT_IMPLEMENTED: StripeClient.createCharge");
        }

        async refundCharge(payload?: unknown): Promise<unknown> {
          // @solarch:surgical id=11111111-1111-4111-8111-111111111111#refundCharge
          // POST /v1/refunds — external service call. Call this.authHeaders() for the headers.
          // deps: this.http.post, this.baseUrl, this.timeoutMs, this.authHeaders()
          // "/v1/refunds" -> this.http.post(this.baseUrl + "/v1/refunds")
          throw new Error("NOT_IMPLEMENTED: StripeClient.refundCharge");
        }

        private authHeaders(): Record<string, string> {
          // @solarch:surgical id=11111111-1111-4111-8111-111111111111#authHeaders
          // Bearer authentication headers (the secret is bound via ENV STRIPE_CLIENT_AUTH_TOKEN, never embedded in code).
          // deps: this.config
          // secret = this.config.get<string>("STRIPE_CLIENT_AUTH_TOKEN");  // ENV binding — no raw secret
          throw new Error("NOT_IMPLEMENTED: StripeClient.authHeaders");
        }
      }
      ",
        "language": "typescript",
        "path": "common/stripe.client.ts",
        "surgicalMarkers": 3,
      }
    `);
  });

  it("sınıf adı gerçek (pascalCase), Stub eki YOK", () => {
    const node = extNode(STRIPE);
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain("export class StripeClient {");
    expect(file.content).not.toContain("StripeClientStub");
    expect(file.content).not.toContain("Stub");
  });

  it("HttpService + ConfigService inject edilir, HttpModule importu beklenir", () => {
    const node = extNode(STRIPE);
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain('import { HttpService } from "@nestjs/axios";');
    expect(file.content).toContain('import { ConfigService } from "@nestjs/config";');
    expect(file.content).toContain("private readonly http: HttpService,");
    expect(file.content).toContain("private readonly config: ConfigService,");
  });

  it("dosya yolu feature-aware (filePathFor -> <feature>/<base>.client.ts)", () => {
    const node = extNode(STRIPE);
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    // baseNameOf("StripeClient") -> "Stripe"; referrer'sız standalone node
    // feature-inference'ta "common"a düşer (bir Service CALLS etmiyor).
    expect(file.path).toBe("common/stripe.client.ts");
    expect(file.path.endsWith(".client.ts")).toBe(true);
  });

  it("feature ataması: bir Service CALLS ederse o feature klasörüne yazılır", () => {
    const ext = extNode({
      ServiceName: "StableDiffusionApi",
      Description: "Görsel üretimi",
      BaseURL: "https://sd.example.com",
      AuthType: "API_Key",
      TimeoutSeconds: 60,
      Endpoints: [],
    });
    const svc = serviceNode({
      ServiceName: "ImageGenerationService",
      Description: "Görsel üreten servis",
      Methods: [],
      Dependencies: [],
    });
    const { ctx } = ctxFor([ext, svc], [callsEdge(svc.id, ext.id)]);
    const [file] = emitExternalService(ctx.graph.byId(ext.id)!, ctx);
    // baseNameOf("StableDiffusionApi") -> "StableDiffusion"; CALLS eden servis
    // "image-generation" feature'ında -> ext de aynı feature'a düşer.
    expect(file.path).toBe("image-generation/stable-diffusion.client.ts");
    expect(file.content).toContain("export class StableDiffusionApi {");
  });

  it("Endpoint yoksa tek generic request<T> metodu üretir", () => {
    const node = extNode({
      ServiceName: "MailService",
      Description: "E-posta gönderimi",
      BaseURL: "https://mail.example.com",
      AuthType: "None",
      TimeoutSeconds: 10,
      Endpoints: [],
    });
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain(
      "async request<T = unknown>(method: string, path: string, payload?: unknown): Promise<T> {",
    );
    expect(file.content).toContain("NOT_IMPLEMENTED: MailService.request");
    // baseNameOf("MailService") -> "Mail" (Service eki düşer); standalone ->
    // common feature klasörü.
    expect(file.path).toBe("common/mail.client.ts");
  });

  it("Endpoint metotları Name'e göre deterministik sıralı (Zebra önce mi sonra mı)", () => {
    const node = extNode({
      ServiceName: "MultiApi",
      Description: "çok uçlu",
      BaseURL: "https://m.example.com",
      AuthType: "None",
      TimeoutSeconds: 5,
      Endpoints: [
        { Name: "Zebra", Method: "GET", Path: "/z" },
        { Name: "Alpha", Method: "GET", Path: "/a" },
        { Name: "Mango", Method: "GET", Path: "/m" },
      ],
    });
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    const idxAlpha = file.content.indexOf("async alpha(");
    const idxMango = file.content.indexOf("async mango(");
    const idxZebra = file.content.indexOf("async zebra(");
    expect(idxAlpha).toBeGreaterThan(-1);
    expect(idxAlpha).toBeLessThan(idxMango);
    expect(idxMango).toBeLessThan(idxZebra);
  });

  it("HTTP fiili HttpService metoduna eşlenir (this.http.<verb>)", () => {
    const node = extNode({
      ServiceName: "VerbApi",
      Description: "fiiller",
      BaseURL: "https://v.example.com",
      AuthType: "None",
      TimeoutSeconds: 5,
      Endpoints: [
        { Name: "FetchThing", Method: "GET", Path: "/t" },
        { Name: "RemoveThing", Method: "DELETE", Path: "/t" },
      ],
    });
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain("this.http.get");
    expect(file.content).toContain("this.http.delete");
  });

  it("AuthType=None -> authHeaders helper'ı ÜRETİLMEZ", () => {
    const node = extNode({
      ServiceName: "OpenApi",
      Description: "auth yok",
      BaseURL: "https://o.example.com",
      AuthType: "None",
      TimeoutSeconds: 5,
      Endpoints: [{ Name: "Ping", Method: "GET", Path: "/ping" }],
    });
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).not.toContain("authHeaders");
  });

  it("API_Key auth -> ENV binding ile API_KEY, RAW secret koda gömülmez", () => {
    const node = extNode({
      ServiceName: "KeyedApi",
      Description: "api key",
      BaseURL: "https://k.example.com",
      AuthType: "API_Key",
      TimeoutSeconds: 5,
      Endpoints: [],
    });
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain("private authHeaders(): Record<string, string> {");
    expect(file.content).toContain("KEYED_API_API_KEY");
    // BaseURL bir literal olarak koda gömülmemeli (ENV binding ile okunur).
    expect(file.content).not.toContain("https://k.example.com");
  });

  it("BaseURL/Timeout ConfigService env-var binding ile okunur (literal gömülmez)", () => {
    const node = extNode(STRIPE);
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain('this.config.get<string>("STRIPE_CLIENT_BASE_URL")');
    expect(file.content).toContain('this.config.get<number>("STRIPE_CLIENT_TIMEOUT_SECONDS")');
    expect(file.content).not.toContain("https://api.stripe.com");
    // Fallback olarak schema TimeoutSeconds kullanılır.
    expect(file.content).toContain("?? 30) * 1000");
  });

  it("surgicalMarkers gövde gerektiren her metotta sayılır", () => {
    const node = extNode(STRIPE);
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    // 2 endpoint + 1 authHeaders = 3 marker.
    expect(file.surgicalMarkers).toBe(3);
    expect(file.content).toContain("@solarch:surgical");
  });

  it("içerik tek satır sonu ile biter", () => {
    const node = extNode(STRIPE);
    const { ctx } = ctxFor([node]);
    const [file] = emitExternalService(ctx.graph.byId(node.id)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMİNİZM: aynı node iki kez -> byte-identical", () => {
    const node = extNode(STRIPE);
    const { ctx } = ctxFor([node]);
    const a = emitExternalService(ctx.graph.byId(node.id)!, ctx)[0].content;
    const b = emitExternalService(ctx.graph.byId(node.id)!, ctx)[0].content;
    expect(a).toBe(b);
  });
});
