import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import { rawDeleteNode } from "./raw";

export interface NodeTypeSummary {
  id: string;
  family: string;
  familyLabel: string;
  description: string;
  nameKey: string;
}

/** 21 node types — static, long cache. */
export function useNodeTypes() {
  return useQuery({
    queryKey: ["node-types"],
    staleTime: Infinity,
    queryFn: async () => {
      const body = unwrap<{ types: NodeTypeSummary[]; total: number }>(await api.GET("/api/v1/node-types"));
      return body.types;
    },
  });
}

export function useCreateNode(projectId: string, tabId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { type: string; position: { x: number; y: number }; properties: Record<string, unknown> }) => {
      const res = await api.POST("/api/v1/projects/{projectId}/nodes", {
        params: { path: { projectId } },
        body: { projectId, homeTabId: tabId ?? undefined, ...input } as never,
      });
      return unwrap<StoredNode>(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tab-graph", projectId, tabId] }),
  });
}

export interface StoredNode {
  id: string;
  projectId: string;
  homeTabId: string;
  type: string;
  position: { x: number; y: number };
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  version: number; // optimistic concurrency
}

/** Single-node fetch for Inspector — runs when sidebar selection changes. */
export function useNode(projectId: string, nodeId: string | null) {
  return useQuery({
    queryKey: ["node", projectId, nodeId],
    enabled: !!projectId && !!nodeId,
    queryFn: async () =>
      unwrap<StoredNode>(
        await api.GET("/api/v1/projects/{projectId}/nodes/{nodeId}", {
          params: { path: { projectId, nodeId: nodeId! } },
        }),
      ),
  });
}

/** Project-wide node list by type — data source for NodeRefCombobox autocomplete.
 *  Tab-agnostic: lists Exception/DTO/Enum etc. from all tabs. */
export function useProjectNodes(projectId: string, type: string | null) {
  return useQuery({
    queryKey: ["project-nodes", projectId, type],
    enabled: !!projectId && !!type,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.GET("/api/v1/projects/{projectId}/nodes", {
        params: { path: { projectId }, query: { type: type! } as never },
      });
      const body = unwrap<{ nodes: StoredNode[]; total: number }>(res);
      return body.nodes;
    },
  });
}

/** Node deletion — backend DELETE /projects/:pid/nodes/:nodeId, 204 No Content + DETACH (edge cascade).
 *  Uses raw fetch (path may be missing from openapi schema), error message extracted from envelope.
 *  Cache invalidate: all tab-graphs (homeTabId may differ from active tabId) + clear node cache. */
export function useDeleteNode(projectId: string) {
  const qc = useQueryClient();
  // rawDeleteNode: Bearer + credentials + throwIfNotOk (ApiError.code preserved) +
  // tab-graph invalidate + node cache remove. Old manual fetch was giving 401 on
  // cookie-race and losing the error code.
  return useMutation({
    mutationFn: (nodeId: string) => rawDeleteNode(projectId, nodeId, qc),
  });
}

/** Inspector PATCH — properties partial update. Called debounced for auto-save.
 *  Cache invalidate broader: all tab-graphs (homeTabId may differ from active tabId) + node cache.
 *  tabId param is now optional/legacy — unnecessary with broader invalidate. */
export function useUpdateNode(projectId: string, nodeId: string | null, _tabId?: string | null) {
  const qc = useQueryClient();
  void _tabId;
  return useMutation({
    mutationFn: async (vars: { properties: Record<string, unknown>; expectedVersion?: number }) => {
      if (!nodeId) return undefined;
      const res = await api.PATCH("/api/v1/projects/{projectId}/nodes/{nodeId}", {
        params: { path: { projectId, nodeId } },
        // expectedVersion → backend optimistic concurrency guard (lost-update protection).
        body: { properties: vars.properties, expectedVersion: vars.expectedVersion } as never,
      });
      return unwrap<StoredNode>(res);
    },
    onSuccess: (result) => {
      // Write new version to cache IMMEDIATELY → prevent stale-version false-conflict
      // on consecutive autosaves (window before invalidate refetch).
      if (result && nodeId) {
        qc.setQueryData<StoredNode | undefined>(["node", projectId, nodeId], (old) =>
          old ? { ...old, version: result.version } : old,
        );
      }
      qc.invalidateQueries({ queryKey: ["node", projectId, nodeId] });
      // tab-graph cache PREFIX match — canvas refreshes regardless of which tab the node is on
      qc.invalidateQueries({ queryKey: ["tab-graph"] });
    },
    onError: (err) => {
      // Version conflict → server state + fresh version is re-fetched; Inspector
      // useEffect replaces draft with server data when serverProperties changes.
      const code = (err as { code?: string } | null)?.code;
      if (code === "ERR_VERSION_CONFLICT") {
        qc.invalidateQueries({ queryKey: ["node", projectId, nodeId] });
        qc.invalidateQueries({ queryKey: ["tab-graph"] });
      }
    },
  });
}
