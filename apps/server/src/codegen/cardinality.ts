/* ────────────────────────────────────────────────────────────────────────
 * cardinality.ts — SINGLE SOURCE for COLLECTION CARDINALITY.
 *
 * Does an operation (endpoint / service method) return singular or collection?
 * This decision is needed in MULTIPLE emitters (controller + service); if they rely
 * on different heuristics/word sets, signatures MISMATCH (controller XDto[], service
 * XDto -> compile error, ListProducts/ListOrders bug in surgical-output). So both
 * word set and derivation live in ONE place; emitters only read from here.
 *
 * Priority (both emitters APPLY):
 *   1) Declared field (Endpoint.ReturnsCollection / ServiceMethod.ReturnsCollection)
 *      — when set WINS (true or false). "Declared > inferred."
 *   2) Type already array (ReturnType "XDto[]" / "Array<...>").
 *   3) Name/route list-semantics fallback (list/all/search + findAll/findMany).
 *
 * PURE + DETERMINISTIC: input-dependent, side-effect free, EXACT word match.
 * ──────────────────────────────────────────────────────────────────────── */

/** Words that alone carry collection semantics (EXACT match — not substring;
 *  "listen"/"getAllowance" won't false-positive). */
const COLLECTION_WORDS: ReadonlySet<string> = new Set(["list", "all", "search"]);

/** Words collection-only in JOINED form ("findAll" -> "findall"). */
const COLLECTION_JOINED: ReadonlySet<string> = new Set(["findall", "findmany"]);

/** Do token array (splitWords output) carry collection semantics?
 *  controller (route segment) and service (method name) call THIS same function. */
export function tokensHaveCollectionSemantics(tokens: readonly string[]): boolean {
  const lower = tokens.map((t) => t.toLowerCase());
  if (COLLECTION_JOINED.has(lower.join(""))) return true;
  return lower.some((w) => COLLECTION_WORDS.has(w));
}

/** Is a TS type string already a collection? ("X[]" suffix or "Array<...>").
 *  Prevents double-wrapping declared/inferred collection ("XDto[]" -> "[][]" NOT). */
export function isArrayType(t: string): boolean {
  const s = t.trim();
  return s.endsWith("[]") || /^Array\s*</.test(s);
}
