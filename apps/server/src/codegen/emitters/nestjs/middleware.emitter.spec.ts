import { describe, it, expect } from "vitest";
import { emitMiddleware } from "./middleware.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";

/* ── Fixture helpers ──────────────────────────────────────────────── */
const PROJECT = "00000000-0000-4000-8000-000000000000";
const TAB = "22222222-2222-4222-8222-222222222222";

function node(type: StoredNode["type"], id: string, properties: Record<string, unknown>): StoredNode {
  return {
    id,
    type,
    projectId: PROJECT,
    positionX: 0,
    positionY: 0,
    homeTabId: TAB,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function edge(kind: StoredEdge["kind"], source: string, target: string, id: string): StoredEdge {
  return {
    id,
    projectId: PROJECT,
    sourceNodeId: source,
    targetNodeId: target,
    kind,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: false },
  };
}

function ctxFor(nodes: StoredNode[], edges: StoredEdge[] = []): EmitterContext {
  return { graph: buildCodeGraph(nodes, edges), target: "nestjs" };
}

const MW_ID = "a1111111-1111-4111-8111-111111111111";
const CTRL_ID = "c2222222-2222-4222-8222-222222222222";
const SVC_ID = "53333333-3333-4333-8333-333333333333";

const AUTH_MIDDLEWARE = node("Middleware", MW_ID, {
  MiddlewareName: "AuthMiddleware",
  Description: "Validates JWT on incoming requests",
  AppliesTo: "SpecificRoutes",
  ExecutionOrder: 0,
  MiddlewareType: "Auth",
  Config: [
    { Key: "tokenHeader", Value: "authorization" },
    { Key: "secretEnv", Value: "JWT_SECRET" },
  ],
});

const AUTH_CONTROLLER = node("Controller", CTRL_ID, {
  ControllerName: "AuthController",
  Description: "Authentication HTTP surface",
  BaseRoute: "auth",
  Endpoints: [],
});

const AUTH_SERVICE = node("Service", SVC_ID, {
  ServiceName: "AuthService",
  Description: "Identity business logic",
  IsTransactionScoped: false,
  Methods: [],
  Dependencies: [],
});

describe("emitMiddleware", () => {
  it("ROUTES_TO ile feature'a dusen tam middleware — snapshot", () => {
    // Middleware -ROUTES_TO-> AuthController -CALLS-> AuthService => feature "auth".
    const ctx = ctxFor(
      [AUTH_MIDDLEWARE, AUTH_CONTROLLER, AUTH_SERVICE],
      [
        edge("ROUTES_TO", MW_ID, CTRL_ID, "e1111111-1111-4111-8111-111111111111"),
        edge("CALLS", CTRL_ID, SVC_ID, "e2222222-2222-4222-8222-222222222222"),
      ],
    );
    const [file] = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { Injectable, type NestMiddleware } from "@nestjs/common";
      import type { NextFunction, Request, Response } from "express";

      /** Validates JWT on incoming requests */
      @Injectable()
      export class AuthMiddleware implements NestMiddleware {
        use(req: Request, res: Response, next: NextFunction): void {
          // @solarch:surgical id=a1111111-1111-4111-8111-111111111111#use
          // Auth middleware: implement the use() body.
          // Scope: applied only to specific routes (SpecificRoutes).
          // Execution order (ExecutionOrder): 0.
          // Wiring hint: for AuthController use configure(consumer).apply(AuthMiddleware).forRoutes(...) (the module phase wires this).
          // Config keys: tokenHeader, secretEnv.
          throw new Error("NOT_IMPLEMENTED: AuthMiddleware.use");
        }
      }
      ",
        "language": "typescript",
        "path": "auth/auth.middleware.ts",
        "surgicalMarkers": 1,
      }
    `);
  });

  it("@Injectable() implements NestMiddleware sinifi + use(req,res,next) imzasi", () => {
    const ctx = ctxFor([AUTH_MIDDLEWARE]);
    const [file] = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx);
    expect(file.content).toContain("@Injectable()");
    expect(file.content).toContain("export class AuthMiddleware implements NestMiddleware {");
    expect(file.content).toContain("use(req: Request, res: Response, next: NextFunction): void {");
  });

  it("NestMiddleware + express tipleri import edilir", () => {
    const ctx = ctxFor([AUTH_MIDDLEWARE]);
    const [file] = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx);
    expect(file.content).toContain('import { Injectable, type NestMiddleware } from "@nestjs/common";');
    expect(file.content).toContain('import type { NextFunction, Request, Response } from "express";');
  });

  it("use() govdesinde surgical marker + NOT_IMPLEMENTED var", () => {
    const ctx = ctxFor([AUTH_MIDDLEWARE]);
    const [file] = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx);
    expect(file.surgicalMarkers).toBe(1);
    expect(file.content).toContain("// @solarch:surgical id=a1111111-1111-4111-8111-111111111111#use");
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: AuthMiddleware.use");');
  });

  it("feature yoksa (cross-cutting / baglantisiz) common/ altina iner", () => {
    // Hic edge yok -> referrerFeatures bos -> pickFeature null -> "common".
    const ctx = ctxFor([AUTH_MIDDLEWARE]);
    const [file] = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx);
    expect(file.path).toBe("common/auth.middleware.ts");
  });

  it("filePathFor kullanir: feature'a dustugunde <feature>/<base>.middleware.ts", () => {
    const ctx = ctxFor(
      [AUTH_MIDDLEWARE, AUTH_CONTROLLER, AUTH_SERVICE],
      [
        edge("ROUTES_TO", MW_ID, CTRL_ID, "e1111111-1111-4111-8111-111111111111"),
        edge("CALLS", CTRL_ID, SVC_ID, "e2222222-2222-4222-8222-222222222222"),
      ],
    );
    const [file] = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx);
    expect(file.path).toBe("auth/auth.middleware.ts");
    // Dosya kok adi baseNameOf(AuthMiddleware) = "Auth" -> kebab "auth".
    expect(file.path).not.toContain("auth-middleware.middleware");
  });

  it("ROUTES_TO Controller adi uygulanis ipucu olarak markera girer", () => {
    const ctx = ctxFor(
      [AUTH_MIDDLEWARE, AUTH_CONTROLLER, AUTH_SERVICE],
      [
        edge("ROUTES_TO", MW_ID, CTRL_ID, "e1111111-1111-4111-8111-111111111111"),
        edge("CALLS", CTRL_ID, SVC_ID, "e2222222-2222-4222-8222-222222222222"),
      ],
    );
    const [file] = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx);
    expect(file.content).toContain(
      "// Wiring hint: for AuthController use configure(consumer).apply(AuthMiddleware).forRoutes(...) (the module phase wires this).",
    );
  });

  it("Config: yalniz Key'ler markera girer, gizli Value ASLA gomulmez", () => {
    const ctx = ctxFor([AUTH_MIDDLEWARE]);
    const [file] = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx);
    expect(file.content).toContain("// Config keys: tokenHeader, secretEnv.");
    // Degerler (authorization / JWT_SECRET) icerige SIZMAMALI.
    expect(file.content).not.toContain("authorization");
    expect(file.content).not.toContain("JWT_SECRET");
  });

  it("Global AppliesTo + Config'siz minimal middleware", () => {
    const minimal = node("Middleware", MW_ID, {
      MiddlewareName: "LoggingMiddleware",
      Description: "Logs requests",
      AppliesTo: "Global",
      ExecutionOrder: 5,
      Config: [],
    });
    const ctx = ctxFor([minimal]);
    const [file] = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx);
    expect(file.content).toContain("export class LoggingMiddleware implements NestMiddleware {");
    expect(file.content).toContain("// Scope: applied to all routes (Global).");
    expect(file.content).toContain("// Execution order (ExecutionOrder): 5.");
    // MiddlewareType yoksa tur oneki olmadan "middleware use() ..." satiri.
    expect(file.content).toContain("// middleware: implement the use() body.");
    // Config bos -> "Config keys" satiri yok.
    expect(file.content).not.toContain("Config keys");
  });

  it("content ends with single newline", () => {
    const ctx = ctxFor([AUTH_MIDDLEWARE]);
    const [file] = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMINISM: same graph twice -> byte-identical", () => {
    const ctx = ctxFor(
      [AUTH_MIDDLEWARE, AUTH_CONTROLLER, AUTH_SERVICE],
      [
        edge("ROUTES_TO", MW_ID, CTRL_ID, "e1111111-1111-4111-8111-111111111111"),
        edge("CALLS", CTRL_ID, SVC_ID, "e2222222-2222-4222-8222-222222222222"),
      ],
    );
    const a = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx)[0].content;
    const b = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx)[0].content;
    expect(a).toBe(b);
  });

  it("kind adiyla bitmeyen / bos'a dusmeyen ad korunur (rol eki adin TAMAMIYSA)", () => {
    // "Middleware" -> baseNameOf adin tamami eki -> orijinal ad korunur.
    const odd = node("Middleware", MW_ID, {
      MiddlewareName: "Middleware",
      Description: "kenar durum",
      AppliesTo: "Global",
      ExecutionOrder: 0,
      Config: [],
    });
    const ctx = ctxFor([odd]);
    const [file] = emitMiddleware(ctx.graph.byId(MW_ID)!, ctx);
    expect(file.content).toContain("export class Middleware implements NestMiddleware {");
    expect(file.path).toBe("common/middleware.middleware.ts");
  });
});
