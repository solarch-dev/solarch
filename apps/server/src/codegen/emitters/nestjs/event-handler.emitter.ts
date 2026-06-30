import type { GeneratedFile, NodeEmitter } from "../../types";
import { type CodeGraph, type CodeNode } from "../../ir";
import {
  camelCase,
  filePathFor,
  importPathOf,
  pascalCase,
  relativeImportPath,
} from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers, notImplemented, surgicalMarker } from "../../surgical";
import { stubClassName } from "./stub.emitter";
import type { EventHandlerNode, NodeKind } from "../../../nodes/schemas";

/* ────────────────────────────────────────────────────────────────────────
 * event-handler.emitter.ts — EventHandlerNode -> <feature>/<base>.handler.ts.
 *
 * An EventHandler emits ONE of two forms (deterministic choice):
 *
 *  1) QUEUE-BASED (when listening to a MessageQueue): BullMQ @Processor.
 *       - When handler connects to MessageQueue via SUBSCRIBES edge (or QueueRef
 *         property), emit @Processor("<queue>") + WorkerHost (process(job)).
 *         RetryPolicy/DeadLetterQueue documented in comment (BullMQ defaultJobOptions
 *         set at module registration).
 *
 *  2) EVENT-BASED (no queue): @nestjs/event-emitter @OnEvent("<event>").
 *       - Single handler method (@OnEvent) listening to EventName.
 *
 * Both forms carry surgical marker + NOT_IMPLEMENTED body to call Service via
 * CALLS (DI fields this.<svc>). IsAsync -> Promise<void> + async; else void.
 *
 * PURE + DETERMINISTIC: collections sorted by name, imports via
 * ImportCollector, no timestamp/random, content ends with single "\n".
 * Missing refs NEVER THROW — unresolved ref derived from raw name.
 * ──────────────────────────────────────────────────────────────────────── */

/** DI kinds an EventHandler may depend on via CALLS. Service is first-class;
 *  Repository/Cache/ExternalService also injectable (real emitter Service/Repository,
 *  stub Cache/ExternalService). */
const INJECTABLE_KINDS: NodeKind[] = ["Service", "Repository", "Cache", "ExternalService"];

/** Kinds with full (real) provider emitters — export class as `pascalCase(name)`.
 *  Cache + ExternalService now have full emitters (real class, no Stub suffix).
 *  Kept in sync with service.emitter / ir.ts. */
const FULL_EMITTER_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "Service",
  "Repository",
  "Cache",
  "ExternalService",
]);

/** Resolved DI dependency: field name + class type + (optional) import path. */
interface ResolvedDep {
  /** constructor + `this.<field>` */
  field: string;
  /** injected class type */
  className: string;
  /** resolved node file path (for import); null when unresolved */
  filePath: string | null;
}

export const emitEventHandler: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = node.properties as EventHandlerNode["properties"];
  const graph = ctx.graph;
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, graph);

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");

  // ── DI dependencies (CALLS targets): handler delegates work to Service ──
  const deps = collectDependencies(node, graph);
  for (const dep of deps) {
    if (dep.filePath) {
      imports.add(dep.className, importPathOf(relativeImportPath(filePath, dep.filePath)));
    }
  }
  const depFields = deps.map((d) => `this.${d.field}`);

  // ── Listened queue: SUBSCRIBES edge (else QueueRef property) ──────
  const queue = resolveSubscribedQueue(node, graph);

  const isAsync = props.IsAsync;
  const returnType = isAsync ? "Promise<void>" : "void";
  const asyncKw = isAsync ? "async " : "";

  const lines: string[] = [];
  if (props.Description) lines.push(`/** ${props.Description} */`);

  if (queue) {
    // ── (1) QUEUE-BASED: BullMQ @Processor + WorkerHost.process ──────────
    const queueName = queueRegistrationName(queue);
    imports.add("Processor", "@nestjs/bullmq");
    imports.add("WorkerHost", "@nestjs/bullmq");
    imports.addType("Job", "bullmq");

    // RetryPolicy / DeadLetterQueue docs (BullMQ defaultJobOptions in module).
    const retry = props.RetryPolicy;
    if (retry) {
      const delay = retry.DelaySeconds !== undefined ? `, delaySeconds=${retry.DelaySeconds}` : "";
      lines.push(`/** retry: maxRetries=${retry.MaxRetries}${delay} */`);
    }
    if (props.DeadLetterQueue) {
      lines.push(`/** dead-letter-queue: ${props.DeadLetterQueue} */`);
    }

    lines.push(`@Processor(${JSON.stringify(queueName)})`);
    lines.push(`export class ${className} extends WorkerHost {`);

    // Derived class (WorkerHost) -> constructor must call super() first
    //   (TS: "Constructors for derived classes must contain a 'super' call").
    pushConstructor(lines, deps, /* superCall */ true);
    if (deps.length > 0) lines.push("");

    const marker = surgicalMarker({
      nodeId: node.id,
      member: "process",
      description: bodyDescription(props, queue, /* event */ undefined),
      deps: depFields.length > 0 ? depFields : undefined,
    });
    pushMethod(lines, `${asyncKw}process(job: Job): ${returnType}`, marker, className, "process");

    lines.push("}");
  } else {
    // ── (2) EVENT-BASED: @nestjs/event-emitter @OnEvent ────────────────────
    imports.add("OnEvent", "@nestjs/event-emitter");

    lines.push("@Injectable()");
    lines.push(`export class ${className} {`);

    pushConstructor(lines, deps);
    if (deps.length > 0) lines.push("");

    const member = camelCase(props.EventName ? `handle ${props.EventName}` : `handle ${node.name}`);
    const marker = surgicalMarker({
      nodeId: node.id,
      member,
      description: bodyDescription(props, /* queue */ undefined, props.EventName),
      deps: depFields.length > 0 ? depFields : undefined,
    });

    const onEventLines: string[] = [];
    onEventLines.push(`  @OnEvent(${JSON.stringify(props.EventName ?? node.name)})`);
    onEventLines.push(`  ${asyncKw}${member}(payload: unknown): ${returnType} {`);
    for (const ml of marker.split("\n")) onEventLines.push(`    ${ml}`);
    onEventLines.push(`    ${notImplemented(className, member)}`);
    onEventLines.push("  }");
    for (const l of onEventLines) lines.push(l);

    lines.push("}");
  }

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

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Append constructor block to `lines`. When `superCall` true (derived class,
 *  e.g. WorkerHost) emit `super()` in body -> constructor even with no deps
 *  (super required). superCall false + no deps -> no constructor. */
