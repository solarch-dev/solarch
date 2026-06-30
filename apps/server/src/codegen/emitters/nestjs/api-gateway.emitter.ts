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
 * ARCHITECTURE DECISION (B2): An API Gateway is an HTTP ENTRY LAYER routing to
 * backend providers. We emit it as a REAL NestJS @Controller — the previous
 * @Injectable() gateway was NEVER wired into any feature module (dead code) +
 * injected Controllers in constructor (anti-pattern). Now:
 *   - @Controller() class: each route becomes an HTTP-decorated (@Get/@Post/...)
 *     method -> NestJS routing wires automatically (no orphan; ir.ts feature
 *     inference puts gateway in feature's @Module.controllers).
 *   - DI takes ONLY Services (NOT Controller — anti-pattern fixed).
 *     Targets: Routes[].TargetRef (Service) ∪ ROUTES_TO/CALLS edges (Service).
 *     If route points to Controller it is NOT injected (HTTP to controller, not DI);
 *     method still generated, note left in marker.
 *
 * Schema (api-gateway.schema.ts) property names verbatim:
 *   GatewayName, Description, Provider, AuthMode?, CorsEnabled?,
 *   Routes: { Path, TargetRef (→ Controller|Service Name), Methods[],
 *            AuthRequired, RateLimit? { Requests, WindowSeconds } }[]
 *
 * PURE + DETERMINISTIC: collections sorted, missing refs tolerated (no THROW),
 * imports via ImportCollector, no timestamp/random, content ends with single "\n".
 * ──────────────────────────────────────────────────────────────────────── */

type GatewayProps = APIGatewayNode["properties"];
type GatewayRoute = GatewayProps["Routes"][number];

/** A resolved Service target this gateway receives via DI. */
interface ResolvedService {
  /** constructor `this.<field>` */
  field: string;
  /** injected class name (pascalCase(name)) */
  className: string;
  /** resolved Service name (for route matching) */
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
  // APIGateway NOT in PropsByKind -> cannot use propsOf; cast properties to
  // schema type (DB already Zod-validated; no runtime transform).
  const props = node.properties as GatewayProps;
  const graph = ctx.graph;
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, graph);

  const imports = new ImportCollector();
  imports.add("Controller", "@nestjs/common");

  // ── Routes: preserve schema order (user intent) but dedupe method names
  //    deterministically. Each route produces one HTTP-decorated method. ──
  const routes = props.Routes ?? [];

  // ── DI targets: ONLY Services (Controller anti-pattern -> excluded).
  //    Routes[].TargetRef ∪ ROUTES_TO ∪ CALLS. DEDUP + sorted by name. ──
  const services = collectServiceTargets(node, routes, graph, filePath, imports);

  // ── Method name dedupe counter (same name -> "2", "3" ...). ──
  const usedNames = new Map<string, number>();
  const methodBlocks: string[] = [];
  for (const route of routes) {
    methodBlocks.push(renderRoute(node, className, route, services, imports, usedNames));
  }

  // ── Class body ──
  const lines: string[] = [];
  lines.push(gatewayDocComment(props));
  // @Controller() — no base prefix; each route carries Path as-is
  //   (Paths are full paths in schema; avoid double prefix risk).
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

/* ── Collect DI targets (Services ONLY) ───────────────────────────────── */

/** DEDUP + name-sorted ResolvedService list from Routes[].TargetRef (Service)
 *  ∪ ROUTES_TO/CALLS edge targets (Service). Controller targets NOT added to DI
 *  (anti-pattern); missing refs skipped. Never throws. */
function collectServiceTargets(
  node: CodeNode,
  routes: readonly GatewayRoute[],
  graph: CodeGraph,
  filePath: string,
  imports: ImportCollector,
): ResolvedService[] {
  const byId = new Map<string, CodeNode>();

  // (1) Routes[].TargetRef -> Service (skip Controller).
  for (const r of routes) {
    const resolved = graph.resolveRef("Service", r.TargetRef);
    if (resolved) byId.set(resolved.id, resolved);
  }
  // (2) ROUTES_TO edge targets (Service only).
  for (const e of graph.outEdges(node.id, "ROUTES_TO")) {
    const tgt = graph.byId(e.targetNodeId);
    if (tgt && tgt.kindOf() === "Service") byId.set(tgt.id, tgt);
  }
  // (3) CALLS edge targets (Service only).
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

/* ── Single route -> HTTP-decorated method ──────────────────────────────────── */

/** Convert one route to @Get/@Post/... decorated method with surgical marker.
 *  When TargetRef resolves to Service, delegation hint (this.<field>) in marker. */
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

  // HTTP verb decorator (first method) + route path.
  const verb = (route.Methods[0] ?? "GET").toUpperCase();
  const httpDecorator = HTTP_DECORATOR[verb] ?? "Get";
  imports.add(httpDecorator, "@nestjs/common");
  const routeArg = methodRouteArg(route.Path);

  // Resolved Service field (matches camelCase(TargetRef) in DI list).
  const targetField = camelCase(route.TargetRef);
  const delegate = services.find((s) => s.field === targetField);

  // ── Marker description: route summary + delegation + auth/rate-limit hints. ──
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

/* ── Naming/helpers (DETERMINISTIC) ─────────────────────────────────────── */

/** Gateway class doc-comment: Description + Provider/Auth/CORS summary. */
function gatewayDocComment(props: GatewayProps): string {
  const lines: string[] = ["/**"];
  if (props.Description) lines.push(` * ${props.Description}`);
  lines.push(` * API Gateway (Provider: ${props.Provider}).`);
  if (props.AuthMode) lines.push(` * Auth: ${props.AuthMode}.`);
  if (props.CorsEnabled !== undefined) lines.push(` * CORS: ${props.CorsEnabled ? "enabled" : "disabled"}.`);
  lines.push(" */");
  return lines.join("\n");
}

/** Route method name: first HTTP verb + Path segments (literal -> Pascal;
 *  ":param"/"{param}" -> "By Param"). Empty -> "dispatch". E.g.
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

/** @Get/@Post(...) route argument. ":id"/"{id}" -> ":id" Nest form; trim leading/trailing
 *  "/". Root ("/" or empty) -> no argument. */
function methodRouteArg(path: string): string {
  const norm = path
    .split("/")
    .filter((s) => s.length > 0)
    .map((seg) => (seg.startsWith("{") && seg.endsWith("}") ? `:${seg.slice(1, -1)}` : seg))
    .join("/");
  return norm.length > 0 ? JSON.stringify(norm) : "";
}

/** Split path segment into Pascal words (camelCase/kebab/snake supported).
 *  Wildcard "*" -> "All" (route "/api/auth/*" -> "...ApiAuthAll"); non-identifier
 *  chars (*, +, etc.) treated as SEPARATORS -> do NOT leak into method name.
 *  Else invalid TS identifier like "dispatchGetApiAuth*" (TS1434/TS1003). */
function splitSeg(seg: string): string[] {
  return seg
    .replace(/\*/g, " All ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0)
    .map(cap);
}

/** When same name appears again append "2", "3" ... (deterministic: route order preserved). */
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
