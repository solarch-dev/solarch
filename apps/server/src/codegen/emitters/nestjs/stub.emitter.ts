import type { EmitterContext, GeneratedFile, NodeEmitter } from "../../types";
import type { CodeGraph, CodeNode } from "../../ir";
import { filePathFor, pascalCase } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";
import type { NodeKind } from "../../../nodes/schemas";

/* ────────────────────────────────────────────────────────────────────────
 * stub.emitter.ts — kapsam-dışı node'lar için MİNİMAL stub emitter.
 *
 * @deprecated GERÇEK ÜRETİMDE TETİKLENMEZ. EMITTER_REGISTRY'de (index.ts)
 *   bu emitter HİÇ yer almaz; bir node'u stub'a hiçbir kayıt yönlendirmez.
 *   Bu yalnız doğrudan/test çağrısı ile (stub.emitter.spec.ts) çalışan, geçmişe
 *   dönük korunan bir fallback'tır.
 *
 * NEDEN ARTIK ÖLÜ YOL: bir zamanlar v1 backend zinciri DIŞINDA kalan tipler
 *   (Cache, MessageQueue, Worker, APIGateway, EventHandler, Orchestrator,
 *   ExternalService, Middleware, View) bu emitter'a düşerdi. Artık HEPSİNİN
 *   tam emitter'ı var (registry supported: true) -> stub'a düşmezler.
 *   Geriye yalnız kapsam-DIŞI üç tip kalır ve onlar da stub ÜRETMEZ:
 *     - FrontendApp / UIComponent -> EXCLUDED_KINDS (registry'de yok);
 *       codegen.service isExcluded ile hiç DOSYA üretmeden skippedKinds'e sayar.
 *     - EnvironmentVariable -> registry'de yok; scaffold config'i temsil eder,
 *       kod modülü değil; yine hiç dosya üretilmez.
 *   Net: bugün canlı codegen'de bu emitter'a 0 node akar.
 *
 * Davranış (doğrudan çağrıldığında) hâlâ doğru ve test'lidir; minimal bir
 * iskelet dosya bırakır: node SESSİZCE DÜŞMESİN; graph'taki yeri (in/out edge
 * özeti) kayıt altına alınsın, Surgical AI'ye işaretli bir nokta kalsın.
 *
 * Sözleşme:
 *   - default export YOK; named `export const emitStub: NodeEmitter`.
 *   - SAF fonksiyon: (node, ctx) -> GeneratedFile[]. I/O yok, throw yok.
 *   - Yol her zaman filePathFor(node, ctx.graph) ile (hardcode YASAK).
 *   - İçerik DETERMİNİSTİK: edge özeti isme göre sıralı, timestamp/random yok.
 *   - import'lar ImportCollector ile; içerik tek "\n" ile biter.
 *
 * NOT: stub'lanan tipler PropsByKind içinde DEĞİL — propsOf<...> KULLANILAMAZ.
 * Tek güvenli alan node.name (ir tarafından çözülmüş) + generic Description.
 * ──────────────────────────────────────────────────────────────────────── */

/** Service'e DI ile enjekte edilebilen stub kind'ları.
 *  @deprecated EFEKTİF OLARAK BOŞ: Cache + ExternalService artık tam emitter'lı
 *  (registry supported: true) -> emitStub'a hiç düşmezler. Bu set yalnız doğrudan
 *  test çağrısında (geçmişe-dönük) @Injectable() davranışını korur; canlı
 *  üretimde hiçbir node bu kümeye eşleşmez. */
const INJECTABLE_STUB_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(["Cache", "ExternalService"]);

/** Bir stub node'unun export ettiği sınıf adı (TEK KAYNAK). "ImageResultCache"
 *  -> "ImageResultCacheStub". module.emitter bunu provider import'u için kullanır. */
export function stubClassName(node: CodeNode): string {
  return `${pascalCase(node.name) || pascalCase(node.kindOf())}Stub`;
}

/** Bir stub node'unun dosya yolu (TEK KAYNAK = filePathFor default kolu). */
export function stubFilePath(node: CodeNode, graph: CodeGraph): string {
  return filePathFor(node, graph);
}

export const emitStub: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const kind = node.kindOf();
  const className = stubClassName(node);
  const description = readDescription(node);
  // Enjekte edilebilen stub'lar (Cache/ExternalService) @Injectable() olmalı —
  // module providers'ına eklenir, NestJS DI bootta çözer.
  const isInjectable = INJECTABLE_STUB_KINDS.has(kind);

  // Stub yer tutucu import gerektirmez; deseni göstermek için collector kurulur.
  const imports = new ImportCollector();
  if (isInjectable) imports.add("Injectable", "@nestjs/common");

  const lines: string[] = [];

  // Üst banner — bu node'un neden kod üretmediğini ve ne olduğunu açıklar.
  lines.push("/**");
  lines.push(` * ${kind} — out-of-scope node (the v1 backend chain does not generate it).`);
  lines.push(" *");
  lines.push(" * This file is intentionally a STUB: generated so the node is not dropped from the graph.");
  lines.push(" * Surgical AI fills in the target behavior at the marked point below.");
  lines.push(" */");

  // Kapsam-dışı surgical marker (member YOK -> id=<nodeId>#stub).
  lines.push(`// @solarch:surgical id=${node.id}#stub`);
  lines.push(`// out-of-scope: ${kind} "${node.name}" is not deterministically generated in v1`);
  if (description) lines.push(`// ${description}`);

  // Edge özeti — node'un graph'taki bağlantıları (deterministik, isme göre sıralı).
  const edgeLines = buildEdgeSummary(node, ctx);
  if (edgeLines.length > 0) {
    lines.push("//");
    lines.push("// edges:");
    for (const el of edgeLines) lines.push(`//   ${el}`);
  } else {
    lines.push("//");
    lines.push("// edges: (none)");
  }

  // Boş placeholder sınıf — sessizce düşmesin; export edilir. Enjekte edilen
  // stub'lar @Injectable() taşır (module providers'ına eklenir -> boot DI).
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

/** node.properties.Description'ı güvenle okur (12 tipte de var ama tip-dışı). */
function readDescription(node: CodeNode): string {
  const desc = (node.properties as Record<string, unknown>).Description;
  return typeof desc === "string" ? desc.trim() : "";
}

/* ── Edge özeti ─────────────────────────────────────────────────────────────
 * Çıkan ("-> KIND Name") ve gelen ("<- KIND Name") edge'leri tek satırlık
 * özetlere çevirir. CodeGraph zaten edge'leri kind,source,target,id'ye göre
 * sıralı tuttuğundan outEdges/inEdges sıralı gelir; çıktı deterministiktir.
 * Çözülemeyen uç (kayıp ref) -> "(?)" ile gösterilir, ASLA throw edilmez. */
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

/** Bir edge ucunu "KIND Name" biçiminde betimler; uç çözülemezse "(?)". */
function describeRef(ref: CodeNode | null): string {
  if (!ref) return "(?)";
  const name = ref.name || "(unnamed)";
  return `${ref.kindOf()} ${name}`;
}
