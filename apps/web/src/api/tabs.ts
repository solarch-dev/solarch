import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";

export interface Tab {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  order: number;
  moduleNodeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TabGraphMember {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  position: { x: number; y: number };
  version: number; // optimistic concurrency — backend sends via memberFrom
  isReference: boolean;
  origin?: string;
  // Implementation counters (reported by the Solarch CLI / VS Code extension).
  implTotal?: number;
  implFilled?: number;
  implAi?: number;
}
export interface TabGraphEdge {
  id: string;
  kind: string;
  sourceNodeId: string;
  targetNodeId: string;
}
export interface TabGraphData {
  tab: Tab;
  nodes: TabGraphMember[];
  edges: TabGraphEdge[];
}

export function useTabGraph(projectId: string, tabId: string | null) {
  return useQuery({
    queryKey: ["tab-graph", projectId, tabId],
    queryFn: async () =>
      unwrap<TabGraphData>(
        await api.GET("/api/v1/projects/{projectId}/tabs/{tabId}/graph", {
          params: { path: { projectId, tabId: tabId! } },
        }),
      ),
    enabled: !!projectId && !!tabId,
  });
}

/** Save position after drag (owned → node.position, referenced → REFERENCES).
 *  Cache invalidate broader: so canvas refetch triggers on programmatic mutations
 *  like undo/redo. During drag the scene already does optimistic update — invalidate is idempotent. */
export function useSaveLayout(projectId: string, tabId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: { nodeId: string; x: number; y: number }[]) => {
      if (!tabId) return;
      await api.PATCH("/api/v1/projects/{projectId}/tabs/{tabId}/layout", {
        params: { path: { projectId, tabId } },
        body: { items } as never,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tab-graph"] }),
  });
}

export function useTabs(projectId: string) {
  return useQuery({
    queryKey: ["tabs", projectId],
    queryFn: async () =>
      unwrap<Tab[]>(
        await api.GET("/api/v1/projects/{projectId}/tabs", { params: { path: { projectId } } }),
      ),
    enabled: !!projectId,
  });
}

/** Create a new tab. moduleNodeId is optional (drill-down in the future). */
export function useCreateTab(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap<Tab>(
        await api.POST("/api/v1/projects/{projectId}/tabs", {
          params: { path: { projectId } },
          body: { name } as never,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tabs", projectId] }),
  });
}

/** Update tab name or order. */
export function useUpdateTab(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tabId, name }: { tabId: string; name?: string }) =>
      unwrap<Tab>(
        await api.PATCH("/api/v1/projects/{projectId}/tabs/{tabId}", {
          params: { path: { projectId, tabId } },
          body: { name } as never,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tabs", projectId] }),
  });
}

/** Delete tab. The default tab cannot be deleted (backend returns ERR_TAB_DEFAULT_DELETE).
 *  Owned nodes are moved to Main Architecture, references are removed. */
export function useDeleteTab(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tabId: string) =>
      api.DELETE("/api/v1/projects/{projectId}/tabs/{tabId}", {
        params: { path: { projectId, tabId } },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tabs", projectId] });
      qc.invalidateQueries({ queryKey: ["tab-graph", projectId] });
    },
  });
}
