import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getClerkToken } from "./client";

/** API key metadata — the plaintext key is returned only once, in the create response. */
export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getClerkToken();
  const res = await fetch(`/api/v1${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Request failed"), {
      code: body?.error?.code,
    });
  }
  return body.data as T;
}

export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: () => request<{ keys: ApiKeyRecord[] }>("/api-keys").then((d) => d.keys),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      request<{ key: string } & ApiKeyRecord>("/api-keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<{ deleted: boolean }>(`/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}
