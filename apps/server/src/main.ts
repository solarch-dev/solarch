import "reflect-metadata";
// .env dosyasını config/env.ts import'undan ÖNCE yükle (env.ts boot anında parse eder)
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { apiReference } from "@scalar/nestjs-api-reference";
import { cleanupOpenApiDoc, ZodValidationPipe as ZodPipe } from "nestjs-zod";
import { clerkMiddleware } from "@clerk/express";
import { AppModule } from "./app.module";
import { env } from "./config/env";
import { warnMissingEnv } from "./config/env-check";
import { SchemaErrorFilter } from "./common/filters/schema-error.filter";
import { NotFoundFilter } from "./common/filters/not-found.filter";
import { ConflictFilter } from "./common/filters/conflict.filter";
import { InternalFilter } from "./common/filters/internal.filter";
import { UnauthorizedFilter } from "./common/filters/unauthorized.filter";
import { ForbiddenFilter } from "./common/filters/forbidden.filter";
import { PaymentRequiredFilter } from "./common/filters/payment-required.filter";

const API_DESCRIPTION = `
A graph backend that grounds software architecture drawn via natural language / sketch into **strict schema standards** and blocks architectural violations with a **Rules Engine**.

## General Flow

1. **Create a project** — \`POST /projects\`
2. **Add a node** — \`POST /projects/{projectId}/nodes\` (Service, Table, Controller, ...)
3. **Validate a connection** — \`POST /projects/{projectId}/edges/validate\` (Rules Engine pre-check)
4. **Create a connection** — \`POST /projects/{projectId}/edges\` (CALLS, WRITES, ...)
5. **Fetch the whole graph** — \`GET /projects/{projectId}/graph\`

## Response Envelope

All responses use a consistent envelope format:

- **Success:** \`{ "success": true, "data": { ... } }\`
- **Error:** \`{ "success": false, "error": { "code": "ERR_...", "message": "...", "details"?: [...] } }\`

## Key Error Codes

| Code | Meaning |
|-----|--------|
| \`ERR_SCHEMA_INVALID\` | The submitted body does not match the Zod schema (400) |
| \`ERR_PROJECT_NOT_FOUND\` | The project does not exist (404) |
| \`ERR_NODE_NOT_FOUND\` / \`ERR_EDGE_NOT_FOUND\` | The record does not exist (404) |
| \`ERR_NAME_DUPLICATE\` | Duplicate name within the project (409) |
| \`ERR_001..ERR_007\` | Architectural prohibition (Rules blacklist) |
| \`ERR_COND_001\` | Circular dependency |
| \`ERR_NOT_WHITELISTED\` | The connection is not in the allow list (default deny) |

## Architectural Discipline

Any node→edge→node connection that is not explicitly specified is **forbidden by default**. See the \`GET /rules\` catalog for allowed connections.
`;

