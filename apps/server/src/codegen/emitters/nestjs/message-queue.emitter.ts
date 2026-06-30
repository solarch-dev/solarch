import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeGraph, type CodeNode } from "../../ir";
import { filePathFor, importPathOf, pascalCase, relativeImportPath } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers, surgicalMarker } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * message-queue.emitter.ts — MessageQueueNode -> <feature>/<base>.queue.ts.
 *
 * enum.emitter.ts'i (kanonik referans) birebir taklit eder:
 *   - named `export const emitMessageQueue: NodeEmitter`; default export YOK.
 *   - SAF fonksiyon (node, ctx) -> GeneratedFile[]; I/O yok, throw YOK.
 *   - Yol her zaman filePathFor(node, ctx.graph) ile (hardcode YASAK).
 *   - import'lar ImportCollector ile (elle "import" YASAK).
 *   - DETERMİNİSTİK: tek dosya, sabit sıralama, timestamp/random YOK.
 *   - İçerik tek "\n" ile biter.
 *
 * ÜRETİLEN: @Injectable() bir BullMQ PRODUCER (kuyruğa iş ekleyen taraf).
 *   - constructor'da `@InjectQueue(QUEUE_NAME) private readonly queue: Queue`
 *     enjekte edilir (Queue tipi "bullmq" paketinden, @InjectQueue/@nestjs/bullmq).
 *   - Kuyruk adı deterministik bir export sabiti olarak yazılır
 *     (`export const <QUEUE>_QUEUE = "<QueueName>"`) — module'deki
 *     BullModule.registerQueue({ name }) ile @InjectQueue arasında TEK KAYNAK.
 *   - `publish(payload: <MessageDto>)` metodu GERÇEK gövde taşır:
 *       await this.queue.add(<jobName>, payload);
 *     Üstte bir surgical marker bırakılır — Surgical AI retry/opts/idempotency
 *     gibi davranışı işaretli noktada genişletir (gövde yine de DERLENİR + çalışır).
 *
 * MessageFormat -> DTO node Name (şema açıklaması). Çözülürse payload tipi o DTO
 *   sınıfıdır (import edilir); çözülemezse `unknown`a düşer (ASLA throw etmez).
 *
 * Type=Topic ise NOT: BullMQ tek kuyruk modelidir; Topic anlamı kuyruk adına
 *   gömülür (job name = "publish"); kanal/exchange farkı Surgical AI'ye bırakılır.
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

  // Kuyruk adı = QueueName (yoksa çözülmüş node adı). @InjectQueue + module
  // registerQueue bu DEĞERİ aynen paylaşır -> tek kaynak sabiti.
  const queueName = (props.QueueName && props.QueueName.length > 0 ? props.QueueName : node.name) || "queue";
  const queueConst = queueNameConst(node);

  // Payload tipi: MessageFormat -> DTO node. Çözülürse sınıf + import; yoksa unknown.
  const payloadType = resolvePayloadType(props.MessageFormat, graph, filePath);

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");
  imports.add("InjectQueue", "@nestjs/bullmq");
  imports.addType("Queue", "bullmq");
  if (payloadType.importFrom) {
    imports.addType(payloadType.className, importPathOf(relativeImportPath(filePath, payloadType.importFrom)));
  }

  const lines: string[] = [];

  // Kuyruk adı sabiti — module registerQueue ile @InjectQueue arasında TEK KAYNAK.
  lines.push(`/** "${node.kindOf()}" queue name — single source of truth shared between BullModule.registerQueue and @InjectQueue. */`);
  lines.push(`export const ${queueConst} = ${JSON.stringify(queueName)};`);
  lines.push("");

  if (props.Description) lines.push(`/** ${props.Description} */`);
  lines.push("@Injectable()");
  lines.push(`export class ${className} {`);

  // DI: BullMQ Queue (Wire fazı BullModule.registerQueue({ name: <queueConst> }) bağlar).
  lines.push("  constructor(");
  lines.push(`    @InjectQueue(${queueConst}) private readonly queue: Queue,`);
  lines.push("  ) {}");
  lines.push("");

  // publish(payload) — GERÇEK gövde + surgical marker (retry/opts genişletme noktası).
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

/** Kuyruk adı sabiti — `IMAGE_MESSAGE_QUEUE_QUEUE` benzeri SCREAMING_SNAKE.
 *  pascal(name) sözcüklere bölünüp upper-snake'lenir + "_QUEUE" eki.
 *  EXPORT: module.emitter (Wire fazı) BullModule.registerQueue({ name: <CONST> })
 *  için bu SEMBOL ADINI ister; sabitin DEĞERİ .queue.ts'te (tek kaynak) kalır. */
export function queueNameConst(node: CodeNode): string {
  const screaming = pascalCase(node.name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
  const base = screaming.length > 0 ? screaming : "QUEUE";
  return base.endsWith("_QUEUE") || base === "QUEUE" ? base : `${base}_QUEUE`;
}

/** publish(payload) metodu: gerçek `queue.add` çağrısı + üstte surgical marker. */
function renderPublishMethod(
  node: CodeNode,
  className: string,
  payloadType: string,
  props: MessageQueueProps,
): string[] {
  const indent = "  ";
  // Job adı deterministik "publish" (BullMQ tek kuyruk; job adı sabittir).
  const jobName = '"publish"';

  // Surgical marker: davranış genişletme noktası (retry/backoff/idempotency).
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
  // Gövde DETERMİNİSTİK olarak TAM üretildi (BullMQ producer = this.queue.add). Marker bir
  // genişletme noktası olarak KORUNUR ama bu bölge "doldurulacak" DEĞİL → codegen-dolu
  // damgası. Aksi halde NOT_IMPLEMENTED içermediği için "filled" sayılıp fill tarafından
  // sessizce atlanır ve sayım tutarsız olur (toplam gösterilir, daha azı doldurulur).
  lines.push(`${indent}${indent}// @solarch:filled by=codegen`);
  lines.push(`${indent}${indent}await this.queue.add(${jobName}, payload);`);
  lines.push(`${indent}}`);
  return lines;
}

/** MessageFormat -> DTO node Name. Çözülürse payload tipi o DTO sınıfı (import
 *  edilir); çözülemezse `unknown` (ASLA throw etmez). */
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
  // Çözülemeyen serbest ad -> unknown (tolerans; import üretilmez).
  return { className: "unknown", importFrom: null };
}

/** node.properties'i MessageQueueProps olarak güvenle okur (Zod-doğrulanmış DB;
 *  yalnız tip daraltma — çalışma zamanı dönüşümü YOK). */
function readProps(node: CodeNode): MessageQueueProps {
  return node.properties as MessageQueueProps;
}
