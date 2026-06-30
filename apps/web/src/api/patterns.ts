/** Pattern gallery — canonical seed patterns as starting points.
 *  GET /patterns (read-only, seed) drives the Welcome zero-state. Creating from a
 *  pattern is: create project → fetch the pattern's graph → atomic graph/apply.
 *  Raw fetch + envelope (same pattern as codegen.ts / review.ts). */

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { getClerkToken, throwIfNotOk } from "./client";
import { guestHeaders } from "../lib/guest";

export interface PatternSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  source: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
}

export interface PatternGraph {
  nodes: { tempId: string; type: string; properties: Record<string, unknown> }[];
  edges: { sourceTempId: string; targetTempId: string; edgeType: string; label?: string }[];
}

export interface StoredPattern extends PatternSummary {
  graph: PatternGraph;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getClerkToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : guestHeaders()),
  };
}

/** Canonical seed patterns (read-only). */
export function usePatterns() {
  return useQuery({
    queryKey: ["patterns"],
    queryFn: async (): Promise<PatternSummary[]> => {
      const res = await fetch("/api/v1/patterns", { credentials: "include", headers: await authHeaders() });
      await throwIfNotOk(res);
      const body = (await res.json()) as { success: boolean; data: PatternSummary[] };
      return body.data;
    },
  });
}

/** Full pattern graphs (for the gallery previews) — one query per id, cached
 *  forever (seed patterns are immutable). Fetched lazily when the sheet opens. */
export function usePatternDetails(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ["pattern", id],
      staleTime: Infinity,
      queryFn: async (): Promise<StoredPattern> => {
        const res = await fetch(`/api/v1/patterns/${id}`, { credentials: "include", headers: await authHeaders() });
        await throwIfNotOk(res);
        return ((await res.json()) as { data: StoredPattern }).data;
      },
    })),
  });
}

/** Create a new project and seed it with a pattern's (rules-legal) sub-graph. */
export function useCreateFromPattern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, patternId }: { name: string; patternId: string }): Promise<{ id: string }> => {
      const headers = await authHeaders();

      // 1. Create the project.
      const pres = await fetch("/api/v1/projects", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ name }),
      });
      await throwIfNotOk(pres);
      const project = ((await pres.json()) as { data: { id: string } }).data;

      // 2. Fetch the pattern's full graph (apply wire format).
      const gres = await fetch(`/api/v1/patterns/${patternId}`, { credentials: "include", headers });
      await throwIfNotOk(gres);
      const pattern = ((await gres.json()) as { data: StoredPattern }).data;

      // 3. Atomically apply the sub-graph to the new project.
      const ares = await fetch(`/api/v1/projects/${project.id}/graph/apply`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ mutations: { nodes: pattern.graph.nodes, edges: pattern.graph.edges } }),
      });
      await throwIfNotOk(ares);

      return { id: project.id };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}
