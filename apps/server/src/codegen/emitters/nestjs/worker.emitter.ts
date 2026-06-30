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
 * @Injectable() bir NestJS zamanlanmış işçisi (scheduled worker) üretir:
 *   - @Cron(<Schedule>) ile dekore edilmiş TEK handler metodu. Schedule bir cron
 *     ifadesidir (WorkerNode.Schedule, "cron ifadesi"). Boş/eksikse makul bir
 *     default'a düşülür (her gece yarısı: "0 0 * * *").
 *   - DI alanları: graph.outEdges(id, "CALLS") hedefleri arasından Service'ler
 *     (deterministik: DEDUP + isme göre sıralı). Her biri constructor'a
 *     `private readonly <camelCaseRef>: <ServiceClass>` olarak enjekte edilir;
 *     çözülebilen ref'ler için göreli import eklenir.
 *   - Handler gövdesi = surgicalMarker (Description, TaskToExecute, erişilebilir
 *     bağımlılıklar this.<svc>) + notImplemented(). Cron handler "algoritma
 *     alanıdır" — Constructor yazmaz, Surgical AI doldurur.
 *
 * NOT: Worker PropsByKind içinde DEĞİL (propsOf<...> KULLANILAMAZ). Property'ler
 *   worker.schema.ts shape'iyle güvenle (tipli yardımcı) okunur; kayıp/biçimsiz
 *   alanlar tolere edilir (ASLA throw).
 *
 * SAF + DETERMİNİSTİK: koleksiyonlar sıralı, import'lar ImportCollector ile,
 * timestamp/random yok, içerik tek "\n" ile biter.
 * ──────────────────────────────────────────────────────────────────────── */

/** Worker'ın CALLS ile enjekte ettiği provider kind'ları (tam emitter'lı). */
const INJECTABLE_CALL_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(["Service"]);

/** worker.schema.ts ile aynı shape'in güvenli (tip-dışı) görünümü. Worker
 *  PropsByKind'da olmadığından alanlar tek tek, savunmacı okunur. */
interface WorkerPropsView {
  Description: string;
  Schedule: string;
  TaskToExecute: string;
}

/** Bir DI'lanmış servis bağımlılığı: alan adı + sınıf tipi + (varsa) import yolu. */
interface ResolvedServiceDep {
  /** constructor'da `this.<field>` */
  field: string;
  /** enjekte edilen sınıf tipi (pascalCase(name)) */
  className: string;
  /** çözülen node'un dosya yolu (import için); çözülemezse null. */
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

  // ── DI bağımlılıkları: CALLS edge hedefleri arasından Service'ler ──────────
  const deps = collectServiceDeps(node, graph);
  for (const dep of deps) {
    if (dep.filePath) {
      imports.add(dep.className, importPathOf(relativeImportPath(filePath, dep.filePath)));
    }
  }

  // ── @Cron schedule + handler adı ──────────────────────────────────────────
  const schedule = resolveSchedule(props.Schedule);
  const handlerName = handlerNameOf(node);

  // ── Handler gövdesi (surgical) ────────────────────────────────────────────
  const depFields = deps.map((d) => `this.${d.field}`);
  const description = buildHandlerDescription(props);
  const marker = surgicalMarker({
    nodeId: node.id,
    member: handlerName,
    description: description.length > 0 ? description : undefined,
    deps: depFields.length > 0 ? depFields : undefined,
  });

  // ── Sınıf gövdesi ─────────────────────────────────────────────────────────
  const lines: string[] = [];
  // Anlamlı açıklama varsa (trim >=3 char) JSDoc bas; tek-harf/boş gürültüyü atla.
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

/** worker.schema.ts shape'ini güvenle okur (kayıp/biçimsiz -> boş string). */
function readWorkerProps(node: CodeNode): WorkerPropsView {
  const p = node.properties as Record<string, unknown>;
  return {
    Description: typeof p.Description === "string" ? p.Description.trim() : "",
    Schedule: typeof p.Schedule === "string" ? p.Schedule.trim() : "",
    TaskToExecute: typeof p.TaskToExecute === "string" ? p.TaskToExecute.trim() : "",
  };
}

/** CALLS edge hedefleri arasından Service'leri DEDUP edip isme göre sıralanmış
 *  ResolvedServiceDep listesi döndürür. Çözülemeyen uç atlanır; asla throw etmez. */
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

/** @Cron argümanı: Schedule cron ifadesi verilmişse onu, değilse makul bir
 *  default'u (her gece yarısı) kullanır. Determinizm: yalnız property + sabit. */
function resolveSchedule(schedule: string): string {
  return schedule.length > 0 ? schedule : "0 0 * * *";
}

/** Cron handler metot adı: baseNameOf (rol son-eki "Worker" düşmüş) -> camelCase
 *  + "Tick" yerine idiomatik "handle<Base>". "ThumbnailWorker" -> "handleThumbnail".
 *  Boş ada düşmez (base boşsa "handleTick"). */
function handlerNameOf(node: CodeNode): string {
  const base = pascalCase(baseNameOf(node));
  return base.length > 0 ? `handle${base}` : "handleTick";
}

/** Handler surgical açıklaması: TaskToExecute (ne yapması gerektiği) öncelikli;
 *  yoksa Description. Satıra bölme surgicalMarker tarafından yapılır. */
function buildHandlerDescription(props: WorkerPropsView): string {
  if (props.TaskToExecute.length > 0) return props.TaskToExecute;
  return props.Description;
}

/** Deterministik string karşılaştırması. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
