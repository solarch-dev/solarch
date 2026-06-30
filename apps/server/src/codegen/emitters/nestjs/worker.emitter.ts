import type { GeneratedFile, NodeEmitter } from "../../types";
import { type CodeGraph, type CodeNode } from "../../ir";
import {
  baseNameOf,
  camelCase,
  filePathFor,
  importPathOf,
  pascalCase,
  relativeImportPath,
} from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers, notImplemented, surgicalMarker } from "../../surgical";
import type { NodeKind } from "../../../nodes/schemas";

/* ────────────────────────────────────────────────────────────────────────
 * worker.emitter.ts — WorkerNode -> <feature>/<kebab>.worker.ts.
 *
 * Emits an @Injectable() NestJS scheduled worker:
 *   - ONE handler method decorated with @Cron(<Schedule>). Schedule is a cron
 *     expression (WorkerNode.Schedule). Falls back to sensible default when
 *     empty/missing (midnight daily: "0 0 * * *").
 *   - DI fields: Services among graph.outEdges(id, "CALLS") targets
 *     (deterministic: DEDUP + sorted by name). Each injected as
 *     `private readonly <camelCaseRef>: <ServiceClass>` in constructor;
 *     relative import added for resolvable refs.
 *   - Handler body = surgicalMarker (Description, TaskToExecute, accessible
 *     deps this.<svc>) + notImplemented(). Cron handler is the "algorithm
 *     region" — Constructor does not write it; Surgical AI fills it.
 *
 * NOTE: Worker NOT in PropsByKind (propsOf<...> CANNOT be used). Properties
 *   read safely (typed helper) via worker.schema.ts shape; missing/malformed
 *   fields tolerated (NEVER throw).
 *
 * PURE + DETERMINISTIC: collections sorted, imports via ImportCollector,
 * no timestamp/random, content ends with single "\n".
 * ──────────────────────────────────────────────────────────────────────── */

/** Provider kinds Worker injects via CALLS (full emitters). */
const INJECTABLE_CALL_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(["Service"]);

/** Safe (untyped) view of same shape as worker.schema.ts. Worker is not in
 *  PropsByKind so fields read defensively one by one. */
interface WorkerPropsView {
  Description: string;
  Schedule: string;
  TaskToExecute: string;
}

/** One DI-injected service dependency: field name + class type + (optional) import path. */
interface ResolvedServiceDep {
  /** `this.<field>` in constructor */
  field: string;
  /** injected class type (pascalCase(name)) */
  className: string;
  /** resolved node file path (for import); null when unresolvable. */
  filePath: string | null;
}

export const emitWorker: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const graph = ctx.graph;
  const props = readWorkerProps(node);
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, graph);

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");
  imports.add("Cron", "@nestjs/schedule");

  // ── DI deps: Services among CALLS edge targets ──────────
  const deps = collectServiceDeps(node, graph);
  for (const dep of deps) {
    if (dep.filePath) {
      imports.add(dep.className, importPathOf(relativeImportPath(filePath, dep.filePath)));
    }
  }

  // ── @Cron schedule + handler name ──────────────────────────────────────────
  const schedule = resolveSchedule(props.Schedule);
  const handlerName = handlerNameOf(node);

  // ── Handler body (surgical) ────────────────────────────────────────────
  const depFields = deps.map((d) => `this.${d.field}`);
  const description = buildHandlerDescription(props);
  const marker = surgicalMarker({
    nodeId: node.id,
    member: handlerName,
    description: description.length > 0 ? description : undefined,
    deps: depFields.length > 0 ? depFields : undefined,
  });

  // ── Class body ─────────────────────────────────────────────────────────
  const lines: string[] = [];
  // Emit JSDoc when meaningful (trim >=3 char); skip single-letter/empty noise.
  if (props.Description.length >= 3) lines.push(`/** ${props.Description} */`);
  lines.push("@Injectable()");
  lines.push(`export class ${className} {`);

  if (deps.length > 0) {
    lines.push("  constructor(");
    for (const dep of deps) {
      lines.push(`    private readonly ${dep.field}: ${dep.className},`);
    }
    lines.push("  ) {}");
    lines.push("");
  }

  lines.push(`  @Cron(${JSON.stringify(schedule)})`);
  lines.push(`  async ${handlerName}(): Promise<void> {`);
  for (const ml of marker.split("\n")) lines.push(`    ${ml}`);
  lines.push(`    ${notImplemented(className, handlerName)}`);
  lines.push("  }");

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

/** Read worker.schema.ts shape safely (missing/malformed -> empty string). */
function readWorkerProps(node: CodeNode): WorkerPropsView {
  const p = node.properties as Record<string, unknown>;
  return {
    Description: typeof p.Description === "string" ? p.Description.trim() : "",
    Schedule: typeof p.Schedule === "string" ? p.Schedule.trim() : "",
    TaskToExecute: typeof p.TaskToExecute === "string" ? p.TaskToExecute.trim() : "",
  };
}

/** DEDUP Services among CALLS edge targets, return sorted ResolvedServiceDep list.
 *  Unresolved endpoints skipped; never throws. */
function collectServiceDeps(node: CodeNode, graph: CodeGraph): ResolvedServiceDep[] {
  // refName (node.name) -> ResolvedServiceDep (DEDUP).
  const byKey = new Map<string, ResolvedServiceDep>();
  for (const e of graph.outEdges(node.id, "CALLS")) {
    const tgt = graph.byId(e.targetNodeId);
    if (!tgt || !INJECTABLE_CALL_KINDS.has(tgt.kindOf())) continue;
    if (byKey.has(tgt.name)) continue;
    byKey.set(tgt.name, {
      field: camelCase(tgt.name),
      className: pascalCase(tgt.name),
      filePath: filePathFor(tgt, graph),
    });
  }
  return [...byKey.values()].sort((a, b) => cmp(a.field, b.field));
}

/** @Cron argument: use Schedule cron expression when given, else sensible default
 *  (midnight daily). Deterministic: property + constant only. */
function resolveSchedule(schedule: string): string {
  return schedule.length > 0 ? schedule : "0 0 * * *";
}

/** Cron handler method name: baseNameOf (role suffix "Worker" stripped) -> camelCase
 *  + idiomatic "handle<Base>". "ThumbnailWorker" -> "handleThumbnail".
 *  Never empty (falls back to "handleTick" when base empty). */
function handlerNameOf(node: CodeNode): string {
  const base = pascalCase(baseNameOf(node));
  return base.length > 0 ? `handle${base}` : "handleTick";
}

/** Handler surgical description: TaskToExecute (what it should do) preferred;
 *  else Description. Line breaks handled by surgicalMarker. */
function buildHandlerDescription(props: WorkerPropsView): string {
  if (props.TaskToExecute.length > 0) return props.TaskToExecute;
  return props.Description;
}

/** Deterministic string compare. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
