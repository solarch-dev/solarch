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
 * service-spec.emitter.ts — Service node basina bir Jest DAVRANIS testi
 * ISKELETI uretir (#11): <feature>/<base>.service.spec.ts, service dosyasinin
 * HEMEN yaninda.
 *
 * NEDEN davranis iskeleti: eski iskelet yalniz "DI resolves" smoke testi yaziyordu
 * ("servis var" der ama "siparis olusturur" demez -> sahte guven). Bu emitter
 * graph'taki Methods + Dependencies'ten her PUBLIC metot icin bir davranis
 * iskeleti cikarir:
 *   - Test.createTestingModule, gercek service'i + her bagimliligi MOCK provider
 *     ile kurar (her mock'un metotlari jest.fn() -> delegasyon assert edilebilir).
 *   - DI-resolves smoke testi AKTIF kalir (`it(...)` -> gercek regresyon korumasi).
 *   - Her public metot icin ATLANMIS (`it.skip`) bir davranis iskeleti uretilir:
 *     arrange/act/assert ipuclari yorum olarak birakilir. ATLANDIGI icin govde stub
 *     da olsa dolu da olsa jest'i KIRMAZ — eski surum "NOT_IMPLEMENTED throw eder"
 *     diye assert ediyordu, ama surgical metot dolunca bu assert bayatlayip fail
 *     ediyordu (kod dogru, test eski stub'i olcuyor). Dogru sozlesmeyi codegen aninda
 *     bilemeyiz (govde henuz yazilmadi) -> iskelet. Gelistirici un-skip edip gercek
 *     assert'leri yazar (or. `expect(orderRepository.save).toHaveBeenCalled()`).
 *
 * SAF + DETERMINISTIC: bagimliliklar/metotlar isme gore sirali, import'lar
 * ImportCollector ile, icerik tek "\n" ile biter, timestamp/random NONE. Node'a
 * bagli NOT (test dosyasi; GeneratedFile.nodeId tasimaz).
 * ──────────────────────────────────────────────────────────────────────── */

/** Service node'larindan davranis test iskeletleri uretir (her servis bir spec). */
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

  // ── DI bagimliliklari -> jest mock provider'lari (gercek DB/Redis gerektirmez) ──
  //   service.emitter ile ayni kume: Dependencies ∪ CALLS hedefleri (injectable).
  const deps = collectInjectedDeps(node, ctx);
  for (const dep of deps) {
    imports.add(dep.className, importPathOf(relativeImportPath(specPath, dep.filePath)));
  }

  // ── Yalniz PUBLIC metotlar test edilir (private/protected dis API degil) ──
  const methods = [...(propsOf<"Service">(node).Methods ?? [])]
    .filter((m) => (m.Visibility ?? "public") === "public")
    .sort((a, b) => cmp(a.MethodName, b.MethodName));

  const lines: string[] = [];
  lines.push(`/** Behavior test skeleton for ${className} (Solarch-generated). */`);
  lines.push(`describe("${className}", () => {`);
  lines.push(`  let ${instanceName}: ${className};`);

  // ── Mock bagimliliklar (jest.fn() metotlariyla — delegasyon assert edilebilir) ──
  // Her mock, bagimliligin GERCEK public metot adlarindan (Service.Methods /
  //   Repository.CustomQueries) kurulur; bilinmeyen yuzeyler bos `{}` ile kalir
  //   (DI yine cozulur). `as unknown as <Class>` ile useValue tip-uyumlu saglanir.
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

  // ── Smoke: DI cozuluyor (regression korumasi; tek basina yeterli NOT) ──
  lines.push("");
  lines.push('  it("is defined (DI resolves)", () => {');
  lines.push(`    expect(${instanceName}).toBeDefined();`);
  lines.push("  });");

  // ── Her public metot icin DAVRANIS iskeleti ──────────────────────────────
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

/* ── Davranis blogu: bir public metot icin ATLANMIS (it.skip) iskelet ──────────
 *
 * NEDEN it.skip (assert NOT): eski iskelet "metot NOT_IMPLEMENTED throw eder"
 * diye assert ediyordu — bu yalniz STUB icin gecerli. Surgical metot DOLUNCA govde
 * gercek davranisi yapar (artik NOT_IMPLEMENTED throw etmez) → assert BAYATLAR →
 * jest kirilir (kod dogru, test eski hâli olcuyor). Dogru sozlesmeyi codegen aninda
 * bilemeyiz (govde henuz yazilmadi), o yuzden bolge bir ISKELET'tir: `it.skip` ile
 * atlanir (jest "skipped" der, fail ETMEZ — ne stub ne dolu hâlde) + arrange/act/
 * assert ipuclari yorum olarak birakilir. Gelistirici un-skip edip gercek assert'leri
 * yazar. DI-resolves smoke testi (`it(...)`) AKTIF kalir (gercek regresyon korumasi). */
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
  // Atlanan iskelet: govde stub da olsa dolu da olsa fail etmez. Un-skip + gercek assert.
  out.push("    // Behavior skeleton — un-skip and replace the comments with real");
  out.push("    // arrange/act/assert once you've reviewed the filled method body.");
  out.push(`    it.skip("delegates to its dependencies", () => {`);
  // Arrange (yorum): mocklanan bagimliliklarin metotlarini stub'la.
  out.push("      // Arrange: stub the calls this method should delegate to, e.g.");
  const arrangeHints = delegationHints(deps);
  if (arrangeHints.length > 0) {
    for (const h of arrangeHints) out.push(`      //   ${h}`);
  } else {
    out.push("      //   <no resolvable dependencies — inject test doubles as needed>");
  }
  // Act (yorum): gercek argumanlarla cagir.
  out.push("      // Act:");
  out.push(`      //   const result = ${awaitKw}${instanceName}.${name}(${args});`);
  // Assert (yorum): gercek delegasyon/donus beklentileri.
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

/** Arrange iskeleti satirlari: her cozulen bagimliligin her mock metodu icin bir
 *  `dep.method.mockResolvedValue(... as never);` ipucu (yorum). Determinizm:
 *  deps + methodNames zaten sirali. */
function delegationHints(deps: ResolvedDep[]): string[] {
  const out: string[] = [];
  for (const dep of deps) {
    for (const mn of dep.methodNames) {
      out.push(`${dep.field}.${mn}.mockResolvedValue(undefined as never);`);
    }
  }
  return out;
}

/** Assert iskeleti satirlari: her mock metodu icin bir
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

/** Bir mock nesne literali uretir: bilinen metot adlari -> jest.fn(); hic metot
 *  yoksa bos `{}` (DI yine cozulur, yuzey bilinmiyor). */
function renderMockObject(methodNames: string[]): string {
  if (methodNames.length === 0) return "{}";
  return `{ ${methodNames.map((m) => `${m}: jest.fn()`).join(", ")} }`;
}

interface ResolvedDep {
  /** constructor alan adi = camelCase(name) (service.emitter ile ayni). */
  field: string;
  /** enjekte edilen sinif adi = pascalCase(name). */
  className: string;
  /** cozulen node'un dosya yolu (import icin). */
  filePath: string;
  /** mock'lanacak public metot adlari (Service.Methods / Repository.CustomQueries),
   *  isme gore sirali; bilinmiyorsa bos. */
  methodNames: string[];
}

/** Servisin enjekte ettigi (mock'lanacak) provider'lari cozer: property
 *  Dependencies ∪ CALLS edge hedefleri (Repository/Service/Cache/ExternalService),
 *  yalniz COZULEBILEN + TAM emitter'li olanlar (sinif adi pascalCase(name)).
 *  Cozulemeyen/stub ref'ler atlanir (mock uretmeyiz -> spec derlenebilir kalsin).
 *  Her dep icin public metot adlari (delegasyon mock'u) cikarilir.
 *  DEDUP + alan adina gore sirali (deterministik; service.emitter ile ayni sira). */
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

/** Bir bagimlilik node'unun dis API'sini olusturan public metot adlari (mock'a
 *  jest.fn() olarak konur). Determinizm: isme gore sirali + DEDUP.
 *   - Service          -> public Methods (Visibility public/default).
 *   - Repository       -> CustomQueries (uretilen repository sinifinin public yuzeyi).
 *   - Cache/ExternalService -> bilinmeyen yuzey (emitter'a kuplaj yok) -> bos.
 *  Bossa mock `{}` olur (DI yine cozulur). */
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

/** Deterministik string karsilastirmasi (service.emitter ile ayni). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ── Yerel tip: ServiceMethod (service.schema.ts ile ayni shape) ──────────── */
type ServiceMethod = NonNullable<ReturnType<typeof propsOf<"Service">>["Methods"]>[number];
