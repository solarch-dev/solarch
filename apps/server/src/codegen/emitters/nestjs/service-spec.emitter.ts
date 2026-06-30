import type { EmitterContext, GeneratedFile } from "../../types";
import { propsOf, type CodeGraph, type CodeNode } from "../../ir";
import {
  filePathFor,
  importPathOf,
  pascalCase,
  camelCase,
  relativeImportPath,
} from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * service-spec.emitter.ts — Service node başına bir Jest DAVRANIŞ testi
 * İSKELETİ üretir (#11): <feature>/<base>.service.spec.ts, service dosyasının
 * HEMEN yanında.
 *
 * NEDEN davranış iskeleti: eski iskelet yalnız "DI resolves" smoke testi yazıyordu
 * ("servis var" der ama "sipariş oluşturur" demez -> sahte güven). Bu emitter
 * graph'taki Methods + Dependencies'ten her PUBLIC metot için bir davranış
 * iskeleti çıkarır:
 *   - Test.createTestingModule, gerçek service'i + her bağımlılığı MOCK provider
 *     ile kurar (her mock'un metotları jest.fn() -> delegasyon assert edilebilir).
 *   - DI-resolves smoke testi AKTİF kalır (`it(...)` -> gerçek regresyon koruması).
 *   - Her public metot için ATLANMIŞ (`it.skip`) bir davranış iskeleti üretilir:
 *     arrange/act/assert ipuçları yorum olarak bırakılır. ATLANDIĞI için gövde stub
 *     da olsa dolu da olsa jest'i KIRMAZ — eski sürüm "NOT_IMPLEMENTED throw eder"
 *     diye assert ediyordu, ama surgical metot dolunca bu assert bayatlayıp fail
 *     ediyordu (kod doğru, test eski stub'ı ölçüyor). Doğru sözleşmeyi codegen anında
 *     bilemeyiz (gövde henüz yazılmadı) -> iskelet. Geliştirici un-skip edip gerçek
 *     assert'leri yazar (ör. `expect(orderRepository.save).toHaveBeenCalled()`).
 *
 * SAF + DETERMİNİSTİK: bağımlılıklar/metotlar isme göre sıralı, import'lar
 * ImportCollector ile, içerik tek "\n" ile biter, timestamp/random YOK. Node'a
 * bağlı DEĞİL (test dosyası; GeneratedFile.nodeId taşımaz).
 * ──────────────────────────────────────────────────────────────────────── */

/** Service node'larından davranış test iskeletleri üretir (her servis bir spec). */
export function emitServiceSpecs(ctx: EmitterContext): GeneratedFile[] {
  const out: GeneratedFile[] = [];
  for (const svc of ctx.graph.allOf("Service")) {
    const f = buildServiceSpec(svc, ctx);
    if (f) out.push(f);
  }
  return out;
}

function buildServiceSpec(node: CodeNode, ctx: EmitterContext): GeneratedFile | null {
  const className = pascalCase(node.name);
  if (className.length === 0) return null;
  const servicePath = filePathFor(node, ctx.graph);
  // <feature>/<base>.service.ts -> <feature>/<base>.service.spec.ts.
  const specPath = servicePath.replace(/\.ts$/, ".spec.ts");
  const instanceName = camelCase(node.name) || "service";

  const imports = new ImportCollector();
  imports.add("Test", "@nestjs/testing");
  imports.add("TestingModule", "@nestjs/testing");
  imports.add(className, importPathOf(relativeImportPath(specPath, servicePath)));

  // ── DI bağımlılıkları -> jest mock provider'ları (gerçek DB/Redis gerektirmez) ──
  //   service.emitter ile aynı küme: Dependencies ∪ CALLS hedefleri (injectable).
  const deps = collectInjectedDeps(node, ctx);
  for (const dep of deps) {
    imports.add(dep.className, importPathOf(relativeImportPath(specPath, dep.filePath)));
  }

  // ── Yalnız PUBLIC metotlar test edilir (private/protected dış API değil) ──
  const methods = [...(propsOf<"Service">(node).Methods ?? [])]
    .filter((m) => (m.Visibility ?? "public") === "public")
    .sort((a, b) => cmp(a.MethodName, b.MethodName));

  const lines: string[] = [];
  lines.push(`/** Behavior test skeleton for ${className} (Solarch-generated). */`);
  lines.push(`describe("${className}", () => {`);
  lines.push(`  let ${instanceName}: ${className};`);

  // ── Mock bağımlılıklar (jest.fn() metotlarıyla — delegasyon assert edilebilir) ──
  // Her mock, bağımlılığın GERÇEK public metot adlarından (Service.Methods /
  //   Repository.CustomQueries) kurulur; bilinmeyen yüzeyler boş `{}` ile kalır
  //   (DI yine çözülür). `as unknown as <Class>` ile useValue tip-uyumlu sağlanır.
  if (deps.length > 0) {
    lines.push("");
    lines.push("  // Mocked dependencies — delegated methods are jest.fn() so calls can be asserted.");
    for (const dep of deps) {
      lines.push(`  const ${dep.field} = ${renderMockObject(dep.methodNames)};`);
    }
  }

  lines.push("");
  lines.push("  beforeEach(async () => {");
  if (deps.length > 0) {
    lines.push("    jest.clearAllMocks();");
  }
  lines.push("    const moduleRef: TestingModule = await Test.createTestingModule({");
  if (deps.length > 0) {
    lines.push("      providers: [");
    lines.push(`        ${className},`);
    for (const dep of deps) {
      lines.push(`        { provide: ${dep.className}, useValue: ${dep.field} as unknown as ${dep.className} },`);
    }
    lines.push("      ],");
  } else {
    lines.push(`      providers: [${className}],`);
  }
  lines.push("    }).compile();");
  lines.push("");
  lines.push(`    ${instanceName} = moduleRef.get<${className}>(${className});`);
  lines.push("  });");

  // ── Smoke: DI çözülüyor (regression koruması; tek başına yeterli DEĞİL) ──
  lines.push("");
  lines.push('  it("is defined (DI resolves)", () => {');
  lines.push(`    expect(${instanceName}).toBeDefined();`);
  lines.push("  });");

  // ── Her public metot için DAVRANIŞ iskeleti ──────────────────────────────
  for (const m of methods) {
    lines.push("");
    lines.push(...renderMethodBehavior(instanceName, m, deps));
  }

  lines.push("});");

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  return {
    path: specPath,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
}

/* ── Davranış bloğu: bir public metot için ATLANMIŞ (it.skip) iskelet ──────────
 *
 * NEDEN it.skip (assert DEĞİL): eski iskelet "metot NOT_IMPLEMENTED throw eder"
 * diye assert ediyordu — bu yalnız STUB için geçerli. Surgical metot DOLUNCA gövde
 * gerçek davranışı yapar (artık NOT_IMPLEMENTED throw etmez) → assert BAYATLAR →
 * jest kırılır (kod doğru, test eski hâli ölçüyor). Doğru sözleşmeyi codegen anında
 * bilemeyiz (gövde henüz yazılmadı), o yüzden bölge bir İSKELET'tir: `it.skip` ile
 * atlanır (jest "skipped" der, fail ETMEZ — ne stub ne dolu hâlde) + arrange/act/
 * assert ipuçları yorum olarak bırakılır. Geliştirici un-skip edip gerçek assert'leri
 * yazar. DI-resolves smoke testi (`it(...)`) AKTİF kalır (gerçek regresyon koruması). */
function renderMethodBehavior(
  instanceName: string,
  method: ServiceMethod,
  deps: ResolvedDep[],
): string[] {
  const name = method.MethodName;
  const isAsync = method.IsAsync === true;
  const args = (method.Parameters ?? []).map((p) => `/* ${p.Name} */`).join(", ");
  const awaitKw = isAsync ? "await " : "";

  const out: string[] = [];
  out.push(`  describe("${name}", () => {`);
  // Atlanan iskelet: gövde stub da olsa dolu da olsa fail etmez. Un-skip + gerçek assert.
  out.push("    // Behavior skeleton — un-skip and replace the comments with real");
  out.push("    // arrange/act/assert once you've reviewed the filled method body.");
  out.push(`    it.skip("delegates to its dependencies", () => {`);
  // Arrange (yorum): mocklanan bağımlılıkların metotlarını stub'la.
  out.push("      // Arrange: stub the calls this method should delegate to, e.g.");
  const arrangeHints = delegationHints(deps);
  if (arrangeHints.length > 0) {
    for (const h of arrangeHints) out.push(`      //   ${h}`);
  } else {
    out.push("      //   <no resolvable dependencies — inject test doubles as needed>");
  }
  // Act (yorum): gerçek argümanlarla çağır.
  out.push("      // Act:");
  out.push(`      //   const result = ${awaitKw}${instanceName}.${name}(${args});`);
  // Assert (yorum): gerçek delegasyon/dönüş beklentileri.
  out.push("      // Assert: replace with real delegation/return assertions, e.g.");
  const assertHints = assertionHints(deps);
  if (assertHints.length > 0) {
    for (const h of assertHints) out.push(`      //   ${h}`);
  } else {
    out.push("      //   expect(result).toEqual(/* expected */);");
  }
  out.push("    });");
  out.push("  });");
  return out;
}

/** Arrange iskeleti satırları: her çözülen bağımlılığın her mock metodu için bir
 *  `dep.method.mockResolvedValue(... as never);` ipucu (yorum). Determinizm:
 *  deps + methodNames zaten sıralı. */
function delegationHints(deps: ResolvedDep[]): string[] {
  const out: string[] = [];
  for (const dep of deps) {
    for (const mn of dep.methodNames) {
      out.push(`${dep.field}.${mn}.mockResolvedValue(undefined as never);`);
    }
  }
  return out;
}

/** Assert iskeleti satırları: her mock metodu için bir
 *  `expect(dep.method).toHaveBeenCalled();` ipucu (yorum). */
function assertionHints(deps: ResolvedDep[]): string[] {
  const out: string[] = [];
  for (const dep of deps) {
    for (const mn of dep.methodNames) {
      out.push(`expect(${dep.field}.${mn}).toHaveBeenCalled();`);
    }
  }
  return out;
}

/** Bir mock nesne literali üretir: bilinen metot adları -> jest.fn(); hiç metot
 *  yoksa boş `{}` (DI yine çözülür, yüzey bilinmiyor). */
function renderMockObject(methodNames: string[]): string {
  if (methodNames.length === 0) return "{}";
  return `{ ${methodNames.map((m) => `${m}: jest.fn()`).join(", ")} }`;
}

interface ResolvedDep {
  /** constructor alan adı = camelCase(name) (service.emitter ile aynı). */
  field: string;
  /** enjekte edilen sınıf adı = pascalCase(name). */
  className: string;
  /** çözülen node'un dosya yolu (import için). */
  filePath: string;
  /** mock'lanacak public metot adları (Service.Methods / Repository.CustomQueries),
   *  isme göre sıralı; bilinmiyorsa boş. */
  methodNames: string[];
}

/** Servisin enjekte ettiği (mock'lanacak) provider'ları çözer: property
 *  Dependencies ∪ CALLS edge hedefleri (Repository/Service/Cache/ExternalService),
 *  yalnız ÇÖZÜLEBİLEN + TAM emitter'lı olanlar (sınıf adı pascalCase(name)).
 *  Çözülemeyen/stub ref'ler atlanır (mock üretmeyiz -> spec derlenebilir kalsın).
 *  Her dep için public metot adları (delegasyon mock'u) çıkarılır.
 *  DEDUP + alan adına göre sıralı (deterministik; service.emitter ile aynı sıra). */
function collectInjectedDeps(node: CodeNode, ctx: EmitterContext): ResolvedDep[] {
  const graph = ctx.graph;
  const byId = new Map<string, ResolvedDep>();
  const FULL: ReadonlySet<string> = new Set(["Repository", "Service", "Cache", "ExternalService"]);

  const consider = (target: CodeNode | null): void => {
    if (!target) return;
    if (!FULL.has(target.kindOf())) return;
    if (target.id === node.id) return;
    byId.set(target.id, {
      field: camelCase(target.name),
      className: pascalCase(target.name),
      filePath: filePathFor(target, graph),
      methodNames: publicMethodNamesOf(target),
    });
  };

  const props = node.properties as { Dependencies?: { Kind: string; Ref: string }[] };
  for (const dep of props.Dependencies ?? []) {
    consider(graph.resolveRef(dep.Kind as never, dep.Ref));
  }
  for (const e of graph.outEdges(node.id, "CALLS")) {
    consider(graph.byId(e.targetNodeId));
  }

  return [...byId.values()].sort((a, b) => cmp(a.field, b.field));
}

/** Bir bağımlılık node'unun dış API'sini oluşturan public metot adları (mock'a
 *  jest.fn() olarak konur). Determinizm: isme göre sıralı + DEDUP.
 *   - Service          -> public Methods (Visibility public/default).
 *   - Repository       -> CustomQueries (üretilen repository sınıfının public yüzeyi).
 *   - Cache/ExternalService -> bilinmeyen yüzey (emitter'a kuplaj yok) -> boş.
 *  Boşsa mock `{}` olur (DI yine çözülür). */
function publicMethodNamesOf(dep: CodeNode): string[] {
  const names = new Set<string>();
  if (dep.kindOf() === "Service") {
    for (const m of propsOf<"Service">(dep).Methods ?? []) {
      if ((m.Visibility ?? "public") === "public") names.add(m.MethodName);
    }
  } else if (dep.kindOf() === "Repository") {
    const queries = (dep.properties as { CustomQueries?: { QueryName: string }[] }).CustomQueries ?? [];
    for (const q of queries) names.add(q.QueryName);
  }
  return [...names].sort(cmp);
}

/** Deterministik string karşılaştırması (service.emitter ile aynı). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ── Yerel tip: ServiceMethod (service.schema.ts ile aynı shape) ──────────── */
type ServiceMethod = NonNullable<ReturnType<typeof propsOf<"Service">>["Methods"]>[number];
