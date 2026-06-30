import type { EmitterContext, GeneratedFile, NodeEmitter } from "../../types";
import type { CodeGraph, CodeNode } from "../../ir";
import { filePathFor, pascalCase } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";
import type { NodeKind } from "../../../nodes/schemas";

/* ────────────────────────────────────────────────────────────────────────
 * stub.emitter.ts — MINIMAL stub emitter for out-of-scope nodes.
 *
 * @deprecated NOT TRIGGERED IN REAL PRODUCTION. EMITTER_REGISTRY (index.ts)
 *   does not include this emitter at all; no registry entry routes a node to stub.
 *   This is a legacy fallback only invoked via direct/test calls (stub.emitter.spec.ts).
 *
 * WHY THIS IS NOW A DEAD PATH: types once outside the v1 backend chain
 *   (Cache, MessageQueue, Worker, APIGateway, EventHandler, Orchestrator,
 *   ExternalService, Middleware, View) used to fall through to this emitter. Now ALL
 *   have full emitters (registry supported: true) -> they never hit stub.
 *   Only three out-of-scope types remain and they also do NOT produce stubs:
 *     - FrontendApp / UIComponent -> EXCLUDED_KINDS (not in registry);
 *       codegen.service isExcluded counts them in skippedKinds without generating FILES.
 *     - EnvironmentVariable -> not in registry; represents scaffold config,
 *       not a code module; again no file is generated.
 *   Net: zero nodes flow to this emitter in live codegen today.
 *
 * Behavior (when called directly) is still correct and tested; leaves a minimal
 * skeleton file so the node is NOT SILENTLY DROPPED; records its place in the graph
 * (in/out edge summary) and leaves a Surgical AI marker point.
 *
 * Contract:
 *   - no default export; named `export const emitStub: NodeEmitter`.
 *   - PURE function: (node, ctx) -> GeneratedFile[]. No I/O, no throw.
 *   - Path always via filePathFor(node, ctx.graph) (hardcode FORBIDDEN).
 *   - Content DETERMINISTIC: edge summary sorted by name, no timestamp/random.
 *   - imports via ImportCollector; content ends with single "\n".
 *
 * NOTE: stubbed types are NOT in PropsByKind — propsOf<...> CANNOT be used.
 * Only safe fields: node.name (resolved by ir) + generic Description.
 * ──────────────────────────────────────────────────────────────────────── */

/** Stub kinds injectable into Service via DI.
 *  @deprecated EFFECTIVELY EMPTY: Cache + ExternalService now have full emitters
 *  (registry supported: true) -> never fall through to emitStub. This set only
 *  preserves @Injectable() behavior on direct test calls (legacy); no live
 *  production node matches this set. */
const INJECTABLE_STUB_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(["Cache", "ExternalService"]);

/** Class name exported by a stub node (SINGLE SOURCE). "ImageResultCache"
 *  -> "ImageResultCacheStub". module.emitter uses this for provider imports. */
export function stubClassName(node: CodeNode): string {
  return `${pascalCase(node.name) || pascalCase(node.kindOf())}Stub`;
}

/** File path for a stub node (SINGLE SOURCE = filePathFor default branch). */
export function stubFilePath(node: CodeNode, graph: CodeGraph): string {
  return filePathFor(node, graph);
}

export const emitStub: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const kind = node.kindOf();
  const className = stubClassName(node);
  const description = readDescription(node);
  // Injectable stubs (Cache/ExternalService) must be @Injectable() —
  // added to module providers, resolved by NestJS DI at boot.
  const isInjectable = INJECTABLE_STUB_KINDS.has(kind);

  // Stub placeholder needs no imports; collector set up to show the pattern.
  const imports = new ImportCollector();
  if (isInjectable) imports.add("Injectable", "@nestjs/common");

  const lines: string[] = [];

  // Top banner — explains why this node did not generate code and what it is.
  lines.push("/**");
  lines.push(` * ${kind} — out-of-scope node (the v1 backend chain does not generate it).`);
  lines.push(" *");
  lines.push(" * This file is intentionally a STUB: generated so the node is not dropped from the graph.");
  lines.push(" * Surgical AI fills in the target behavior at the marked point below.");
  lines.push(" */");

  // Out-of-scope surgical marker (no member -> id=<nodeId>#stub).
  lines.push(`// @solarch:surgical id=${node.id}#stub`);
  lines.push(`// out-of-scope: ${kind} "${node.name}" is not deterministically generated in v1`);
  if (description) lines.push(`// ${description}`);

  // Edge summary — node's graph connections (deterministic, sorted by name).
  const edgeLines = buildEdgeSummary(node, ctx);
  if (edgeLines.length > 0) {
    lines.push("//");
    lines.push("// edges:");
    for (const el of edgeLines) lines.push(`//   ${el}`);
  } else {
    lines.push("//");
    lines.push("// edges: (none)");
  }

  // Empty placeholder class — not silently dropped; exported. Injectable
  // stubs carry @Injectable() (added to module providers -> boot DI).
  if (isInjectable) lines.push("@Injectable()");
  lines.push(`export class ${className} {}`);

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  const file: GeneratedFile = {
    path: filePathFor(node, ctx.graph),
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
};

/** Safely reads node.properties.Description (present on all 12 types but untyped). */
function readDescription(node: CodeNode): string {
  const desc = (node.properties as Record<string, unknown>).Description;
  return typeof desc === "string" ? desc.trim() : "";
}

/* ── Edge summary ─────────────────────────────────────────────────────────────
 * Converts outgoing ("-> KIND Name") and incoming ("<- KIND Name") edges to
 * one-line summaries. CodeGraph already keeps edges sorted by kind,source,target,id
 * so outEdges/inEdges arrive sorted; output is deterministic.
 * Unresolved endpoint (missing ref) -> shown as "(?)", NEVER throws. */
function buildEdgeSummary(node: CodeNode, ctx: EmitterContext): string[] {
  const out: string[] = [];

  for (const e of ctx.graph.outEdges(node.id)) {
    const tgt = ctx.graph.byId(e.targetNodeId);
    out.push(`${e.kind} -> ${describeRef(tgt)}`);
  }
  for (const e of ctx.graph.inEdges(node.id)) {
    const src = ctx.graph.byId(e.sourceNodeId);
    out.push(`${describeRef(src)} -> ${e.kind} (incoming)`);
  }
  return out;
}

/** Describes an edge endpoint as "KIND Name"; "(?)" when endpoint cannot be resolved. */
function describeRef(ref: CodeNode | null): string {
  if (!ref) return "(?)";
  const name = ref.name || "(unnamed)";
  return `${ref.kindOf()} ${name}`;
}
