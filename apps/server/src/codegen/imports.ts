/* ────────────────────────────────────────────────────────────────────────
 * imports.ts — DETERMİNİSTİK import bloku üretimi.
 *
 * Her emitter kendi ImportCollector'ını kurar, sembolleri ekler, sonunda
 * render() ile sıralı import blokunu alır. Elle "import { X } from ..." yazma
 * YASAK — tutarlılık ve determinizm bu sınıftan gelir.
 *
 * Sıralama kuralı (deterministik):
 *   1) Modüller alfabetik (bir kez), ama "yan-tip" sıralaması:
 *      - 3rd-party / paketler (./ veya ../ ile başlamayan) ÖNCE
 *      - göreli ("./", "../") SONRA
 *      her grup kendi içinde modül yoluna göre alfabetik.
 *   2) Her modül için semboller alfabetik, tekilleştirilmiş.
 *   3) Yalnız-tip importları `import type { ... }` olarak ayrı satıra çıkar
 *      (eğer aynı modülden hem değer hem tip varsa, değer importu `type`
 *      niteleyiciyle inline taşır: import { A, type B }).
 * ──────────────────────────────────────────────────────────────────────── */

interface ModuleImports {
  /** değer (runtime) sembolleri */
  values: Set<string>;
  /** yalnız-tip sembolleri */
  types: Set<string>;
  /** default import sembolü (varsa) */
  defaultName?: string;
  /** `import * as ns from "..."` namespace adı (varsa) */
  namespace?: string;
}

export class ImportCollector {
  private readonly modules = new Map<string, ModuleImports>();

  private slot(fromModulePath: string): ModuleImports {
    let slot = this.modules.get(fromModulePath);
    if (!slot) {
      slot = { values: new Set(), types: new Set() };
      this.modules.set(fromModulePath, slot);
    }
    return slot;
  }

  /** Değer (runtime) sembolü ekle: `import { symbol } from "..."`. */
  add(symbol: string, fromModulePath: string): this {
    const slot = this.slot(fromModulePath);
    slot.values.add(symbol);
    slot.types.delete(symbol); // değer importu tip importunu kapsar
    return this;
  }

  /** Yalnız-tip sembolü ekle: `import type { symbol } from "..."`. */
  addType(symbol: string, fromModulePath: string): this {
    const slot = this.slot(fromModulePath);
    if (!slot.values.has(symbol)) slot.types.add(symbol);
    return this;
  }

  /** Default import: `import Name from "..."`. */
  addDefault(name: string, fromModulePath: string): this {
    this.slot(fromModulePath).defaultName = name;
    return this;
  }

  /** Namespace import: `import * as ns from "..."`. */
  addNamespace(ns: string, fromModulePath: string): this {
    this.slot(fromModulePath).namespace = ns;
    return this;
  }

  /** Hiç import var mı? (boşsa render() "" döner.) */
  get isEmpty(): boolean {
    return this.modules.size === 0;
  }

  /** Sıralı import bloku — satır sonu dahil DEĞİL (emitter birleştirir). */
  render(): string {
    const isRelative = (p: string) => p.startsWith(".") || p.startsWith("/");
    const paths = [...this.modules.keys()].sort((a, b) => {
      const ra = isRelative(a) ? 1 : 0;
      const rb = isRelative(b) ? 1 : 0;
      if (ra !== rb) return ra - rb; // paketler önce, göreli sonra
      return a < b ? -1 : a > b ? 1 : 0;
    });

    const lines: string[] = [];
    for (const path of paths) {
      const slot = this.modules.get(path) as ModuleImports;
      const sortedValues = [...slot.values].sort();
      const sortedTypes = [...slot.types].sort();

      // default + namespace satırları (ayrı)
      if (slot.defaultName) lines.push(`import ${slot.defaultName} from "${path}";`);
      if (slot.namespace) lines.push(`import * as ${slot.namespace} from "${path}";`);

      if (sortedValues.length > 0 && sortedTypes.length > 0) {
        // hem değer hem tip -> inline `type` niteleyici
        const parts = [...sortedValues, ...sortedTypes.map((t) => `type ${t}`)].sort(byBareName);
        lines.push(`import { ${parts.join(", ")} } from "${path}";`);
      } else if (sortedValues.length > 0) {
        lines.push(`import { ${sortedValues.join(", ")} } from "${path}";`);
      } else if (sortedTypes.length > 0) {
        lines.push(`import type { ${sortedTypes.join(", ")} } from "${path}";`);
      }
    }
    return lines.join("\n");
  }
}

/** "type Foo" ve "Foo" karışık listede çıplak isme göre sırala. */
function byBareName(a: string, b: string): number {
  const bare = (s: string) => s.replace(/^type\s+/, "");
  const ba = bare(a);
  const bb = bare(b);
  return ba < bb ? -1 : ba > bb ? 1 : 0;
}
