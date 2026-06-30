import "reflect-metadata";
// Load .env file FIRST from config/env.ts import (env.ts parses at boot time)
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { apiReference } from "@scalar/nestjs-api-reference";
import { cleanupOpenApiDoc, ZodValidationPipe as ZodPipe } from "nestjs-zod";
import { AppModule } from "./app.module";
import { env } from "./config/env";
import { warnMissingEnv } from "./config/env-check";
import { SchemaErrorFilter } from "./common/filters/schema-error.filter";
import { NotFoundFilter } from "./common/filters/not-found.filter";
import { ConflictFilter } from "./common/filters/conflict.filter";
import { InternalFilter } from "./common/filters/internal.filter";
import { UnauthorizedFilter } from "./common/filters/unauthorized.filter";
import { ForbiddenFilter } from "./common/filters/forbidden.filter";
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
// bodyParser:false → close default 100kb parser; below is single 1mb parser
// we set up (otherwise the two parsers will be chained, the default limit remains valid).
// rawBody:true is preserved (derives from core appOptions.rawBody) → webhook signature works.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });
// Get real client IP from X-Forwarded-For behind reverse proxy (Caddy/nginx)
// → rate-limit IP fallback works based on the real IP, not the proxy IP.
  app.set("trust proxy", 1);
// Security headers. CSP off: it's a JSON API + Scalar docs (inline
// script/style) page; It breaks the CSP docs UI, JSON is meaningless in responses.
  app.use(helmet({ contentSecurityPolicy: false }));
// Body size limit — prevent memory DoS with unlimited JSON/batch.
// 1mb: chat history (≤50×8000 char) + large graph apply fits comfortably; MB abuse stops.
  app.useBodyParser("json", { limit: "1mb" });
  app.useBodyParser("urlencoded", { limit: "1mb", extended: true });
  app.setGlobalPrefix("api/v1");
  app.enableCors({ origin: env.CORS_ORIGIN, credentials: true });
// Report missing env values ​​one by one (which feature does not work and why).
  warnMissingEnv();
// nestjs-zod global pipe — Gets automatic Zod schema from DTO class,
// Swagger Module also recognizes DTO metadata with this pipe.
  app.useGlobalPipes(new ZodPipe());
  app.useGlobalFilters(
    new InternalFilter(),
    new UnauthorizedFilter(),
    new ForbiddenFilter(),
    new ConflictFilter(),
    new NotFoundFilter(),
    new SchemaErrorFilter(),
  );

// OpenAPI + Scalar dev/test only — do not leak full API surface in production.
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

// Run Nest onModuleDestroy chain in SIGTERM/SIGINT (Neo4j driver.close) +
// Let the HTTP server gracefully shut down. NO manual signal handler required.
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

/** Resolves each $ref in the OpenAPI document and replaces it with an inline schema.
* Then add components.schemas so that the Scalar Models panel remains empty.
* we can safely delete it. */
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
