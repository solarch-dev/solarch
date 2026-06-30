/** OpenAPI docs — the architecture graph projected to an OpenAPI 3.1 document the client renders
 *  with Scalar. Mirrors the Simple-View model hooks (useSimpleSketchModel / useRegenerateSketchModel):
 *  the GET serves the deterministic baseline instantly or the persisted AI-enriched ("documentized")
 *  doc; the POST forces a fresh grounded enrichment. Free, no billing gate (no code is generated). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getClerkToken, throwIfNotOk } from "./client";
import { guestHeaders } from "../lib/guest";

/** Minimal structural view of the OpenAPI document (server type: `OpenAPIObject` from
 *  `@nestjs/swagger`). We only read `paths` (empty-state check) + `info`; Scalar consumes the
 *  whole object opaquely, so the rest stays loose. */
export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
  tags?: { name: string; description?: string }[];
}

/** `source`: did the AI annotate prose/examples ('ai') or is this the plain deterministic doc?
 *  `aiConfigured`: is the AI configured at all (key present)? Lets the UI tell "AI off" apart from
 *  "AI configured but the enrichment fell back" (source='deterministic' while aiConfigured=true). */
export interface OpenApiResp { doc: OpenApiDoc; source: "ai" | "deterministic"; aiConfigured: boolean }

/** The OpenAPI document for a project (ProjectAccessGuard on backend).
 *  `stage="baseline"` skips the AI for the instant deterministic doc. No client stale window: the
 *  server caches in the DB, so always pull fresh on open (refetchOnMount: 'always') — a stale browser
 *  copy would keep showing an OLD doc after the server regenerated. */
export function useOpenApi(projectId: string | undefined, stage?: "baseline") {
  return useQuery({
    queryKey: ["openapi", projectId, stage ?? "full"],
    enabled: !!projectId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<OpenApiResp> => {
      const token = await getClerkToken();
      const url = `/api/v1/projects/${projectId}/codegen/openapi.json${stage ? `?stage=${stage}` : ""}`;
      const res = await fetch(url, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : guestHeaders(),
      });
      await throwIfNotOk(res);
      const body = (await res.json()) as { success: boolean; data: OpenApiResp };
      return body.data;
    },
  });
}

/** AI Documentize — POSTs to bypass the server cache and re-run the grounded enrichment, then writes
 *  the fresh result straight into the "full" query so the rendered docs update in place. The structure
 *  stays graph-true; only descriptions/examples on existing operations/schemas change. */
export function useDocumentize(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<OpenApiResp> => {
      const token = await getClerkToken();
      const res = await fetch(`/api/v1/projects/${projectId}/codegen/openapi/documentize`, {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : guestHeaders(),
      });
      await throwIfNotOk(res);
      const body = (await res.json()) as { success: boolean; data: OpenApiResp };
      return body.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["openapi", projectId, "full"], data);
    },
  });
}
