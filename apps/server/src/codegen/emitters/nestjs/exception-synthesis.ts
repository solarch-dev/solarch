import type { GeneratedFile } from "../../types";
import { propsOf, type CodeGraph } from "../../ir";
import { kebabCase, pascalCase, splitWords } from "../../naming";

/* ────────────────────────────────────────────────────────────────────────
 * exception-synthesis.ts — BİLDİRİLMİŞ-AMA-TANIMSIZ Throws için exception SENTEZİ.
 *
 * Dikiş (entity-synthesis ile aynı aile): bir Service metodu `Throws=[X]` bildirir
 * ama grafta X adında Exception node'u YOKTUR. service.emitter bunu surgical
 * marker'a yazar (`// throws: X`), fill'in checkContract'ı X'i FIRLATMAYA zorlar
 * (declared-throws realization) → fill `throw new X(...)` üretir → ama sınıf ne
 * üretilmiş ne import edilmiş → TS2304. Yani fill SÖZLEŞMEYE UYUYOR; Constructor
 * olmayan bir exception'ı fırlatmasını söylüyor.
 *
 * Çözüm: bildirilmiş-ama-tanımsız her Throws için minimal bir HttpException
 * alt-sınıfı üret (gerçek exception.emitter çıktısıyla aynı şekil: code+message+
 * status). Böylece kontrat DERLENİR. Sınıf adı/yolu TEK KAYNAK (synthException*)
 * — service.emitter import'u ve bu emitter AYNI sembole/dosyaya bağlanır.
 *
 * SAF + DETERMİNİSTİK: yalnız graf okuması, isme göre sıralı, yan etki yok.
 * ──────────────────────────────────────────────────────────────────────── */

/** Sentezlenen exception'ın export sınıf adı (pascalCase) — TEK KAYNAK. */
export function synthExceptionClassName(name: string): string {
  return pascalCase(name);
}

/** Sentezlenen exception'ın proje-köküne göreli dosya yolu — TEK KAYNAK.
 *  Gerçek exception.emitter (common feature) ile aynı kalıp: "Exception"/"Error"
 *  son-eki atılır, kebab + common/exceptions/<base>.exception.ts. */
export function synthExceptionFilePath(name: string): string {
  return `common/exceptions/${kebabCase(stripExceptionSuffix(name))}.exception.ts`;
}

/** "CartEmptyException"/"FooError" -> gövde adı ("CartEmpty"/"Foo"); son-ek yoksa olduğu gibi. */
function stripExceptionSuffix(name: string): string {
  for (const suf of ["Exception", "Error"]) {
    if (name.length > suf.length && name.toLowerCase().endsWith(suf.toLowerCase())) {
      return name.slice(0, name.length - suf.length);
    }
  }
  return name;
}

/** Bir Service metodunun Throws'unda bildirilmiş ama HİÇBİR Exception node'una
 *  çözülmeyen exception adları (DEDUP + isme göre sıralı). Bunlar için sentetik
 *  sınıf üretilir; aksi halde fill kontratı (declared-throws) derlenmez. */
export function undefinedThrownExceptions(graph: CodeGraph): string[] {
  const names = new Set<string>();
  for (const svc of graph.allOf("Service")) {
    for (const m of propsOf<"Service">(svc).Methods ?? []) {
      for (const exName of m.Throws ?? []) {
        if (typeof exName !== "string" || exName.length === 0) continue;
        if (graph.resolveRef("Exception", exName)) continue; // gerçek node var → emitter üretir
        names.add(exName);
      }
    }
  }
  return [...names].sort();
}

/** Tek bir sentetik exception sınıfı dosyası üretir (HttpException alt-sınıfı,
 *  BAD_REQUEST varsayılan; opsiyonel message). Gerçek exception.emitter şekliyle
 *  uyumlu — diyagrama bir Exception node'u eklenince doğal olarak onunla değişir. */
export function emitSyntheticException(name: string): GeneratedFile {
  const className = synthExceptionClassName(name);
  const code = splitWords(stripExceptionSuffix(name)).map((w) => w.toUpperCase()).join("_") || "ERROR";
  const lines = [
    `import { HttpException, HttpStatus } from "@nestjs/common";`,
    "",
    `/**`,
    ` * Solarch-synthesized exception — declared in a method's Throws but no Exception`,
    ` * node defined it in the diagram. Generated so the contract (the surgical body`,
    ` * throws it) compiles. Add an Exception node named "${className}" to set a`,
    ` * specific HTTP status / error code.`,
    ` */`,
    `export class ${className} extends HttpException {`,
    `  constructor(message = ${JSON.stringify(className)}) {`,
    `    super({ code: ${JSON.stringify(code)}, message }, HttpStatus.BAD_REQUEST);`,
    `  }`,
    `}`,
  ];
  return {
    path: synthExceptionFilePath(name),
    content: lines.join("\n") + "\n",
    language: "typescript",
    surgicalMarkers: 0,
  };
}
