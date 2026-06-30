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
import type { OrchestratorNode } from "../../../nodes/schemas/orchestrator.schema";

/* ────────────────────────────────────────────────────────────────────────
 * orchestrator.emitter.ts — OrchestratorNode -> <feature>/<base>.orchestrator.ts.
 *
 * Bir Orchestrator, birden çok Service'i bir İŞ AKIŞINA (Saga / state machine /
 * process manager) bağlayan @Injectable() koordinatördür. Kendi iş mantığı
 * yoktur — KOORDİNE eder: enjekte ettiği Service'lerin metotlarını sıralı (veya
 * telafili) çağırır.
 *
 * DI alanları (constructor):
 *   - Steps[].ServiceRef ile adlanan her Service node BİRLEŞİM
 *     graph.outEdges(id, "CALLS") hedeflerinden Service olanlar. DEDUP edilir,
 *     isme göre sıralanır, `private readonly <camelCaseRef>: <ClassName>` olarak
 *     enjekte edilir. Çözülebilen ref'ler için import eklenir; çözülemeyen ref'ler
 *     ham Ref isminden sınıf adı türetir (import atlanır → ASLA throw).
 *
 * Metotlar:
 *   - execute(): orchestrator giriş noktası (tüm akışı yürütür). Surgical gövde;
 *     deps = enjekte edilen tüm Service'ler.
 *   - Her Step için bir metot (kebab/camel StepName). Surgical gövde; deps = o
 *     adımı yürüten Service (ServiceRef). Description = "Action" (+ OnFailure /
 *     CompensationAction notları).
 *
 * SAF + DETERMİNİSTİK: koleksiyonlar sıralı (deps isme, metotlar Step sırasında),
 * import'lar ImportCollector ile, timestamp/random yok, içerik tek "\n" ile biter.
 *
 * NOT: Orchestrator PropsByKind içinde DEĞİL — propsOf<...> KULLANILMAZ.
 * properties OrchestratorNode["properties"] olarak tipli okunur (DB Zod-doğrulanmış).
 * ──────────────────────────────────────────────────────────────────────── */

type OrchestratorProps = OrchestratorNode["properties"];
type OrchestratorStep = OrchestratorProps["Steps"][number];

/** Çözülmüş bir bağımlılık (enjekte edilen Service): DI alanı + sınıf tipi +
 *  (varsa) import yolu. */
interface ResolvedServiceDep {
  /** constructor / this.<field> */
  field: string;
  /** enjekte edilen sınıf tipi (pascalCase(name)) */
  className: string;
  /** çözülen node'un dosya yolu (import için); çözülemezse null. */
  filePath: string | null;
}

