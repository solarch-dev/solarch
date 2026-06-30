import type { GeneratedFile, NodeEmitter } from "../../types";
import type { CodeNode } from "../../ir";
import { filePathFor, pascalCase } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";
import type { CacheNode } from "../../../nodes/schemas";

/* ────────────────────────────────────────────────────────────────────────
 * cache.emitter.ts — CacheNode -> <feature>/<base>.cache.ts.
 *
 * Emits an @Injectable() NestJS cache service. Underlying store (Redis/Memcached/Memory)
 * is injected via @nestjs/cache-manager's CACHE_MANAGER token; type is cache-manager's
 * `Cache` interface.
 *
 *   - KeyPattern: key template. When "{...}" placeholders exist, get/set/del take a
 *     `suffix` param substituted into placeholders; otherwise key is fixed (no params).
 *     buildKey() is the SINGLE SOURCE key builder.
 *   - TTL_Seconds: default TTL for set() (cache-manager expects ms -> *1000).
 *   - Engine: documented in header comment only (actual store comes via DI; Wire
 *     phase binds via CacheModule.register).
 *
 * Method bodies are REAL impl (get/set/del delegate to cache-manager) —
 * no algorithm region, so no surgical marker needed.
 *
 * PURE + DETERMINISTIC: no collections, imports via ImportCollector,
 * no timestamp/random, content ends with single "\n".
 * ──────────────────────────────────────────────────────────────────────── */

/** Cache is NOT in ir.ts PropsByKind table (backend chain carries 9 types) ->
 *  propsOf<"Cache"> won't compile (TS2344). Type taken directly from Zod-inferred schema
 *  (DB is Zod-validated; type narrowing only, no runtime transform). */
type CacheProps = CacheNode["properties"];

export const emitCache: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = node.properties as CacheProps;
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, ctx.graph);

  const keyPattern = props.KeyPattern;
  const ttlSeconds = props.TTL_Seconds;
  // When "{...}" placeholder present, key is dynamic -> suffix param required.
  const isDynamicKey = /\{[^}]*\}/.test(keyPattern);

  const imports = new ImportCollector();
  imports.add("Inject", "@nestjs/common");
  imports.add("Injectable", "@nestjs/common");
  imports.add("CACHE_MANAGER", "@nestjs/cache-manager");
  imports.addType("Cache", "cache-manager");

  const lines: string[] = [];

  // ── Header: Description + Engine + TTL (deterministic). ──────────────
  //   Engine/TTL/KeyPattern line always meaningful; Description only when
  //   meaningful (trim >=3 char) -> avoid single-letter noise like "* s".
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

  // ── Constants: TTL (ms) + key template. ─────────────────────────────────
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

  // ── buildKey: single-source key builder. ───────────────────────────────
  if (isDynamicKey) {
    lines.push("  /** Replaces the first `{...}` placeholder in KeyPattern with the suffix. */");
    lines.push(`  private buildKey(suffix: string | number): string {`);
    lines.push(`    return ${className}.KEY_PATTERN.replace(/\\{[^}]*\\}/, String(suffix));`);
    lines.push("  }");
    lines.push("");
    // get/set/del — dynamic key (suffix param).
    lines.push(...method("get", "suffix: string | number", "Promise<T | null>", [
      "return this.cache.get<T>(this.buildKey(suffix));",
    ], true));
    lines.push("");
    lines.push(...method("set", `suffix: string | number, value: T, ttlSeconds?: number`, "Promise<void>", [
      // When ttlSeconds given convert to ms; else default TTL_MS (already ms).
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
    // get/set/del — fixed key (no params).
    lines.push(...method("get", "", "Promise<T | null>", [
      "return this.cache.get<T>(this.buildKey());",
    ], true));
    lines.push("");
    lines.push(...method("set", `value: T, ttlSeconds?: number`, "Promise<void>", [
      // When ttlSeconds given convert to ms; else default TTL_MS (already ms).
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

/** Produce lines for one async method (signature + body). `generic` true adds `<T>`
 *  type param (get/set value type). Body is REAL impl; no algorithm region -> no surgical marker. */
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