async function bootstrap() {
  // bodyParser:false → varsayılan 100kb parser'ı kapat; aşağıda tek 1mb parser
  // kuruyoruz (yoksa iki parser zincirlenir, varsayılan limit geçerli kalır).
  // rawBody:true korunur (core appOptions.rawBody'den türetir) → webhook imzası çalışır.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });
  // Reverse proxy (Caddy/nginx) arkasında gerçek istemci IP'sini X-Forwarded-For'dan al
  // → rate-limit IP fallback'i proxy IP'sine değil gerçek IP'ye göre çalışır.
  app.set("trust proxy", 1);
  // Güvenlik başlıkları. CSP kapalı: bu bir JSON API + Scalar docs (inline
  // script/style) sayfası; CSP docs UI'ını kırar, JSON yanıtlarda anlamsız.
  app.use(helmet({ contentSecurityPolicy: false }));
  // Gövde boyut sınırı — sınırsız JSON/batch ile bellek DoS'unu engelle.
  // 1mb: chat history (≤50×8000 char) + büyük graph apply rahat sığar; MB'lık abuse durur.
  app.useBodyParser("json", { limit: "1mb" });
  app.useBodyParser("urlencoded", { limit: "1mb", extended: true });
  app.setGlobalPrefix("api/v1");
  // Cookie tabanlı oturum için credentials zorunlu (Clerk __session). Same-origin
  // proxy'de (dev Vite, prod reverse proxy) CORS zaten devreye girmez.
  app.enableCors({ origin: env.CORS_ORIGIN, credentials: true });
  // Clerk: cookie (__session) veya Authorization Bearer'dan oturumu çözer, req'e
  // ekler. getAuth(req) bu middleware'den sonra kullanılabilir.
  app.use(
    clerkMiddleware({
      authorizedParties: env.CLERK_AUTHORIZED_PARTIES
        ? env.CLERK_AUTHORIZED_PARTIES.split(",").map((s) => s.trim())
        : undefined,
    }),
  );
  // Eksik env değerlerini tek tek raporla (hangi özellik neden çalışmaz).
  warnMissingEnv();
  // nestjs-zod global pipe — DTO class'ından otomatik Zod schema alır,
  // Swagger Module DTO metadata'sını da bu pipe ile tanır.
  app.useGlobalPipes(new ZodPipe());
  app.useGlobalFilters(
    new InternalFilter(),
    new UnauthorizedFilter(),
    new ForbiddenFilter(),
    new PaymentRequiredFilter(),
    new ConflictFilter(),
    new NotFoundFilter(),
    new SchemaErrorFilter(),
  );

  // OpenAPI + Scalar yalnızca dev/test — production'da tam API yüzeyi sızdırılmasın.
  if (env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("Solarch Backend API")
      .setDescription(API_DESCRIPTION)
      .setVersion("0.1.0")
      .addServer(`http://localhost:${env.PORT}`, "Local development")
      .addTag("Projects", "Architecture project (workspace) management. Each project contains an architecture graph — nodes and edges belong to a project. The project must exist before creating nodes/edges (strict integrity).")
      .addTag("Nodes", "The building blocks in a project (Table, Service, Controller, ...) — 21 types. Each node carries a kind (`type`) + kind-specific `properties`. Schema validation is done with Zod.")
      .addTag("Node Types", "Node type catalog (read-only). Which types exist, each one's JSON Schema and architecture rules. Feeds the frontend forms from this endpoint.")
      .addTag("Edges", "Directed connections between nodes (CALLS, WRITES, PUBLISHES, ...) — 16 types. The Rules Engine applies when each edge is created; architectural violations are rejected.")
      .addTag("Edge Types", "Edge type catalog (read-only). Each connection type's direction, meaning, example source/target and rules.")
      .addTag("Rules", "Architecture Rules Engine. A catalog of allowed (whitelist), forbidden (blacklist: ERR_001..007) and conditional (circular dependency, type mismatch, empty schema) rules.")
      .addTag("Health", "Service health check (liveness/readiness).")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    const cleanDoc = cleanupOpenApiDoc(document);
    inlineAllRefs(cleanDoc);
    if (cleanDoc.components) cleanDoc.components.schemas = {};

    app.use("/api/v1/openapi.json", (_req: unknown, res: any) => {
      res.json(cleanDoc);
    });
    app.use(
      "/api/v1/docs",
      apiReference({
        content: cleanDoc,
        theme: "purple",
      }),
    );
  }

  // SIGTERM/SIGINT'te Nest onModuleDestroy zinciri çalışsın (Neo4j driver.close) +
  // HTTP server graceful kapansın. Manuel sinyal handler GEREKMEZ.
  app.enableShutdownHooks();

  // Bind to env.HOST (default 127.0.0.1): on a single box only the local reverse proxy
  // (Caddy) reaches the backend; all traffic is single-origin. In Docker, HOST=0.0.0.0
  // so the proxy container can reach server:PORT (the port is never published to the host).
  await app.listen(env.PORT, env.HOST);
  console.log(`solarch-backend listening on http://${env.HOST}:${env.PORT}`);
  if (env.NODE_ENV !== "production") {
    console.log(`API docs (Scalar): http://127.0.0.1:${env.PORT}/api/v1/docs`);
  }
}

bootstrap();

/** OpenAPI document'inde her $ref'i resolve edip inline schema ile değiştirir.
 *  Scalar Models paneli boş kalsın diye components.schemas'ı sonra
 *  güvenle silebiliriz. */
function inlineAllRefs(doc: any): void {
  const schemas = doc.components?.schemas ?? {};
  const resolve = (ref: string): unknown => {
    // "#/components/schemas/CreateNodeDto" -> "CreateNodeDto"
    const name = ref.replace("#/components/schemas/", "");
    return schemas[name];
  };
  const visit = (node: unknown, seen = new WeakSet()): unknown => {
    if (!node || typeof node !== "object") return node;
    if (seen.has(node as object)) return node;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = visit(node[i], seen);
      return node;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === "string") {
      const resolved = resolve(obj.$ref);
      if (resolved && typeof resolved === "object") {
        delete obj.$ref;
        Object.assign(obj, JSON.parse(JSON.stringify(resolved)));
        return visit(obj, seen);
      }
    }
    for (const k of Object.keys(obj)) obj[k] = visit(obj[k], seen);
    return obj;
  };
  if (doc.paths) visit(doc.paths);
}
