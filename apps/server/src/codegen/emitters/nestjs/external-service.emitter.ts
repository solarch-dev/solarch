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
 * Bir dış HTTP servisini saran @Injectable() NestJS HTTP istemcisi üretir:
 *   - DI: HttpService (@nestjs/axios) + ConfigService (@nestjs/config).
 *     HttpModule + ConfigModule module tarafından (Wire fazı) bağlanır.
 *   - Konfig: BaseURL ve TimeoutSeconds ConfigService'ten env-var binding ile
 *     okunur (raw secret YOK). AuthType != "None" -> authHeaders() helper'ı
 *     bir Bearer/Basic/API_Key başlığını ENV değişkeninden bağlar (label).
 *   - Metotlar: schema'daki Endpoints (varsa) her biri için bir metot
 *     (HTTP fiili + path); yoksa tek generic `request<T>` metodu. Her metot
 *     gövdesi surgicalMarker + notImplemented + erişilebilir bağımlılık ipucu
 *     (this.http / this.baseUrl ...).
 *
 * SAF + DETERMİNİSTİK: Endpoints Name'e göre sıralı, import'lar ImportCollector
 * ile, timestamp/random yok, içerik tek "\n" ile biter.
 * ──────────────────────────────────────────────────────────────────────── */

/** ExternalService props — PropsByKind (ir.ts) bu kind'ı içermez (backend
 *  zinciri 9 tipi taşır); tip doğrudan Zod-inferred schema'dan alınır. */
type ExtProps = ExternalServiceNode["properties"];
type ExtEndpoint = ExtProps["Endpoints"][number];

/** node.properties'i tipli ExternalService props'a daraltır (DB zaten
 *  Zod-doğrulanmış; çalışma zamanı dönüşümü yok). */
function extPropsOf(node: CodeNode): ExtProps {
  return node.properties as ExtProps;
}

/** HTTP fiili -> HttpService metot adı (this.http.<verb>). */
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
  // Env-var binding önekleri (SCREAMING_SNAKE) — raw secret/URL gömülmez.
  const envPrefix = snakeCase(node.name).toUpperCase();

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");
  imports.add("HttpService", "@nestjs/axios");
  imports.add("ConfigService", "@nestjs/config");

  const authType = props.AuthType ?? "None";
  const needsAuth = authType !== "None";

  // ── Metot blokları: Endpoints (Name'e göre sıralı) ya da generic request ──
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

  // ── Sınıf gövdesi ──
  const lines: string[] = [];
  // Anlamlı açıklama varsa (trim >=3 char) JSDoc bas; tek-harf/boş gürültüyü atla.
  if (isMeaningfulDoc(props.Description)) lines.push(`/** ${props.Description!.trim()} */`);
  lines.push("@Injectable()");
  lines.push(`export class ${className} {`);

  // Konfig alanları (env-var binding ile çözülür — raw değer gömülmez).
  //   ATAMA constructor GÖVDESİNDE yapılır: alan başlatıcıları (field initializer)
  //   constructor gövdesinden ÖNCE çalışır; bu yüzden `this.config`'i bir alan
  //   başlatıcısında okumak TS2729 ("used before its initialization") + çalışma
  //   zamanı `undefined` verir. Param-property atamaları gövde başında olduğundan
  //   atamayı gövdeye taşırız.
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

/** Bir schema Endpoint'ini (HTTP fiili + path) bir istemci metoduna çevirir.
 *  Metot adı: camelCase(Name). Gövde = surgical marker + notImplemented;
 *  marker erişilebilir bağımlılık (this.http.<verb>, this.baseUrl) ipucu verir. */
function renderEndpointMethod(
  node: CodeNode,
  className: string,
  ep: ExtEndpoint,
  needsAuth: boolean,
): string {
  const indent = "  ";
  const methodName = camelCase(ep.Name);
  const verb = HTTP_VERB[ep.Method] ?? "request";

  // AuthType != "None" ise authHeaders() helper'ı ÜRETİLİR; bu yüzden onu
  //   request'te çağırmayı surgical AI'ye AÇIKÇA hatırlat (aksi halde helper
  //   çağrılmadan kalır -> noUnusedLocals/ESLint uyarısı).
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

/** Endpoint tanımlı değilse: tek generic request metodu. */
function renderGenericRequest(node: CodeNode, className: string, needsAuth: boolean): string {
  const indent = "  ";
  // AuthType != "None" ise authHeaders() ÜRETİLİR -> request'te çağrılmalı.
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

/** AuthType != "None" için bir auth-header helper'ı. SECRET değer ASLA gömülmez —
 *  ENV değişkeni binding'i (label) üzerinden okunur; gövde surgical. */
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

/** Deterministik string karşılaştırması. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Bir Description'ın anlamlı bir JSDoc'a değip değmediği: trim sonrası >=3 char.
 *  Tek-harf/boş açıklamalar JSDoc gürültüsü; atlanır. */
function isMeaningfulDoc(desc: string | undefined): boolean {
  return typeof desc === "string" && desc.trim().length >= 3;
}
