import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeGraph, type CodeNode } from "../../ir";
import { filePathFor, importPathOf, pascalCase, relativeImportPath } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers, surgicalMarker } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * message-queue.emitter.ts — MessageQueueNode -> <feature>/<base>.queue.ts.
 *
 * Mirrors enum.emitter.ts (canonical reference) exactly:
 *   - named `export const emitMessageQueue: NodeEmitter`; no default export.
 *   - PURE function (node, ctx) -> GeneratedFile[]; no I/O, no throw.
 *   - Path always via filePathFor(node, ctx.graph) (hardcode FORBIDDEN).
 *   - imports via ImportCollector (manual "import" FORBIDDEN).
 *   - DETERMINISTIC: single file, fixed ordering, no timestamp/random.
 *   - Content ends with single "\n".
 *
 * OUTPUT: @Injectable() BullMQ PRODUCER (job enqueue side).
 *   - constructor injects `@InjectQueue(QUEUE_NAME) private readonly queue: Queue`
 *     (Queue type from "bullmq", @InjectQueue/@nestjs/bullmq).
 *   - Queue name written as deterministic export const
 *     (`export const <QUEUE>_QUEUE = "<QueueName>"`) — SINGLE SOURCE between
 *     BullModule.registerQueue({ name }) in module and @InjectQueue.
 *   - `publish(payload: <MessageDto>)` carries REAL body:
 *       await this.queue.add(<jobName>, payload);
 *     Surgical marker left above — Surgical AI extends retry/opts/idempotency
 *     at marked point (body still COMPILES + runs).
 *
 * MessageFormat -> DTO node Name (schema description). When resolved payload type
 *   is that DTO class (imported); else falls back to `unknown` (never throws).
 *
 * When Type=Topic NOTE: BullMQ is single-queue model; Topic semantics embedded in
 *   queue name (job name = "publish"); channel/exchange difference left to Surgical AI.
 * ──────────────────────────────────────────────────────────────────────── */

type MessageQueueProps = {
  QueueName: string;
  Description?: string;
  Type?: "Queue" | "Topic";
  Provider?: string;
  MessageFormat?: string;
  DeliveryGuarantee?: string;
  MaxRetries?: number;
  DeadLetterQueue?: string;
  RetentionSeconds?: number;
};

export const emitMessageQueue: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = readProps(node);
  const graph = ctx.graph;
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, graph);

  // Queue name = QueueName (else resolved node name). @InjectQueue + module
  // registerQueue share this VALUE -> single source const.
  const queueName = (props.QueueName && props.QueueName.length > 0 ? props.QueueName : node.name) || "queue";
  const queueConst = queueNameConst(node);

  // Payload type: MessageFormat -> DTO node. When resolved class + import; else unknown.
  const payloadType = resolvePayloadType(props.MessageFormat, graph, filePath);

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");
  imports.add("InjectQueue", "@nestjs/bullmq");
  imports.addType("Queue", "bullmq");
  if (payloadType.importFrom) {
    imports.addType(payloadType.className, importPathOf(relativeImportPath(filePath, payloadType.importFrom)));
  }

  const lines: string[] = [];

  // Queue name const — SINGLE SOURCE between module registerQueue and @InjectQueue.
  lines.push(`/** "${node.kindOf()}" queue name — single source of truth shared between BullModule.registerQueue and @InjectQueue. */`);
  lines.push(`export const ${queueConst} = ${JSON.stringify(queueName)};`);
  lines.push("");

  if (props.Description) lines.push(`/** ${props.Description} */`);
  lines.push("@Injectable()");
  lines.push(`export class ${className} {`);

  // DI: BullMQ Queue (Wire phase binds BullModule.registerQueue({ name: <queueConst> })).
  lines.push("  constructor(");
  lines.push(`    @InjectQueue(${queueConst}) private readonly queue: Queue,`);
  lines.push("  ) {}");
  lines.push("");

  // publish(payload) — REAL body + surgical marker (retry/opts extension point).
  lines.push(...renderPublishMethod(node, className, payloadType.className, props));

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

/** Queue name const — SCREAMING_SNAKE like `IMAGE_MESSAGE_QUEUE_QUEUE`.
 *  pascal(name) split into words + upper-snake + "_QUEUE" suffix.
 *  EXPORT: module.emitter (Wire phase) wants this SYMBOL NAME for BullModule.registerQueue({ name: <CONST> });
 *  const VALUE stays in .queue.ts (single source). */
export function queueNameConst(node: CodeNode): string {
  const screaming = pascalCase(node.name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
  const base = screaming.length > 0 ? screaming : "QUEUE";
  return base.endsWith("_QUEUE") || base === "QUEUE" ? base : `${base}_QUEUE`;
}

/** publish(payload) method: real `queue.add` call + surgical marker above. */
function renderPublishMethod(
  node: CodeNode,
  className: string,
  payloadType: string,
  props: MessageQueueProps,
): string[] {
  const indent = "  ";
  // Job name deterministic "publish" (BullMQ single queue; job name fixed).
  const jobName = '"publish"';

  // Surgical marker: behavior extension point (retry/backoff/idempotency).
  const deliveryNote = props.DeliveryGuarantee ? `delivery: ${props.DeliveryGuarantee}` : undefined;
  const retryNote = typeof props.MaxRetries === "number" ? `maxRetries: ${props.MaxRetries}` : undefined;
  const dlqNote = props.DeadLetterQueue ? `dead-letter: ${props.DeadLetterQueue}` : undefined;
  const description = [
    `Adds a job to the queue (BullMQ producer). ${node.name}`,
    deliveryNote,
    retryNote,
    dlqNote,
  ]
    .filter((s): s is string => Boolean(s))
    .join("\n");

  const marker = surgicalMarker({
    nodeId: node.id,
    member: "publish",
    description,
    deps: ["this.queue"],
  });

  const lines: string[] = [];
  lines.push(`${indent}/** Adds a message/job to the queue. */`);
  lines.push(`${indent}async publish(payload: ${payloadType}): Promise<void> {`);
  for (const ml of marker.split("\n")) lines.push(`${indent}${indent}${ml}`);
  // Body DETERMINISTICALLY FULLY generated (BullMQ producer = this.queue.add). Marker kept as
  // extension point but this region NOT "to fill" -> codegen-filled stamp. Else without
  // NOT_IMPLEMENTED it would count as "filled" and fill silently skips -> count mismatch
  // (total shown, fewer processed).
  lines.push(`${indent}${indent}// @solarch:filled by=codegen`);
  lines.push(`${indent}${indent}await this.queue.add(${jobName}, payload);`);
  lines.push(`${indent}}`);
  return lines;
}

/** MessageFormat -> DTO node Name. When resolved payload type is that DTO class (imported);
 *  else `unknown` (never throws). */
function resolvePayloadType(
  messageFormat: string | undefined,
  graph: CodeGraph,
  fromFile: string,
): { className: string; importFrom: string | null } {
  const fmt = (messageFormat ?? "").trim();
  if (fmt.length === 0) return { className: "unknown", importFrom: null };
  const dto = graph.resolveRef("DTO", fmt);
  if (dto) {
    return { className: pascalCase(dto.name), importFrom: filePathFor(dto, graph) };
  }
  // Unresolved free name -> unknown (tolerance; no import).
  return { className: "unknown", importFrom: null };
}

/** Read node.properties as MessageQueueProps safely (Zod-validated DB;
 *  type narrowing only — no runtime transform). */
function readProps(node: CodeNode): MessageQueueProps {
  return node.properties as MessageQueueProps;
}
