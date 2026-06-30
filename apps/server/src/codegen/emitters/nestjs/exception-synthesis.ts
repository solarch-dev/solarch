import type { GeneratedFile } from "../../types";
import { propsOf, type CodeGraph } from "../../ir";
import { kebabCase, pascalCase, splitWords } from "../../naming";

/* ────────────────────────────────────────────────────────────────────────
 * exception-synthesis.ts — exception SYNTHESIS for declared-but-undefined Throws.
 *
 * Stitch (same family as entity-synthesis): a Service method declares `Throws=[X]`
 * but no Exception node named X exists in the graph. service.emitter writes a surgical
 * marker (`// throws: X`); fill's checkContract forces throwing X
 * (declared-throws realization) → fill emits `throw new X(...)` → but the class is
 * neither generated nor imported → TS2304. So fill HONORS the contract; it is told
 * to throw an exception with no Constructor.
 *
 * Fix: for each declared-but-undefined Throws entry, emit a minimal HttpException
 * subclass (same shape as real exception.emitter output: code+message+
 * status). Then the contract COMPILES. Class name/path is SINGLE SOURCE (synthException*)
 * — service.emitter imports and this emitter bind to the SAME symbol/file.
 *
 * PURE + DETERMINISTIC: graph read only, sorted by name, no side effects.
 * ──────────────────────────────────────────────────────────────────────── */

/** Export class name for synthesized exception (pascalCase) — SINGLE SOURCE. */
export function synthExceptionClassName(name: string): string {
  return pascalCase(name);
}

/** Project-relative file path for synthesized exception — SINGLE SOURCE.
 *  Same pattern as real exception.emitter (common feature): strip "Exception"/"Error"
 *  suffix, kebab + common/exceptions/<base>.exception.ts. */
export function synthExceptionFilePath(name: string): string {
  return `common/exceptions/${kebabCase(stripExceptionSuffix(name))}.exception.ts`;
}

/** "CartEmptyException"/"FooError" -> body name ("CartEmpty"/"Foo"); unchanged if no suffix. */
function stripExceptionSuffix(name: string): string {
  for (const suf of ["Exception", "Error"]) {
    if (name.length > suf.length && name.toLowerCase().endsWith(suf.toLowerCase())) {
      return name.slice(0, name.length - suf.length);
    }
  }
  return name;
}

/** Exception names declared in a Service method's Throws but not resolved to ANY
 *  Exception node (DEDUP + sorted by name). Synthetic classes are emitted for these;
 *  otherwise the fill contract (declared-throws) will not compile. */
export function undefinedThrownExceptions(graph: CodeGraph): string[] {
  const names = new Set<string>();
  for (const svc of graph.allOf("Service")) {
    for (const m of propsOf<"Service">(svc).Methods ?? []) {
      for (const exName of m.Throws ?? []) {
        if (typeof exName !== "string" || exName.length === 0) continue;
        if (graph.resolveRef("Exception", exName)) continue; // real node exists → emitter produces it
        names.add(exName);
      }
    }
  }
  return [...names].sort();
}

/** Emit a single synthetic exception class file (HttpException subclass,
 *  BAD_REQUEST default; optional message). Compatible with real exception.emitter shape —
 *  adding an Exception node to the diagram naturally replaces this. */
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
