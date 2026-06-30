import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import { rawDeleteEdge } from "./raw";

export interface StoredEdge {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: string;
  properties: Record<string, unknown>;
  // non-blocking rules warning (e.g. WARN_COND_001 empty table) — returned on success path
  warning?: { code: string; message: string; suggestion?: string };
}

export function useCreateEdge(projectId: string, tabId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sourceNodeId: string; targetNodeId: string; kind: string }) => {
      const res = await api.POST("/api/v1/projects/{projectId}/edges", {
        params: { path: { projectId } },
        body: {
          projectId,
          sourceNodeId: input.sourceNodeId,
          targetNodeId: input.targetNodeId,
          kind: input.kind,
          // IsAsync required; pub/sub edges are asynchronous.
          properties: { IsAsync: ["PUBLISHES", "SUBSCRIBES"].includes(input.kind) },
        } as never,
      });
      return unwrap<StoredEdge>(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tab-graph", projectId, tabId] }),
  });
}

export function useDeleteEdge(projectId: string) {
  const qc = useQueryClient();
  // rawDeleteEdge: Bearer + credentials + throwIfNotOk (ApiError.code preserved) + invalidate.
  return useMutation({
    mutationFn: (edgeId: string) => rawDeleteEdge(projectId, edgeId, qc),
  });
}
