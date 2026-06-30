import type { GeneratedFile, NodeEmitter } from "../../types";
import type { CodeGraph, CodeNode } from "../../ir";
import {
  camelCase,
  filePathFor,
  importPathOf,
  pascalCase,
  relativeImportPath,
} from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers, notImplemented, surgicalMarker } from "../../surgical";
import type { APIGatewayNode } from "../../../nodes/schemas/api-gateway.schema";

/* ────────────────────────────────────────────────────────────────────────
 * api-gateway.emitter.ts — APIGatewayNode -> <feature>/<base>.gateway.ts.
 *
 * MİMARİ KARAR (B2): Bir API Gateway, arkadaki provider'lara yönlendiren bir HTTP
 * GİRİŞ KATMANIDIR. Bunu GERÇEK bir NestJS @Controller olarak emit ediyoruz —
 * önceki @Injectable() gateway HİÇBİR feature module'e bağlanmıyordu (ölü kod) +
 * constructor'da Controller enjekte ediyordu (anti-pattern). Artık:
 *   - @Controller() sınıfı: her route bir HTTP dekoratörlü (@Get/@Post/...) metot
 *     olur -> NestJS routing'i otomatik bağlar (orphan KALMAZ; ir.ts feature-
 *     inference gateway'i feature'ın @Module.controllers'ına koyar).
 *   - DI YALNIZ Service'leri alır (Controller DEĞİL — anti-pattern düzeltildi).
 *     Hedefler: Routes[].TargetRef (Service) ∪ ROUTES_TO/CALLS edge'leri (Service).
 *     Bir route Controller'a işaret ediyorsa enjekte EDİLMEZ (controller'a HTTP ile
 *     gidilir, DI ile değil); metot yine üretilir, marker'da not bırakılır.
 *
 * Şema (api-gateway.schema.ts) ile birebir property isimleri:
 *   GatewayName, Description, Provider, AuthMode?, CorsEnabled?,
 *   Routes: { Path, TargetRef (→ Controller|Service Name), Methods[],
 *            AuthRequired, RateLimit? { Requests, WindowSeconds } }[]
 *
 * SAF + DETERMİNİSTİK: koleksiyonlar sıralı, kayıp ref tolere edilir (THROW yok),
 * import'lar ImportCollector ile, timestamp/random yok, içerik tek "\n" ile biter.
 * ──────────────────────────────────────────────────────────────────────── */

type GatewayProps = APIGatewayNode["properties"];
type GatewayRoute = GatewayProps["Routes"][number];

/** Bu gateway'in DI ile aldığı, çözülmüş bir Service hedefi. */
interface ResolvedService {
  /** constructor `this.<field>` */
  field: string;
  /** enjekte edilen sınıf adı (pascalCase(name)) */
  className: string;
  /** çözülen Service'in adı (route eşleştirme için) */
  name: string;
}

const HTTP_DECORATOR: Record<string, string> = {
  GET: "Get",
  POST: "Post",
  PUT: "Put",
  DELETE: "Delete",
  PATCH: "Patch",
};

export const emitApiGateway: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  // APIGateway PropsByKind içinde DEĞİL -> propsOf KULLANILAMAZ; properties'i
  // şema tipine cast et (DB zaten Zod-doğrulanmış; çalışma zamanı dönüşümü yok).
  const props = node.properties as GatewayProps;
  const graph = ctx.graph;
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, graph);

  const imports = new ImportCollector();
  imports.add("Controller", "@nestjs/common");

  // ── Routes: şema sırasını KORU (kullanıcı niyeti) ama metot adı çakışmasını
  //    deterministik tekilleştir. Her route bir HTTP-dekoratörlü metot üretir. ──
  const routes = props.Routes ?? [];

  // ── DI hedefleri: SADECE Service'ler (Controller anti-pattern -> hariç).
  //    Routes[].TargetRef ∪ ROUTES_TO ∪ CALLS. DEDUP + isme göre sıralı. ──
  const services = collectServiceTargets(node, routes, graph, filePath, imports);

  // ── Metot adı tekilleştirme sayacı (aynı isim -> "2", "3" ...). ──
  const usedNames = new Map<string, number>();
  const methodBlocks: string[] = [];
  for (const route of routes) {
    methodBlocks.push(renderRoute(node, className, route, services, imports, usedNames));
  }

  // ── Sınıf gövdesi ──
  const lines: string[] = [];
  lines.push(gatewayDocComment(props));
  // @Controller() — base prefix YOK; her route Path'ini olduğu gibi taşır
  //   (Path'ler şemada tam yoldur; çift prefix riski olmasın).
  lines.push("@Controller()");
  lines.push(`export class ${className} {`);

  if (services.length > 0) {
    lines.push("  constructor(");
    for (const s of services) {
      lines.push(`    private readonly ${s.field}: ${s.className},`);
    }
    lines.push("  ) {}");
    if (methodBlocks.length > 0) lines.push("");
  }

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

