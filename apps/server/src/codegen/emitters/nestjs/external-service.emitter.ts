import type { GeneratedFile, NodeEmitter } from "../../types";
import type { CodeNode } from "../../ir";
import {
  camelCase,
  filePathFor,
  pascalCase,
  snakeCase,
} from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers, notImplemented, surgicalMarker } from "../../surgical";
import type { ExternalServiceNode } from "../../../nodes/schemas/external-service.schema";

/* ────────────────────────────────────────────────────────────────────────
 * external-service.emitter.ts — ExternalServiceNode -> <feature>/<base>.client.ts.
 *
 * Emits an @Injectable() NestJS HTTP client wrapping an external HTTP service:
 *   - DI: HttpService (@nestjs/axios) + ConfigService (@nestjs/config).
 *     HttpModule + ConfigModule are wired by the module (Wire phase).
 *   - Config: BaseURL and TimeoutSeconds read from ConfigService via env-var binding
 *     (raw secret NONE). AuthType != "None" -> authHeaders() helper binds a
 *     Bearer/Basic/API_Key header from an ENV variable (label).
 *   - Methods: one method per schema Endpoints entry (if any)
 *     (HTTP verb + path); otherwise a single generic `request<T>` method. Each method
 *     body is surgicalMarker + notImplemented + accessible dependency hint
 *     (this.http / this.baseUrl ...).
 *
 * PURE + DETERMINISTIC: Endpoints sorted by Name, imports via ImportCollector,
 * no timestamp/random, content ends with single "\n".
 * ──────────────────────────────────────────────────────────────────────── */

/** ExternalService props — PropsByKind (ir.ts) does not include this kind (backend
 *  chain carries 9 types); type comes directly from Zod-inferred schema. */
type ExtProps = ExternalServiceNode["properties"];
type ExtEndpoint = ExtProps["Endpoints"][number];

/** Narrow node.properties to typed ExternalService props (DB is already
 *  Zod-validated; no runtime conversion). */
function extPropsOf(node: CodeNode): ExtProps {
  return node.properties as ExtProps;
}

/** HTTP verb -> HttpService method name (this.http.<verb>). */
const HTTP_VERB: Record<string, string> = {
  GET: "get",
  POST: "post",
  PUT: "put",
  DELETE: "delete",
  PATCH: "patch",
};

export const emitExternalService: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = extPropsOf(node);
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, ctx.graph);
  // Env-var binding prefixes (SCREAMING_SNAKE) — no raw secret/URL embedded.
  const envPrefix = snakeCase(node.name).toUpperCase();

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");
  imports.add("HttpService", "@nestjs/axios");
  imports.add("ConfigService", "@nestjs/config");

  const authType = props.AuthType ?? "None";
  const needsAuth = authType !== "None";

  // ── Method blocks: Endpoints (sorted by Name) or generic request ──
  const methodBlocks: string[] = [];
  const endpoints = [...(props.Endpoints ?? [])].sort((a, b) => cmp(a.Name, b.Name));
  if (endpoints.length > 0) {
    for (const ep of endpoints) {
      methodBlocks.push(renderEndpointMethod(node, className, ep, needsAuth));
    }
  } else {
    methodBlocks.push(renderGenericRequest(node, className, needsAuth));
  }
  if (needsAuth) {
    methodBlocks.push(renderAuthHeaders(node, className, authType, envPrefix));
  }

  // ── Class body ──
  const lines: string[] = [];
  // Emit JSDoc when Description is meaningful (trim >=3 char); skip single-letter/empty noise.
  if (isMeaningfulDoc(props.Description)) lines.push(`/** ${props.Description!.trim()} */`);
  lines.push("@Injectable()");
  lines.push(`export class ${className} {`);

  // Config fields (resolved via env-var binding — no raw values embedded).
  //   ASSIGN in constructor BODY: field initializers run BEFORE constructor body;
  //   reading `this.config` in a field initializer causes TS2729 ("used before its
  //   initialization") + runtime `undefined`. Param-property assignments run at body
  //   start, so we move assignments into the body.
  lines.push("  private readonly baseUrl: string;");
  lines.push("  private readonly timeoutMs: number;");
  lines.push("");

  lines.push("  constructor(");
  lines.push("    private readonly http: HttpService,");
  lines.push("    private readonly config: ConfigService,");
  lines.push("  ) {");
  lines.push(`    this.baseUrl = this.config.get<string>(${JSON.stringify(`${envPrefix}_BASE_URL`)}) ?? "";`);
  lines.push(`    this.timeoutMs = (this.config.get<number>(${JSON.stringify(`${envPrefix}_TIMEOUT_SECONDS`)}) ?? ${props.TimeoutSeconds}) * 1000;`);
  lines.push("  }");

  if (methodBlocks.length > 0) lines.push("");
  methodBlocks.forEach((block, i) => {
    lines.push(block);
    if (i < methodBlocks.length - 1) lines.push("");
  });

  lines.push("}");

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  const file: GeneratedFile = {
    path: filePath,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
};