export const emitOrchestrator: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = node.properties as OrchestratorProps;
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, ctx.graph);
  const graph = ctx.graph;

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");

  // ── DI bağımlılıkları: Steps[].ServiceRef ∪ CALLS hedefleri (Service) ──────
  // DEDUP (çözülen node.name veya ham ref) + isme göre sıralı. Her step'in hangi
  // service alanına karşılık geldiğini metot gövdesinde işaretleyebilmek için
  // ref -> field eşlemesini de tutarız.
  const { deps, fieldByRef } = collectServiceDeps(node, props, graph);
  for (const dep of deps) {
    if (dep.filePath) {
      imports.add(dep.className, importPathOf(relativeImportPath(filePath, dep.filePath)));
    }
  }
  const allDepFields = deps.map((d) => `this.${d.field}`);

  // ── Metotlar ──────────────────────────────────────────────────────────────
  // (1) execute(): tüm akışın giriş noktası (deps = tümü).
  // (2) Her Step için bir metot (deps = o adımın service'i).
  const methodBlocks: string[] = [renderExecute(node, className, props, allDepFields)];
  for (const step of props.Steps ?? []) {
    methodBlocks.push(renderStep(node, className, step, fieldByRef));
  }

  // ── Sınıf gövdesi ───────────────────────────────────────────────────────────
  const lines: string[] = [];
  if (props.Description) lines.push(`/** ${props.Description} */`);
  lines.push("@Injectable()");
  lines.push(`export class ${className} {`);

  if (deps.length > 0) {
    lines.push("  constructor(");
    for (const dep of deps) {
      lines.push(`    private readonly ${dep.field}: ${dep.className},`);
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

/** Steps[].ServiceRef ∪ CALLS edge hedeflerini (Service) DEDUP edip isme göre
 *  sıralanmış ResolvedServiceDep listesi + ref->field eşlemesi döndürür.
 *  Çözülemeyen ServiceRef'ler ham isimden sınıf adı türetir (filePath=null →
 *  import atlanır). Asla throw etmez. */
function collectServiceDeps(
  node: CodeNode,
  props: OrchestratorProps,
  graph: CodeGraph,
): { deps: ResolvedServiceDep[]; fieldByRef: Map<string, string> } {
  // refName (çözülen node.name veya ham ref) -> ResolvedServiceDep (DEDUP).
  const byKey = new Map<string, ResolvedServiceDep>();
  // Her ham ServiceRef ismini -> DI alan adına eşler (step gövdesi için).
  const fieldByRef = new Map<string, string>();

  const register = (resolved: CodeNode | null, rawRef: string): string => {
    const refName = resolved ? resolved.name : rawRef;
    let entry = byKey.get(refName);
    if (entry) {
      // Mevcut çözülmemiş + gelen çözülmüş -> yükselt (import kaybını önle).
      if (entry.filePath === null && resolved) {
        entry.filePath = filePathFor(resolved, graph);
        entry.className = pascalCase(resolved.name);
      }
    } else {
      entry = {
        field: camelCase(refName),
        className: pascalCase(refName),
        filePath: resolved ? filePathFor(resolved, graph) : null,
      };
      byKey.set(refName, entry);
    }
    return entry.field;
  };

  // (1) Steps[].ServiceRef — her adımı yürüten Service.
  for (const step of props.Steps ?? []) {
    const ref = step.ServiceRef;
    if (!ref) continue;
    const resolved = graph.resolveRef("Service", ref);
    const field = register(resolved, ref);
    // Ham ServiceRef -> field (step gövdesi this.<field> işaretler).
    if (!fieldByRef.has(ref)) fieldByRef.set(ref, field);
  }

  // (2) CALLS edge hedefleri — Service olanlar (Steps'te geçmeyenler de DI'ya girer).
  for (const e of graph.outEdges(node.id, "CALLS")) {
    const tgt = graph.byId(e.targetNodeId);
    if (!tgt || tgt.kindOf() !== "Service") continue;
    const field = register(tgt, tgt.name);
    if (!fieldByRef.has(tgt.name)) fieldByRef.set(tgt.name, field);
  }

  const deps = [...byKey.values()].sort((a, b) => cmp(a.field, b.field));
  return { deps, fieldByRef };
}

/** execute() — orchestrator giriş noktası. Tüm akışı (Steps sırasıyla) yürütür.
 *  deps = enjekte edilen TÜM service alanları. Surgical gövde. */
function renderExecute(
  node: CodeNode,
  className: string,
  props: OrchestratorProps,
  allDepFields: string[],
): string {
  const indent = "  ";
  const stepNames = (props.Steps ?? []).map((s) => s.StepName).filter((n) => n.length > 0);
  const descParts: string[] = [];
  descParts.push(`${props.Pattern} orchestration: coordinates all steps.`);
  if (stepNames.length > 0) descParts.push(`steps: ${stepNames.join(" -> ")}`);

  const marker = surgicalMarker({
    nodeId: node.id,
    member: "execute",
    description: descParts.join("\n"),
    deps: allDepFields.length > 0 ? allDepFields : undefined,
  });

  const lines: string[] = [];
  lines.push(`${indent}async execute(): Promise<void> {`);
  for (const ml of marker.split("\n")) lines.push(`${indent}${indent}${ml}`);
  lines.push(`${indent}${indent}${notImplemented(className, "execute")}`);
  lines.push(`${indent}}`);
  return lines.join("\n");
}

/** Tek bir Step'i bir metoda çevirir (imza + surgical gövde). Metot adı StepName'
 *  den camelCase türetilir; deps = o adımı yürüten Service alanı (varsa). */
function renderStep(
  node: CodeNode,
  className: string,
  step: OrchestratorStep,
  fieldByRef: Map<string, string>,
): string {
  const indent = "  ";
  const method = stepMethodName(step.StepName);

  // Bu adımı yürüten service alanı (ServiceRef -> field).
  const depFields: string[] = [];
  const field = step.ServiceRef ? fieldByRef.get(step.ServiceRef) : undefined;
  if (field) depFields.push(`this.${field}`);

  // Açıklama: Action + OnFailure + (varsa) CompensationAction.
  const descParts: string[] = [];
  if (step.Action) descParts.push(step.Action);
  descParts.push(`onFailure: ${step.OnFailure}`);
  if (step.CompensationAction) descParts.push(`compensation: ${step.CompensationAction}`);

  const marker = surgicalMarker({
    nodeId: node.id,
    member: method,
    description: descParts.join("\n"),
    deps: depFields.length > 0 ? depFields : undefined,
  });

  const lines: string[] = [];
  lines.push(`${indent}async ${method}(): Promise<void> {`);
  for (const ml of marker.split("\n")) lines.push(`${indent}${indent}${ml}`);
  lines.push(`${indent}${indent}${notImplemented(className, method)}`);
  lines.push(`${indent}}`);
  return lines.join("\n");
}

/** Bir StepName'i geçerli bir TS metot adına çevirir: camelCase; boşsa "step". */
function stepMethodName(stepName: string): string {
  const camel = camelCase(stepName);
  return camel.length > 0 ? camel : "step";
}

/** Deterministik string karşılaştırması. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
