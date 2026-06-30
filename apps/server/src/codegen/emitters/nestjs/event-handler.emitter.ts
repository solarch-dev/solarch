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
 * Bir EventHandler iki biçimden BİRİNİ üretir (deterministik seçim):
 *
 *  1) KUYRUK-TABANLI (bir MessageQueue dinliyorsa): BullMQ @Processor.
 *       - Handler SUBSCRIBES edge'i ile (veya QueueRef property'siyle) bir
 *         MessageQueue'ya bağlıysa, o kuyruk adına @Processor("<queue>") + bir
 *         WorkerHost (process(job)) üretilir. RetryPolicy/DeadLetterQueue
 *         yorumda belgelenir (BullMQ defaultJobOptions modül kaydında verilir).
 *
 *  2) OLAY-TABANLI (kuyruk yoksa): @nestjs/event-emitter @OnEvent("<event>").
 *       - EventName'i dinleyen tek bir handler metodu (@OnEvent) üretilir.
 *
 * Her iki biçimde de gövde, handler'ın CALLS ettiği Service'i çağıracak
 * şekilde surgical marker + NOT_IMPLEMENTED taşır (DI alanları this.<svc>).
 * IsAsync -> Promise<void> + async; aksi halde void.
 *
 * SAF + DETERMİNİSTİK: koleksiyonlar isme göre sıralı, import'lar
 * ImportCollector ile, timestamp/random yok, içerik tek "\n" ile biter.
 * Hiçbir kayıp ref THROW ETMEZ — çözülemeyen ref ham isimden türetilir.
 * ──────────────────────────────────────────────────────────────────────── */

/** Bir EventHandler'ın CALLS ile bağımlı olabileceği DI kind'ları. Service
 *  birinci sınıf; Repository/Cache/ExternalService de enjekte edilebilir (gerçek
 *  emitter Service/Repository, stub Cache/ExternalService). */
const INJECTABLE_KINDS: NodeKind[] = ["Service", "Repository", "Cache", "ExternalService"];

/** Tam (gerçek) provider emitter'ı OLAN kind'lar — sınıfı `pascalCase(name)`
 *  olarak export eder. Cache + ExternalService de artık tam emitter'lı (gerçek
 *  sınıf, Stub eki YOK). service.emitter / ir.ts ile birebir tutulur. */
const FULL_EMITTER_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "Service",
  "Repository",
  "Cache",
  "ExternalService",
]);

/** Çözülmüş bir DI bağımlılığı: alan adı + sınıf tipi + (varsa) import yolu. */
interface ResolvedDep {
  /** constructor + `this.<field>` */
  field: string;
  /** enjekte edilen sınıf tipi */
  className: string;
  /** çözülen node'un dosya yolu (import için); çözülemezse null. */
  filePath: string | null;
}

export const emitEventHandler: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = node.properties as EventHandlerNode["properties"];
  const graph = ctx.graph;
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, graph);

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");

  // ── DI bağımlılıkları (CALLS hedefleri): handler işini Service'e devreder ──
  const deps = collectDependencies(node, graph);
  for (const dep of deps) {
    if (dep.filePath) {
      imports.add(dep.className, importPathOf(relativeImportPath(filePath, dep.filePath)));
    }
  }
  const depFields = deps.map((d) => `this.${d.field}`);

  // ── Dinlenen kuyruk: SUBSCRIBES edge'i (yoksa QueueRef property'si) ──────
  const queue = resolveSubscribedQueue(node, graph);

  const isAsync = props.IsAsync;
  const returnType = isAsync ? "Promise<void>" : "void";
  const asyncKw = isAsync ? "async " : "";

  const lines: string[] = [];
  if (props.Description) lines.push(`/** ${props.Description} */`);

  if (queue) {
    // ── (1) KUYRUK-TABANLI: BullMQ @Processor + WorkerHost.process ──────────
    const queueName = queueRegistrationName(queue);
    imports.add("Processor", "@nestjs/bullmq");
    imports.add("WorkerHost", "@nestjs/bullmq");
    imports.addType("Job", "bullmq");

    // RetryPolicy / DeadLetterQueue belgesi (BullMQ defaultJobOptions modülde).
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

    // WorkerHost türetilmiş bir sınıftır -> constructor varsa İLK ifade super()
    //   olmalı (TS: "Constructors for derived classes must contain a 'super' call").
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
    // ── (2) OLAY-TABANLI: @nestjs/event-emitter @OnEvent ────────────────────
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

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

/** constructor bloğunu `lines`'a ekler. `superCall` true ise (türetilmiş sınıf,
 *  ör. WorkerHost) gövdede `super()` üretilir -> dep yoksa bile constructor
 *  çıkar (super zorunlu). superCall false + dep yok -> constructor hiç çıkmaz. */
function pushConstructor(lines: string[], deps: ResolvedDep[], superCall = false): void {
  if (deps.length === 0 && !superCall) return;
  lines.push("  constructor(");
  for (const dep of deps) {
    lines.push(`    private readonly ${dep.field}: ${dep.className},`);
  }
  // super() gerekiyorsa gövdeye yaz; aksi halde gövde boş `{}`.
  if (superCall) {
    lines.push("  ) {");
    lines.push("    super();");
    lines.push("  }");
  } else {
    lines.push("  ) {}");
  }
}

/** Tek bir metot bloğunu (imza + surgical gövde) `lines`'a ekler. */
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

/** Surgical gövde açıklaması: handler'ın işi + (varsa) tetikleyici kuyruk/olay. */
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

/** Handler'ın dinlediği MessageQueue: önce SUBSCRIBES edge'i (handler kaynak),
 *  yoksa QueueRef property'si. Çözülemezse undefined (olay-tabanlı kola düşer). */
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

/** BullMQ @Processor'a verilecek kuyruk adı: MessageQueue.QueueName (çözülen
 *  node'un adı). Determinizm: tek kaynak node.name. */
function queueRegistrationName(queue: CodeNode): string {
  return queue.name;
}

/** CALLS edge hedeflerini (Service/Repository/Cache/ExternalService) DEDUP edip
 *  isme göre sıralanmış ResolvedDep listesi döndürür. Çözülemeyen ref'ler ham
 *  isimden sınıf adı türetir (filePath=null → import atlanır). Asla throw etmez. */
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

/** Enjekte edilen sınıf adı: tam emitter'lı kind -> `pascalCase(name)`;
 *  stub'lanan kind (Cache/ExternalService) -> `<Pascal>Stub` (stub.emitter ile
 *  TEK KAYNAK). */
function injectedClassName(resolved: CodeNode): string {
  if (FULL_EMITTER_KINDS.has(resolved.kindOf())) return pascalCase(resolved.name);
  return stubClassName(resolved);
}

/** Deterministik string karşılaştırması. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