/* ── DI hedeflerini topla (SADECE Service) ───────────────────────────────── */

/** Routes[].TargetRef (Service) ∪ ROUTES_TO/CALLS edge hedeflerinden (Service)
 *  DEDUP + isme göre sıralı ResolvedService listesi. Controller hedefleri DI'a
 *  ALINMAZ (anti-pattern); kayıp ref'ler atlanır. ASLA throw etmez. */
function collectServiceTargets(
  node: CodeNode,
  routes: readonly GatewayRoute[],
  graph: CodeGraph,
  filePath: string,
  imports: ImportCollector,
): ResolvedService[] {
  const byId = new Map<string, CodeNode>();

  // (1) Routes[].TargetRef -> Service (Controller ise atla).
  for (const r of routes) {
    const resolved = graph.resolveRef("Service", r.TargetRef);
    if (resolved) byId.set(resolved.id, resolved);
  }
  // (2) ROUTES_TO edge hedefleri (yalnız Service).
  for (const e of graph.outEdges(node.id, "ROUTES_TO")) {
    const tgt = graph.byId(e.targetNodeId);
    if (tgt && tgt.kindOf() === "Service") byId.set(tgt.id, tgt);
  }
  // (3) CALLS edge hedefleri (yalnız Service).
  for (const e of graph.outEdges(node.id, "CALLS")) {
    const tgt = graph.byId(e.targetNodeId);
    if (tgt && tgt.kindOf() === "Service") byId.set(tgt.id, tgt);
  }

  const resolved = [...byId.values()].sort(byNameThenId).map<ResolvedService>((t) => ({
    field: camelCase(t.name),
    className: pascalCase(t.name),
    name: t.name,
  }));

  for (const t of [...byId.values()].sort(byNameThenId)) {
    imports.add(pascalCase(t.name), importPathOf(relativeImportPath(filePath, filePathFor(t, graph))));
  }
  return resolved;
}

/* ── Tek route -> HTTP-dekoratörlü metot ──────────────────────────────────── */

/** Bir route'u @Get/@Post/... dekoratörlü, surgical-marker'lı bir metoda çevirir.
 *  TargetRef bir Service'e çözülürse delegasyon ipucu (this.<field>) marker'da. */
function renderRoute(
  node: CodeNode,
  className: string,
  route: GatewayRoute,
  services: ResolvedService[],
  imports: ImportCollector,
  usedNames: Map<string, number>,
): string {
  const indent = "  ";
  const methodName = uniqueName(deriveRouteMethodName(route), usedNames);

  // HTTP fiili dekoratörü (ilk method) + route path.
  const verb = (route.Methods[0] ?? "GET").toUpperCase();
  const httpDecorator = HTTP_DECORATOR[verb] ?? "Get";
  imports.add(httpDecorator, "@nestjs/common");
  const routeArg = methodRouteArg(route.Path);

  // Çözülen Service field'ı (DI listesinde camelCase(TargetRef) ile eşleşir).
  const targetField = camelCase(route.TargetRef);
  const delegate = services.find((s) => s.field === targetField);

  // ── Marker açıklaması: route özeti + delegasyon + auth/rate-limit ipuçları. ──
  const descParts: string[] = [];
  descParts.push(`${route.Methods.join("/")} ${route.Path} -> ${route.TargetRef}`);
  if (delegate) {
    descParts.push(`Delegation hint: this.${delegate.field}.<?>(...).`);
  } else {
    descParts.push(`TODO: target "${route.TargetRef}" did not resolve to a Service (Controller targets are not injected via DI).`);
  }
  if (route.AuthRequired) {
    descParts.push("Requires auth (AuthRequired=true).");
  }
  if (route.RateLimit) {
    descParts.push(
      `Rate limit: ${route.RateLimit.Requests} requests / ${route.RateLimit.WindowSeconds}s.`,
    );
  }

  const marker = surgicalMarker({
    nodeId: node.id,
    member: methodName,
    description: descParts.join("\n"),
    deps: delegate ? [`this.${delegate.field}`] : undefined,
  });

  const lines: string[] = [];
  lines.push(`${indent}@${httpDecorator}(${routeArg})`);
  lines.push(`${indent}async ${methodName}(): Promise<unknown> {`);
  for (const ml of marker.split("\n")) lines.push(`${indent}${indent}${ml}`);
  lines.push(`${indent}${indent}${notImplemented(className, methodName)}`);
  lines.push(`${indent}}`);
  return lines.join("\n");
}

