/** Raw API calls outside hooks for undo/redo + autosave-flush. */

import type { QueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "./client";

function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

export const rawUpdateNodeProps = async (
  projectId: string,
  nodeId: string,
  properties: Record<string, unknown>,
  qc: QueryClient,
  expectedVersion?: number,
) => {
  const res = await fetch(`/api/v1/projects/${projectId}/nodes/${nodeId}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    credentials: "include",
    body: JSON.stringify({ properties, expectedVersion }),
  });
  await throwIfNotOk(res);
  qc.invalidateQueries({ queryKey: ["tab-graph"] });
  qc.invalidateQueries({ queryKey: ["node", projectId, nodeId] });
};

export const rawDeleteNode = async (
  projectId: string,
  nodeId: string,
  qc: QueryClient,
) => {
  const res = await fetch(`/api/v1/projects/${projectId}/nodes/${nodeId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await throwIfNotOk(res);
  qc.invalidateQueries({ queryKey: ["tab-graph"] });
  qc.removeQueries({ queryKey: ["node", projectId, nodeId] });
};

export const rawCreateNode = async (
  projectId: string,
  input: { type: string; homeTabId?: string; position: { x: number; y: number }; properties: Record<string, unknown> },
  qc: QueryClient,
): Promise<{ id: string }> => {
  const res = await fetch(`/api/v1/projects/${projectId}/nodes`, {
    method: "POST",
    headers: jsonHeaders(),
    credentials: "include",
    body: JSON.stringify({ projectId, ...input }),
  });
  await throwIfNotOk(res);
  const body = await res.json();
  qc.invalidateQueries({ queryKey: ["tab-graph"] });
  return body?.data ?? body;
};

export const rawCreateEdge = async (
  projectId: string,
  input: { sourceNodeId: string; targetNodeId: string; kind: string },
  qc: QueryClient,
): Promise<{ id: string; warning?: { code: string; message: string; suggestion?: string } }> => {
  const res = await fetch(`/api/v1/projects/${projectId}/edges`, {
    method: "POST",
    headers: jsonHeaders(),
    credentials: "include",
    body: JSON.stringify({
      projectId,
      ...input,
      properties: { IsAsync: ["PUBLISHES", "SUBSCRIBES"].includes(input.kind) },
    }),
  });
  await throwIfNotOk(res);
  const body = await res.json();
  qc.invalidateQueries({ queryKey: ["tab-graph"] });
  return body?.data ?? body;
};

export const rawDeleteEdge = async (
  projectId: string,
  edgeId: string,
  qc: QueryClient,
) => {
  const res = await fetch(`/api/v1/projects/${projectId}/edges/${edgeId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await throwIfNotOk(res);
  qc.invalidateQueries({ queryKey: ["tab-graph"] });
};
