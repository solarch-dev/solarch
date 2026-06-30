/** Raw API calls outside hooks for undo/redo + autosave-flush.
 *  Hook onSuccess listeners are not triggered → no history loop.
 *  Auth: cookie + Bearer (getClerkToken) — same as openapi-fetch client, guards against
 *  cookie timing race. Errors: throwIfNotOk → no silent swallowing (caller/global handles). */

import type { QueryClient } from "@tanstack/react-query";
import { getClerkToken, throwIfNotOk } from "./client";
import { guestHeaders } from "../lib/guest";

async function authHeaders(json = true): Promise<Record<string, string>> {
  const token = await getClerkToken();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    // Clerk oturumu yoksa misafir bileti (varsa) devreye girer.
    ...(token ? { Authorization: `Bearer ${token}` } : guestHeaders()),
  };
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
    headers: await authHeaders(),
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
    headers: await authHeaders(false),
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
    headers: await authHeaders(),
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
    headers: await authHeaders(),
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
    headers: await authHeaders(false),
    credentials: "include",
  });
  await throwIfNotOk(res);
  qc.invalidateQueries({ queryKey: ["tab-graph"] });
};