/* ── İsim/yardımcılar (DETERMİNİSTİK) ─────────────────────────────────────── */

/** Gateway sınıfı doc-comment'i: Description + Provider/Auth/CORS özeti. */
function gatewayDocComment(props: GatewayProps): string {
  const lines: string[] = ["/**"];
  if (props.Description) lines.push(` * ${props.Description}`);
  lines.push(` * API Gateway (Provider: ${props.Provider}).`);
  if (props.AuthMode) lines.push(` * Auth: ${props.AuthMode}.`);
  if (props.CorsEnabled !== undefined) lines.push(` * CORS: ${props.CorsEnabled ? "enabled" : "disabled"}.`);
  lines.push(" */");
  return lines.join("\n");
}

/** Route metot adı: ilk HTTP fiili + Path segmentleri (literal -> Pascal;
 *  ":param"/"{param}" -> "By Param"). Boş -> "dispatch". Örn:
 *  GET /users/:id -> "dispatchGetUsersById". */
function deriveRouteMethodName(route: GatewayRoute): string {
  const verb = (route.Methods[0] ?? "GET").toLowerCase();
  const segments = route.Path.split("/").filter((s) => s.length > 0);
  const words: string[] = ["dispatch", cap(verb)];
  for (const seg of segments) {
    if (seg.startsWith(":")) {
      words.push("By", ...splitSeg(seg.slice(1)));
    } else if (seg.startsWith("{") && seg.endsWith("}")) {
      words.push("By", ...splitSeg(seg.slice(1, -1)));
    } else {
      words.push(...splitSeg(seg));
    }
  }
  const name = words.join("");
  return name.length > 0 ? name : "dispatch";
}

/** @Get/@Post(...) route argümanı. ":id"/"{id}" -> ":id" Nest biçimi; baş/son
 *  "/" temizlenir. Kök ("/" veya boş) -> argümansız. */
function methodRouteArg(path: string): string {
  const norm = path
    .split("/")
    .filter((s) => s.length > 0)
    .map((seg) => (seg.startsWith("{") && seg.endsWith("}") ? `:${seg.slice(1, -1)}` : seg))
    .join("/");
  return norm.length > 0 ? JSON.stringify(norm) : "";
}

/** Bir path segmentini Pascal kelimelere böler (camelCase/kebab/snake destekli).
 *  Wildcard "*" -> "All" (route "/api/auth/*" -> "...ApiAuthAll"); identifier-DIŞI
 *  her karakter (*, +, vb.) AYRAÇ sayılır -> metot adına SIZMAZ. Aksi halde
 *  "dispatchGetApiAuth*" gibi GEÇERSİZ TS identifier'ı (TS1434/TS1003) üretilirdi. */
function splitSeg(seg: string): string[] {
  return seg
    .replace(/\*/g, " All ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0)
    .map(cap);
}

/** Aynı isim ikinci kez gelirse "2", "3" ... ekleyerek tekilleştirir
 *  (deterministik: route sırası korunur). */
function uniqueName(base: string, used: Map<string, number>): string {
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}${count + 1}`;
}

function cap(w: string): string {
  return w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase();
}

function byNameThenId(a: CodeNode, b: CodeNode): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
