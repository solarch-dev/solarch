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
 * Bir Orchestrator, birden cok Service'i bir IS AKISINA (Saga / state machine /
 * process manager) baglayan @Injectable() koordinatordur. Kendi is mantigi
 * yoktur — KOORDINE eder: enjekte ettigi Service'lerin metotlarini sirali (veya
 * telafili) cagirir.
 *
 * DI alanlari (constructor):
 *   - Steps[].ServiceRef ile adlanan her Service node BIRLESIM
 *     graph.outEdges(id, "CALLS") hedeflerinden Service olanlar. DEDUP edilir,
 *     isme gore siralanir, `private readonly <camelCaseRef>: <ClassName>` olarak
 *     enjekte edilir. Cozulebilen ref'ler icin import eklenir; cozulemeyen ref'ler
 *     ham Ref isminden sinif adi turetir (import atlanir → ASLA throw).
 *
 * Metotlar:
 *   - execute(): orchestrator giris noktasi (tum akisi yurutur). Surgical govde;
 *     deps = enjekte edilen tum Service'ler.
 *   - Her Step icin bir metot (kebab/camel StepName). Surgical govde; deps = o
 *     adimi yuruten Service (ServiceRef). Description = "Action" (+ OnFailure /
 *     CompensationAction notlari).
 *
 * SAF + DETERMINISTIC: koleksiyonlar sirali (deps isme, metotlar Step sirasinda),
 * import'lar ImportCollector ile, timestamp/random yok, icerik tek "\n" ile biter.
 *
 * NOT: Orchestrator PropsByKind icinde NOT — propsOf<...> KULLANILMAZ.
 * properties OrchestratorNode["properties"] olarak tipli okunur (DB Zod-dogrulanmis).
 * ──────────────────────────────────────────────────────────────────────── */

type OrchestratorProps = OrchestratorNode["properties"];
type OrchestratorStep = OrchestratorProps["Steps"][number];

/** Cozulmus bir bagimlilik (enjekte edilen Service): DI alani + sinif tipi +
 *  (varsa) import yolu. */
interface ResolvedServiceDep {
  /** constructor / this.<field> */
  field: string;
  /** enjekte edilen sinif tipi (pascalCase(name)) */
  className: string;
  /** cozulen node'un dosya yolu (import icin); cozulemezse null. */
  filePath: string | null;
}

export const emitOrchestrator: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = node.properties as OrchestratorProps;
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, ctx.graph);
  const graph = ctx.graph;

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");

  // ── DI bagimliliklari: Steps[].ServiceRef ∪ CALLS hedefleri (Service) ──────
  // DEDUP (cozulen node.name veya ham ref) + isme gore sirali. Her step'in hangi
  // service alanina karsilik geldigini metot govdesinde isaretleyebilmek icin
  // ref -> field eslemesini de tutariz.
  const { deps, fieldByRef } = collectServiceDeps(node, props, graph);
  for (const dep of deps) {
    if (dep.filePath) {
      imports.add(dep.className, importPathOf(relativeImportPath(filePath, dep.filePath)));
    }
  }
  const allDepFields = deps.map((d) => `this.${d.field}`);

  // ── Metotlar ──────────────────────────────────────────────────────────────
  // (1) execute(): tum akisin giris noktasi (deps = tumu).
  // (2) Her Step icin bir metot (deps = o adimin service'i).
  const methodBlocks: string[] = [renderExecute(node, className, props, allDepFields)];
  for (const step of props.Steps ?? []) {
    methodBlocks.push(renderStep(node, className, step, fieldByRef));
  }

  // ── Sinif govdesi ───────────────────────────────────────────────────────────
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

/** Steps[].ServiceRef ∪ CALLS edge hedeflerini (Service) DEDUP edip isme gore
 *  siralanmis ResolvedServiceDep listesi + ref->field eslemesi dondurur.
 *  Cozulemeyen ServiceRef'ler ham isimden sinif adi turetir (filePath=null →
 *  import atlanir). Asla throw etmez. */
function collectServiceDeps(
  node: CodeNode,
  props: OrchestratorProps,
  graph: CodeGraph,
): { deps: ResolvedServiceDep[]; fieldByRef: Map<string, string> } {
  // refName (cozulen node.name veya ham ref) -> ResolvedServiceDep (DEDUP).
  const byKey = new Map<string, ResolvedServiceDep>();
  // Her ham ServiceRef ismini -> DI alan adina esler (step govdesi icin).
  const fieldByRef = new Map<string, string>();

  const register = (resolved: CodeNode | null, rawRef: string): string => {
    const refName = resolved ? resolved.name : rawRef;
    let entry = byKey.get(refName);
    if (entry) {
      // Mevcut cozulmemis + gelen cozulmus -> yukselt (import kaybini onle).
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

  // (1) Steps[].ServiceRef — her adimi yuruten Service.
  for (const step of props.Steps ?? []) {
    const ref = step.ServiceRef;
    if (!ref) continue;
    const resolved = graph.resolveRef("Service", ref);
    const field = register(resolved, ref);
    // Ham ServiceRef -> field (step govdesi this.<field> isaretler).
    if (!fieldByRef.has(ref)) fieldByRef.set(ref, field);
  }

  // (2) CALLS edge hedefleri — Service olanlar (Steps'te gecmeyenler de DI'ya girer).
  for (const e of graph.outEdges(node.id, "CALLS")) {
    const tgt = graph.byId(e.targetNodeId);
    if (!tgt || tgt.kindOf() !== "Service") continue;
    const field = register(tgt, tgt.name);
    if (!fieldByRef.has(tgt.name)) fieldByRef.set(tgt.name, field);
  }

  const deps = [...byKey.values()].sort((a, b) => cmp(a.field, b.field));
  return { deps, fieldByRef };
}

/** execute() — orchestrator giris noktasi. Tum akisi (Steps sirasiyla) yurutur.
 *  deps = enjekte edilen TUM service alanlari. Surgical govde. */
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

/** Tek bir Step'i bir metoda cevirir (imza + surgical govde). Metot adi StepName'
 *  den camelCase turetilir; deps = o adimi yuruten Service alani (varsa). */
function renderStep(
  node: CodeNode,
  className: string,
  step: OrchestratorStep,
  fieldByRef: Map<string, string>,
): string {
  const indent = "  ";
  const method = stepMethodName(step.StepName);

  // Bu adimi yuruten service alani (ServiceRef -> field).
  const depFields: string[] = [];
  const field = step.ServiceRef ? fieldByRef.get(step.ServiceRef) : undefined;
  if (field) depFields.push(`this.${field}`);

  // Aciklama: Action + OnFailure + (varsa) CompensationAction.
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

/** Bir StepName'i gecerli bir TS metot adina cevirir: camelCase; bossa "step". */
function stepMethodName(stepName: string): string {
  const camel = camelCase(stepName);
  return camel.length > 0 ? camel : "step";
}

/** Deterministik string karsilastirmasi. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
