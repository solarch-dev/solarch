import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeNode } from "../../ir";
import { filePathFor, pascalCase, snakeCase } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * enum.emitter.ts — KANONİK REFERANS emitter.
 *
 * Diğer 10 emitter ajanı bu dosyayı örnek alır. Sözleşme:
 *   - default export YOK; named `export const emitEnum: NodeEmitter`.
 *   - SAF fonksiyon: (node, ctx) -> GeneratedFile[]. I/O yok, throw yok.
 *   - Yol her zaman filePathFor(node, ctx.graph) ile (hardcode YASAK).
 *   - İçerik DETERMİNİSTİK: koleksiyonlar sıralı, timestamp/random yok.
 *   - import'lar ImportCollector ile (Enum import gerektirmez ama desen budur).
 *   - surgicalMarkers countSurgicalMarkers(content) ile sayılır (Enum'da 0).
 *   - İçerik tek "\n" ile biter.
 *
 * EnumNode -> common/enums/<e>.enum.ts. BackingType:
 *   - "string": her üye string literal değer alır (Value yoksa Key kullanılır).
 *   - "int":    üyeler 0'dan artan int değer alır (Value verilmişse parse edilir;
 *               değilse önceki+1 / sırasal). Determinizm: Values verildiği sırada.
 * ──────────────────────────────────────────────────────────────────────── */

export const emitEnum: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"Enum">(node);
  const enumName = pascalCase(node.name);
  const backing = props.BackingType ?? "string";

  // Enum üretimi import gerektirmez; deseni göstermek için collector yine de kurulur.
  const imports = new ImportCollector();

  const lines: string[] = [];

  // Üst açıklama (deterministik tek satır).
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

  // ── STATE MACHINE (L2): Transitions verilirse geçiş-map + guard'lar üret ──
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

/** TS enum üye adı: geçersiz karakterleri "_" yapar, rakamla başlıyorsa "_"
 *  önekler. Deterministik. */
function sanitizeMemberKey(raw: string): string {
  let key = raw.replace(/[^A-Za-z0-9_$]/g, "_");
  if (key.length === 0) key = "_";
  if (/^[0-9]/.test(key)) key = `_${key}`;
  return key;
}

/** int backing değeri: Value sayıya parse edilebiliyorsa onu, değilse sıralı
 *  sayacı kullanır. */
function resolveIntValue(value: string | undefined, fallback: number): number {
  if (value !== undefined && value !== "") {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return fallback;
}

/** STATE MACHINE (L2): Transitions verilmişse enum'un yanına izinli-geçiş map'i +
 *  canTransition<Enum> + assert<Enum>Transition (illegal geçişte throw) üretir.
 *  Transitions yoksa boş dizi (enum saf kalır). DETERMİNİSTİK: From/To enum üye
 *  Key'lerine sanitize edilir, yalnız GERÇEK üyeler tutulur (tsc-güvenli), aynı
 *  From'lar birleştirilir, çıktı Values sırasında. Terminal durumlar (geçişi yok)
 *  map'te yer almaz -> Partial<Record>. */
function emitTransitions(enumName: string, props: ReturnType<typeof propsOf<"Enum">>): string[] {
  const transitions = props.Transitions ?? [];
  if (transitions.length === 0) return [];

  // Kanonik üye sırası (Values) + geçerli üye kümesi (tsc-güvenli referans).
  const order = props.Values.map((v) => sanitizeMemberKey(v.Key));
  const valid = new Set(order);

  // From -> To kümesi (sanitize + yalnız geçerli üyeler; aynı From birleşir).
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
