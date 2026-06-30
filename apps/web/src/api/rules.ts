import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "./client";

export interface WhitelistRule {
  source: string | string[];
  edge: string;
  target: string | string[];
  layer?: string;
  note?: string;
}

/** Full rule matrix (whitelist) — static, long cache. */
export function useRules() {
  return useQuery({
    queryKey: ["rules"],
    staleTime: Infinity,
    queryFn: async () => {
      const body = unwrap<{ whitelist: WhitelistRule[] }>(await api.GET("/api/v1/rules"));
      return body.whitelist;
    },
  });
}

const asArr = (v: string | string[]) => (Array.isArray(v) ? v : [v]);

/** Allowed edge types for source → target (from the Rules Engine whitelist). */
export function legalEdgeKinds(whitelist: WhitelistRule[], src: string, tgt: string): { edge: string; note?: string }[] {
  const seen = new Set<string>();
  const out: { edge: string; note?: string }[] = [];
  for (const r of whitelist) {
    if (asArr(r.source).includes(src) && asArr(r.target).includes(tgt) && !seen.has(r.edge)) {
      seen.add(r.edge);
      out.push({ edge: r.edge, note: r.note });
    }
  }
  return out;
}

/** All (source type, edge kind) pairs that can connect to the target type — for input port drag. */
export function legalSources(
  whitelist: WhitelistRule[],
  tgt: string,
): { nodeType: string; edge: string; note?: string }[] {
  const seen = new Set<string>();
  const out: { nodeType: string; edge: string; note?: string }[] = [];
  for (const r of whitelist) {
    if (!asArr(r.target).includes(tgt)) continue;
    for (const s of asArr(r.source)) {
      const key = `${s}::${r.edge}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ nodeType: s, edge: r.edge, note: r.note });
      }
    }
  }
  return out;
}

/** All (target type, edge kind) pairs that can originate from the source type — for QuickConnectMenu. */
export function legalTargets(
  whitelist: WhitelistRule[],
  src: string,
): { nodeType: string; edge: string; note?: string }[] {
  const seen = new Set<string>();
  const out: { nodeType: string; edge: string; note?: string }[] = [];
  for (const r of whitelist) {
    if (!asArr(r.source).includes(src)) continue;
    for (const t of asArr(r.target)) {
      const key = `${t}::${r.edge}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ nodeType: t, edge: r.edge, note: r.note });
      }
    }
  }
  return out;
}