function pushConstructor(lines: string[], deps: ResolvedDep[], superCall = false): void {
  if (deps.length === 0 && !superCall) return;
  lines.push("  constructor(");
  for (const dep of deps) {
    lines.push(`    private readonly ${dep.field}: ${dep.className},`);
  }
  // Write super() in body when required; else empty `{}`.
  if (superCall) {
    lines.push("  ) {");
    lines.push("    super();");
    lines.push("  }");
  } else {
    lines.push("  ) {}");
  }
}

/** Append one method block (signature + surgical body) to `lines`. */
function pushMethod(
  lines: string[],
  signature: string,
  marker: string,
  className: string,
  member: string,
): void {
  lines.push(`  ${signature} {`);
  for (const ml of marker.split("\n")) lines.push(`    ${ml}`);
  lines.push(`    ${notImplemented(className, member)}`);
  lines.push("  }");
}

/** Surgical body description: handler work + (optional) triggering queue/event. */
function bodyDescription(
  props: EventHandlerNode["properties"],
  queue: CodeNode | undefined,
  event: string | undefined,
): string {
  const parts: string[] = [];
  if (props.Description) parts.push(props.Description);
  if (queue) parts.push(`Triggering queue: ${queue.name}.`);
  else if (event) parts.push(`Triggering event: ${event}.`);
  return parts.join("\n");
}

/** MessageQueue this handler listens to: SUBSCRIBES edge first (handler source),
 *  else QueueRef property. Undefined when unresolved (falls through to event-based). */
function resolveSubscribedQueue(node: CodeNode, graph: CodeGraph): CodeNode | undefined {
  for (const e of graph.outEdges(node.id, "SUBSCRIBES")) {
    const tgt = graph.byId(e.targetNodeId);
    if (tgt && tgt.kindOf() === "MessageQueue") return tgt;
  }
  const props = node.properties as EventHandlerNode["properties"];
  if (props.QueueRef && props.QueueRef.length > 0) {
    const q = graph.resolveRef("MessageQueue", props.QueueRef);
    if (q) return q;
  }
  return undefined;
}

/** Queue name for BullMQ @Processor: MessageQueue.QueueName (resolved
 *  node name). Determinism: single source node.name. */
function queueRegistrationName(queue: CodeNode): string {
  return queue.name;
}

/** DEDUP + name-sorted ResolvedDep list from CALLS targets
 *  (Service/Repository/Cache/ExternalService). Unresolved refs derive class from raw
 *  name (filePath=null -> skip import). Never throws. */
function collectDependencies(node: CodeNode, graph: CodeGraph): ResolvedDep[] {
  const byKey = new Map<string, ResolvedDep>();
  for (const e of graph.outEdges(node.id, "CALLS")) {
    const tgt = graph.byId(e.targetNodeId);
    if (!tgt) continue;
    if (!INJECTABLE_KINDS.includes(tgt.kindOf())) continue;
    const key = tgt.name;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      field: camelCase(tgt.name),
      className: injectedClassName(tgt),
      filePath: filePathFor(tgt, graph),
    });
  }
  return [...byKey.values()].sort((a, b) => cmp(a.field, b.field));
}

/** Injected class name: full emitter kind -> `pascalCase(name)`;
 *  stubbed kind (Cache/ExternalService) -> `<Pascal>Stub` (SINGLE SOURCE via stub.emitter). */
function injectedClassName(resolved: CodeNode): string {
  if (FULL_EMITTER_KINDS.has(resolved.kindOf())) return pascalCase(resolved.name);
  return stubClassName(resolved);
}

/** Deterministic string compare. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