/** Convert a schema Endpoint (HTTP verb + path) into a client method.
 *  Method name: camelCase(Name). Body = surgical marker + notImplemented;
 *  marker hints accessible dependencies (this.http.<verb>, this.baseUrl). */
function renderEndpointMethod(
  node: CodeNode,
  className: string,
  ep: ExtEndpoint,
  needsAuth: boolean,
): string {
  const indent = "  ";
  const methodName = camelCase(ep.Name);
  const verb = HTTP_VERB[ep.Method] ?? "request";

  // When AuthType != "None", authHeaders() helper IS emitted; explicitly remind
  //   surgical AI to call it in the request (otherwise helper stays unused ->
  //   noUnusedLocals/ESLint warning).
  const deps = [`this.http.${verb}`, "this.baseUrl", "this.timeoutMs"];
  if (needsAuth) deps.push("this.authHeaders()");
  const marker = surgicalMarker({
    nodeId: node.id,
    member: methodName,
    description: needsAuth
      ? `${ep.Method} ${ep.Path} — external service call. Call this.authHeaders() for the headers.`
      : `${ep.Method} ${ep.Path} — external service call.`,
    deps,
  });

  const lines: string[] = [];
  lines.push(`${indent}async ${methodName}(payload?: unknown): Promise<unknown> {`);
  for (const ml of marker.split("\n")) lines.push(`${indent}${indent}${ml}`);
  lines.push(`${indent}${indent}// ${JSON.stringify(`${ep.Path}`)} -> this.http.${verb}(this.baseUrl + ${JSON.stringify(ep.Path)})`);
  lines.push(`${indent}${indent}${notImplemented(className, methodName)}`);
  lines.push(`${indent}}`);
  return lines.join("\n");
}

/** When no Endpoints defined: single generic request method. */
function renderGenericRequest(node: CodeNode, className: string, needsAuth: boolean): string {
  const indent = "  ";
  // When AuthType != "None", authHeaders() IS emitted -> must be called in request.
  const deps = ["this.http.request", "this.baseUrl", "this.timeoutMs"];
  if (needsAuth) deps.push("this.authHeaders()");
  const marker = surgicalMarker({
    nodeId: node.id,
    member: "request",
    description: needsAuth
      ? "Generic external service HTTP call (no endpoint defined). Call this.authHeaders() for the headers."
      : "Generic external service HTTP call (no endpoint defined).",
    deps,
  });

  const lines: string[] = [];
  lines.push(`${indent}async request<T = unknown>(method: string, path: string, payload?: unknown): Promise<T> {`);
  for (const ml of marker.split("\n")) lines.push(`${indent}${indent}${ml}`);
  lines.push(`${indent}${indent}${notImplemented(className, "request")}`);
  lines.push(`${indent}}`);
  return lines.join("\n");
}

/** Auth header helper for AuthType != "None". SECRET value NEVER embedded —
 *  read via ENV variable binding (label); body is surgical. */
function renderAuthHeaders(
  node: CodeNode,
  className: string,
  authType: string,
  envPrefix: string,
): string {
  const indent = "  ";
  const envKey = authType === "API_Key" ? `${envPrefix}_API_KEY` : `${envPrefix}_AUTH_TOKEN`;
  const marker = surgicalMarker({
    nodeId: node.id,
    member: "authHeaders",
    description: `${authType} authentication headers (the secret is bound via ENV ${envKey}, never embedded in code).`,
    deps: ["this.config"],
  });

  const lines: string[] = [];
  lines.push(`${indent}private authHeaders(): Record<string, string> {`);
  for (const ml of marker.split("\n")) lines.push(`${indent}${indent}${ml}`);
  lines.push(`${indent}${indent}// secret = this.config.get<string>(${JSON.stringify(envKey)});  // ENV binding — no raw secret`);
  lines.push(`${indent}${indent}${notImplemented(className, "authHeaders")}`);
  lines.push(`${indent}}`);
  return lines.join("\n");
}

/** Deterministic string comparison. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whether a Description warrants a meaningful JSDoc: trim length >=3 char.
 *  Single-letter/empty descriptions are JSDoc noise; skipped. */
function isMeaningfulDoc(desc: string | undefined): boolean {
  return typeof desc === "string" && desc.trim().length >= 3;
}
