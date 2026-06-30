import type { GeneratedFile, NodeEmitter } from "../../types";
import type { CodeNode } from "../../ir";
import { filePathFor, pascalCase } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";
import type { CacheNode } from "../../../nodes/schemas";

/* ────────────────────────────────────────────────────────────────────────
 * cache.emitter.ts — CacheNode -> <feature>/<base>.cache.ts.
 *
 * @Injectable() bir NestJS cache servisi üretir. @nestjs/cache-manager'ın
 * CACHE_MANAGER token'ı ile altta yatan store (Redis/Memcached/Memory) inject
 * edilir; tip cache-manager'ın `Cache` arabirimidir.
 *
 *   - KeyPattern: anahtar şablonu. "{...}" yer tutucuları varsa get/set/del
 *     bu yer tutucuların yerine geçen bir `suffix` parametresi alır; yoksa
 *     anahtar sabittir (parametresiz). buildKey() TEK KAYNAK anahtar üreticidir.
 *   - TTL_Seconds: set() için varsayılan TTL (cache-manager ms bekler -> *1000).
 *   - Engine: yalnız üst yorumda belgelenir (asıl store DI ile gelir; Wire
 *     fazı CacheModule.register ile bağlar).
 *
 * Metot gövdeleri GERÇEK impl'dir (get/set/del cache-manager'a delege eder) —
 * algoritma alanı YOKTUR, bu yüzden surgical marker GEREKMEZ.
 *
 * SAF + DETERMİNİSTİK: koleksiyon yok, import'lar ImportCollector ile,
 * timestamp/random yok, içerik tek "\n" ile biter.
 * ──────────────────────────────────────────────────────────────────────── */

/** Cache, ir.ts PropsByKind tablosunda DEĞİL (backend zinciri 9 tipi taşır) ->
 *  propsOf<"Cache"> derlenmez (TS2344). Tip doğrudan Zod-inferred şemadan alınır
 *  (DB zaten Zod-doğrulanmış; yalnız tip daraltma, çalışma zamanı dönüşümü yok). */
type CacheProps = CacheNode["properties"];

export const emitCache: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = node.properties as CacheProps;
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, ctx.graph);

  const keyPattern = props.KeyPattern;
  const ttlSeconds = props.TTL_Seconds;
  // "{...}" yer tutucusu varsa anahtar dinamik -> suffix parametresi gerekir.
  const isDynamicKey = /\{[^}]*\}/.test(keyPattern);

  const imports = new ImportCollector();
  imports.add("Inject", "@nestjs/common");
  imports.add("Injectable", "@nestjs/common");
  imports.add("CACHE_MANAGER", "@nestjs/cache-manager");
  imports.addType("Cache", "cache-manager");

  const lines: string[] = [];

  // ── Üst açıklama: Description + Engine + TTL (deterministik). ──────────────
  //   Engine/TTL/KeyPattern satırı her zaman anlamlıdır; Description satırı yalnız
  //   anlamlıysa (trim >=3 char) basılır -> "* s" gibi tek-harf gürültüsü olmasın.
  const hasDoc = typeof props.Description === "string" && props.Description.trim().length >= 3;
  lines.push("/**");
  if (hasDoc) {
    lines.push(` * ${props.Description.trim()}`);
    lines.push(" *");
  }
  lines.push(` * Engine: ${props.Engine} · TTL: ${ttlSeconds}s · KeyPattern: ${keyPattern}`);
  lines.push(" */");
  lines.push("@Injectable()");
  lines.push(`export class ${className} {`);

  // ── Sabitler: TTL (ms) + anahtar şablonu. ─────────────────────────────────
  lines.push(`  /** Default TTL (cache-manager expects milliseconds). */`);
  lines.push(`  private static readonly TTL_MS = ${ttlSeconds * 1000};`);
  lines.push(`  /** Key template (Cache.KeyPattern). */`);
  lines.push(`  private static readonly KEY_PATTERN = ${JSON.stringify(keyPattern)};`);
  lines.push("");

  // ── Constructor: CACHE_MANAGER inject. ────────────────────────────────────
  lines.push("  constructor(");
  lines.push("    @Inject(CACHE_MANAGER) private readonly cache: Cache,");
  lines.push("  ) {}");
  lines.push("");

  // ── buildKey: tek kaynak anahtar üreticisi. ───────────────────────────────
  if (isDynamicKey) {
    lines.push("  /** Replaces the first `{...}` placeholder in KeyPattern with the suffix. */");
    lines.push(`  private buildKey(suffix: string | number): string {`);
    lines.push(`    return ${className}.KEY_PATTERN.replace(/\\{[^}]*\\}/, String(suffix));`);
    lines.push("  }");
    lines.push("");
    // get/set/del — dinamik anahtar (suffix parametreli).
    lines.push(...method("get", "suffix: string | number", "Promise<T | null>", [
      "return this.cache.get<T>(this.buildKey(suffix));",
    ], true));
    lines.push("");
    lines.push(...method("set", `suffix: string | number, value: T, ttlSeconds?: number`, "Promise<void>", [
      // ttlSeconds verilirse ms'e çevir; yoksa varsayılan TTL_MS (zaten ms).
      `const ttl = ttlSeconds !== undefined ? ttlSeconds * 1000 : ${className}.TTL_MS;`,
      "await this.cache.set(this.buildKey(suffix), value, ttl);",
    ], true));
    lines.push("");
    lines.push(...method("del", "suffix: string | number", "Promise<void>", [
      "await this.cache.del(this.buildKey(suffix));",
    ], false));
  } else {
    lines.push("  /** Static key (no placeholder in KeyPattern). */");
    lines.push(`  private buildKey(): string {`);
    lines.push(`    return ${className}.KEY_PATTERN;`);
    lines.push("  }");
    lines.push("");
    // get/set/del — sabit anahtar (parametresiz).
    lines.push(...method("get", "", "Promise<T | null>", [
      "return this.cache.get<T>(this.buildKey());",
    ], true));
    lines.push("");
    lines.push(...method("set", `value: T, ttlSeconds?: number`, "Promise<void>", [
      // ttlSeconds verilirse ms'e çevir; yoksa varsayılan TTL_MS (zaten ms).
      `const ttl = ttlSeconds !== undefined ? ttlSeconds * 1000 : ${className}.TTL_MS;`,
      "await this.cache.set(this.buildKey(), value, ttl);",
    ], true));
    lines.push("");
    lines.push(...method("del", "", "Promise<void>", [
      "await this.cache.del(this.buildKey());",
    ], false));
  }

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

/** Tek bir async metodun satırlarını (imza + gövde) üretir. `generic` true ise
 *  metoda `<T>` tip parametresi eklenir (get/set değer tipi). Gövde GERÇEK
 *  impl'dir; algoritma alanı yoktur -> surgical marker yok. */
function method(
  name: string,
  params: string,
  returnType: string,
  bodyLines: string[],
  generic: boolean,
): string[] {
  const tp = generic ? "<T>" : "";
  const out: string[] = [`  async ${name}${tp}(${params}): ${returnType} {`];
  for (const bl of bodyLines) out.push(`    ${bl}`);
  out.push("  }");
  return out;
}
