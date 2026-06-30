import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeNode } from "../../ir";
import { filePathFor, pascalCase, snakeCase } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * enum.emitter.ts — CANONICAL REFERENCE emitter.
 *
 * Other 10 emitter agents use this file as the template. Contract:
 *   - no default export; named `export const emitEnum: NodeEmitter`.
 *   - PURE function: (node, ctx) -> GeneratedFile[]. No I/O, no throw.
 *   - Path always via filePathFor(node, ctx.graph) (hardcode FORBIDDEN).
 *   - Content DETERMINISTIC: collections sorted, no timestamp/random.
 *   - imports via ImportCollector (Enum needs no imports but pattern holds).
 *   - surgicalMarkers counted with countSurgicalMarkers(content) (0 for Enum).
 *   - Content ends with single "\n".
 *
 * EnumNode -> common/enums/<e>.enum.ts. BackingType:
 *   - "string": each member gets a string literal value (Key if Value absent).
 *   - "int":    members get incrementing int from 0 (Value parsed if given;
 *               else previous+1 / sequential). Deterministic: Values order preserved.
 * ──────────────────────────────────────────────────────────────────────── */

export const emitEnum: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"Enum">(node);
  const enumName = pascalCase(node.name);
  const backing = props.BackingType ?? "string";

  // Enum generation needs no imports; collector set up to show the pattern.
  const imports = new ImportCollector();

  const lines: string[] = [];

  // Top doc comment (deterministic single block).
  if (props.Description) {
    lines.push(`/** ${props.Description} */`);
  }
  lines.push(`export enum ${enumName} {`);

  let intCounter = 0;
  for (const v of props.Values) {
    const key = sanitizeMemberKey(v.Key);
    if (v.Description) lines.push(`  /** ${v.Description} */`);
    if (backing === "int") {
      const intVal = resolveIntValue(v.Value, intCounter);
      intCounter = intVal + 1;
      lines.push(`  ${key} = ${intVal},`);
    } else {
      const strVal = v.Value !== undefined && v.Value !== "" ? v.Value : v.Key;
      lines.push(`  ${key} = ${JSON.stringify(strVal)},`);
    }
  }
  lines.push("}");

  // ── STATE MACHINE (L2): when Transitions given, emit transition map + guards ──
  lines.push(...emitTransitions(enumName, props));

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

/** TS enum member name: invalid chars -> "_", numeric prefix gets leading "_".
 *  Deterministic. */
function sanitizeMemberKey(raw: string): string {
  let key = raw.replace(/[^A-Za-z0-9_$]/g, "_");
  if (key.length === 0) key = "_";
  if (/^[0-9]/.test(key)) key = `_${key}`;
  return key;
}

/** int backing value: parse Value as number when possible, else use sequential counter. */
function resolveIntValue(value: string | undefined, fallback: number): number {
  if (value !== undefined && value !== "") {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return fallback;
}

/** STATE MACHINE (L2): when Transitions present, emit allowed-transition map +
 *  canTransition<Enum> + assert<Enum>Transition (throw on illegal transition).
 *  When absent returns empty array (enum stays pure). DETERMINISTIC: From/To sanitized
 *  to enum member Keys, only REAL members kept (tsc-safe), same From merged,
 *  output in Values order. Terminal states (no outgoing) omitted -> Partial<Record>. */
function emitTransitions(enumName: string, props: ReturnType<typeof propsOf<"Enum">>): string[] {
  const transitions = props.Transitions ?? [];
  if (transitions.length === 0) return [];

  // Canonical member order (Values) + valid member set (tsc-safe references).
  const order = props.Values.map((v) => sanitizeMemberKey(v.Key));
  const valid = new Set(order);

  // From -> To set (sanitize + valid members only; merge same From).
  const byFrom = new Map<string, Set<string>>();
  for (const t of transitions) {
    const from = sanitizeMemberKey(t.From);
    if (!valid.has(from)) continue;
    const tos = byFrom.get(from) ?? new Set<string>();
    for (const raw of t.To) {
      const to = sanitizeMemberKey(raw);
      if (valid.has(to)) tos.add(to);
    }
    if (tos.size > 0) byFrom.set(from, tos);
  }
  if (byFrom.size === 0) return [];

  const constName = `${snakeCase(enumName).toUpperCase()}_TRANSITIONS`;
  const out: string[] = [];
  out.push("");
  out.push(`/** Allowed ${enumName} transitions (state machine). States not listed are terminal. */`);
  out.push(`const ${constName}: Partial<Record<${enumName}, readonly ${enumName}[]>> = {`);
  for (const from of order) {
    const tos = byFrom.get(from);
    if (!tos) continue;
    const list = order.filter((k) => tos.has(k)).map((k) => `${enumName}.${k}`).join(", ");
    out.push(`  [${enumName}.${from}]: [${list}],`);
  }
  out.push("};");
  out.push("");
  out.push(`/** True if moving from \`from\` to \`to\` is a legal ${enumName} transition. */`);
  out.push(`export function canTransition${enumName}(from: ${enumName}, to: ${enumName}): boolean {`);
  out.push(`  return ${constName}[from]?.includes(to) ?? false;`);
  out.push("}");
  out.push("");
  out.push(`/** Throws if \`from\` -> \`to\` is not a legal ${enumName} transition (state-machine guard). */`);
  out.push(`export function assert${enumName}Transition(from: ${enumName}, to: ${enumName}): void {`);
  out.push(`  if (!canTransition${enumName}(from, to)) {`);
  out.push("    throw new Error(`Illegal " + enumName + " transition: ${from} -> ${to}`);");
  out.push("  }");
  out.push("}");
  return out;
}
