/* ────────────────────────────────────────────────────────────────────────
 * imports.ts — DETERMINISTIC import block generation.
 *
 * Each emitter builds its ImportCollector, adds symbols, then gets sorted import
 * block via render(). Manual "import { X } from ..." FORBIDDEN — consistency and
 * determinism come from this class.
 *
 * Sorting rules (deterministic):
 *   1) Modules alphabetical (once), but with "side-type" ordering:
 *      - 3rd-party / packages (not starting with ./ or ../) FIRST
 *      - relative ("./", "../") AFTER
 *      each group alphabetically by module path internally.
 *   2) Per module, symbols alphabetical, deduplicated.
 *   3) Type-only imports on separate `import type { ... }` line
 *      (when same module has both value and type, value import carries inline
 *      `type` qualifier: import { A, type B }).
 * ──────────────────────────────────────────────────────────────────────── */

interface ModuleImports {
  /** value (runtime) symbols */
  values: Set<string>;
  /** type-only symbols */
  types: Set<string>;
  /** default import symbol (if any) */
  defaultName?: string;
  /** `import * as ns from "..."` namespace name (if any) */
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

  /** Add value (runtime) symbol: `import { symbol } from "..."`. */
  add(symbol: string, fromModulePath: string): this {
    const slot = this.slot(fromModulePath);
    slot.values.add(symbol);
    slot.types.delete(symbol); // value import covers type import
    return this;
  }

  /** Add type-only symbol: `import type { symbol } from "..."`. */
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

  /** Any imports? (render() returns "" when empty.) */
  get isEmpty(): boolean {
    return this.modules.size === 0;
  }

  /** Sorted import block — does NOT include trailing newline (emitter merges). */
  render(): string {
    const isRelative = (p: string) => p.startsWith(".") || p.startsWith("/");
    const paths = [...this.modules.keys()].sort((a, b) => {
      const ra = isRelative(a) ? 1 : 0;
      const rb = isRelative(b) ? 1 : 0;
      if (ra !== rb) return ra - rb; // packages first, relative after
      return a < b ? -1 : a > b ? 1 : 0;
    });

    const lines: string[] = [];
    for (const path of paths) {
      const slot = this.modules.get(path) as ModuleImports;
      const sortedValues = [...slot.values].sort();
      const sortedTypes = [...slot.types].sort();

      // default + namespace lines (separate)
      if (slot.defaultName) lines.push(`import ${slot.defaultName} from "${path}";`);
      if (slot.namespace) lines.push(`import * as ${slot.namespace} from "${path}";`);

      if (sortedValues.length > 0 && sortedTypes.length > 0) {
        // both value and type -> inline `type` qualifier
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

/** Sort mixed "type Foo" and "Foo" list by bare name. */
function byBareName(a: string, b: string): number {
  const bare = (s: string) => s.replace(/^type\s+/, "");
  const ba = bare(a);
  const bb = bare(b);
  return ba < bb ? -1 : ba > bb ? 1 : 0;
}
