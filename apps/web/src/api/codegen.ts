/** Constructor codegen — backend generates a NestJS project skeleton from the node graph.
 *  schema.d.ts has no codegen path → typed api.POST is replaced by RAW fetch (raw.ts/client.ts). */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "./client";
import type { SystemMap } from "../features/simple/types";
import { API_URL } from "../lib/env";

/** A single generated file. Matches the backend contract. */
export interface GeneratedFile {
  path: string;
  content: string;
  language: "typescript" | "sql" | "json" | "markdown" | "env";
  /** Number of Surgical AI markers (edit points) in this file. */
  surgicalMarkers: number;
}

/** Full generation result. Matches the backend contract. */
export interface GeneratedProject {
  target: "nestjs";
  files: GeneratedFile[];
  /** Wire phase: which node mapped to which files (nodeId → path[]).
   *  The "Show Code" flow uses this to focus on the relevant node's first file. */
  nodeFiles: Record<string, string[]>;
  summary: {
    fileCount: number;
    nodeCount: number;
    surgicalMarkerCount: number;
    /** Node kinds that were not included in generation → count (e.g. { note: 2 }). */
    skippedKinds: Record<string, number>;
  };
}

/** Codegen mutation. Not called if projectId is missing (button only visible on project route).
 *  data → GeneratedProject (envelope.data). Error: throwIfNotOk → ApiError → global toast.
 *  On success the project's codegenVersion is stamped to CODEGEN_VERSION backend-side, so we
 *  invalidate ["codegen-status", projectId] → generated catches up to current → the TopBar
 *  "Codebase improved — Update" prompt disappears. */
export function useGenerateCode(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input?: { target?: "nestjs" },
    ): Promise<GeneratedProject> => {
      const res = await fetch(`/api/v1/projects/${projectId}/codegen`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: input?.target ?? "nestjs" }),
      });
      await throwIfNotOk(res);
      const body = (await res.json()) as { success: boolean; data: GeneratedProject };
      return body.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["codegen-status", projectId] });
    },
  });
}

/** Revert a filled surgical region back to its stub — deletes the saved (AI/human) body.
 *  After success the caller regenerates (useGenerateCode) so the region shows as a stub
 *  again. Idempotent on the backend. */
export function useRevertFill(projectId: string) {
  return useMutation({
    mutationFn: async (input: { nodeId: string; member: string }): Promise<void> => {
      const res = await fetch(
        `/api/v1/projects/${projectId}/codegen/fill/${encodeURIComponent(input.nodeId)}/${encodeURIComponent(input.member)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      await throwIfNotOk(res);
    },
  });
}

/** Codegen freshness for a project.
 *  - current:   the Constructor version this build of the backend produces.
 *  - generated: the Constructor version the project was last generated with
 *               (null → never generated).
 *  - updateAvailable: generated != null && generated < current — i.e. an older
 *               codebase exists and a better one can now be produced. (Never
 *               generated → false: there is nothing to "update", only first-time
 *               generation.) */
export interface CodegenStatus {
  current: number;
  generated: number | null;
  updateAvailable: boolean;
  /** The project's current structural graph revision. */
  graphRevision: number;
  /** Graph revision stamped at generation time; null if never generated. */
  generatedGraphRevision: number | null;
  /** Has the diagram changed structurally since generation (generated code is behind). */
  diagramDrifted: boolean;
  /** Number of structural changes since generation. */
  driftCount: number;
}

/** Reads the codegen freshness status for a project (ProjectAccessGuard on backend).
 *  Powers the TopBar "Codebase improved — Update" prompt. Disabled when projectId
 *  is missing so it never fires on non-project routes. */
export function useCodegenStatus(projectId: string | undefined) {
  return useQuery({
    queryKey: ["codegen-status", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<CodegenStatus> => {
      const res = await fetch(`/api/v1/projects/${projectId}/codegen/status`, {
        credentials: "include",
      });
      await throwIfNotOk(res);
      const body = (await res.json()) as { success: boolean; data: CodegenStatus };
      return body.data;
    },
  });
}

/** Simple View — the non-dev projection of the technical graph (feature map + capabilities).
 *  Generated deterministically backend-side (sibling of the Mermaid export); free, no AI. */
export function useSimpleView(projectId: string | undefined) {
  return useQuery({
    queryKey: ["simple-view", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<SystemMap> => {
      const res = await fetch(`/api/v1/projects/${projectId}/codegen/simple-view`, {
        credentials: "include",
      });
      await throwIfNotOk(res);
      const body = (await res.json()) as { success: boolean; data: SystemMap };
      return body.data;
    },
  });
}

export interface SimpleSketch { mermaid: string; source: "ai" | "deterministic" }

/** Mermaid for the hand-drawn Simple sketch (AI-refined + cached server-side). */
export function useSimpleSketch(projectId: string | undefined) {
  return useQuery({
    queryKey: ["simple-sketch", projectId],
    enabled: !!projectId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SimpleSketch> => {
      const res = await fetch(`/api/v1/projects/${projectId}/codegen/simple-sketch`, {
        credentials: "include",
      });
      await throwIfNotOk(res);
      const body = (await res.json()) as { success: boolean; data: SimpleSketch };
      return body.data;
    },
  });
}

/** Structured, Mermaid-free Simple-View model (ELK-laid-out + rough-rendered client-side). */
export type SketchNodeKind = "feature" | "action" | "data" | "decision" | "external" | "state";
export interface SketchModelNode { id: string; kind: SketchNodeKind; name: string; group?: string; color?: string }
export interface SketchModelEdge { from: string; to: string; label?: string }
export interface SketchModelGroup { id: string; name: string; color?: string }
export interface SimpleSketchModel { nodes: SketchModelNode[]; edges: SketchModelEdge[]; groups: SketchModelGroup[] }
/** `source`: did the AI refine names/colors ('ai') or is this the plain deterministic structure?
 *  `aiConfigured`: is the AI configured at all (key present)? Lets the UI tell "AI off" apart from
 *  "AI configured but the refine fell back" (source='deterministic' while aiConfigured=true). */
export interface SimpleSketchModelResp { model: SimpleSketchModel; source: "ai" | "deterministic"; aiConfigured: boolean }

export function useSimpleSketchModel(projectId: string | undefined, stage?: "baseline") {
  return useQuery({
    queryKey: ["simple-sketch-model", projectId, stage ?? "full"],
    enabled: !!projectId,
    // No client stale window: the server already caches in the DB (cheap to re-fetch), so always
    // pull fresh on open — otherwise a stale browser copy keeps showing an OLD diagram after the
    // server has regenerated. refetchOnMount: 'always' re-checks every time Simple View opens.
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<SimpleSketchModelResp> => {
      const url = `/api/v1/projects/${projectId}/codegen/simple-sketch-model${stage ? `?stage=${stage}` : ""}`;
      const res = await fetch(url, {
        credentials: "include",
      });
      await throwIfNotOk(res);
      const body = (await res.json()) as { success: boolean; data: SimpleSketchModelResp };
      return body.data;
    },
  });
}

/** Regenerate the Simple-View model — POSTs to bypass the server cache and re-run the AI refine,
 *  then writes the fresh result straight into the "full" query so the diagram updates in place.
 *  This is the "Regenerate" button: re-run the AI even when the graph hasn't changed. */
export function useRegenerateSketchModel(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<SimpleSketchModelResp> => {
      const res = await fetch(`/api/v1/projects/${projectId}/codegen/simple-sketch-model/regenerate`, {
        method: "POST",
        credentials: "include",
      });
      await throwIfNotOk(res);
      const body = (await res.json()) as { success: boolean; data: SimpleSketchModelResp };
      return body.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["simple-sketch-model", projectId, "full"], data);
    },
  });
}

// ────────────────────────────────────────────────────────────
// Surgical AI fill — SSE stream (server fills @solarch:surgical bodies)
// ────────────────────────────────────────────────────────────

export interface FillRegion {
  status: "filled" | "violation" | "error";
  /** The region's node UUID — for the live "writing" animation (locates the file+nodeId+member region). */
  nodeId?: string;
  member: string;
  file: string;
  attempts: number;
  /** The filled body (when status="filled") — streamed into the editor with a typewriter effect. */
  body?: string;
  /** WHY the region failed (status=violation/error): tsc/contract violations. Shown as
   *  "why" in the rail — the backend already carries this in the SSE region event. */
  violations?: string[];
  /** Error message if it could not be filled (error status). */
  error?: string;
}

/** Verify/repair phase — project-wide progress (tsc/jest loop, live).
 *  `modgraph` = NestJS module-graph gate (boot-time DI: cycles / missing import-export)
 *  repaired deterministically; closes wiring errors that pass tsc but crash at boot. */
export interface FillPhaseEntry {
  kind: "verify" | "repair" | "imports" | "tests" | "modgraph";
  round?: number;
  ok?: boolean;
  errorCount?: number;
  file?: string;
  member?: string;
  files?: number;
  skipped?: boolean;
  /** modgraph: number of deterministic repairs applied. */
  repairs?: number;
  /** modgraph: remaining unrepairable findings (ideally 0). */
  findings?: number;
}

/** Run mode: verified (tsc on the server) or draft (when the deps cache is absent). */
export interface FillMode {
  verified: boolean;
  withTests: boolean;
  reason?: string;
}

/** Agent ACTIVITY (observation) — a single tool action of the fill agent (opencode-style live stream).
 *  Arrives from the backend SSE `activity` event. The summary is SAFE (NO code body / secret value). */
export interface FillActivity {
  member: string;
  file: string;
  tool: "read" | "grep" | "glob" | "lookup_members" | "verify_fill";
  summary: string;
  ok?: boolean;
  attempt?: number;
}

export interface FillState {
  status: "idle" | "streaming" | "done" | "error";
  fileCount: number;
  markerCount: number;
  /** Whether verified / jest enabled — filled when the `mode` event arrives. */
  mode: FillMode | null;
  regions: FillRegion[];
  /** tsc/repair/test phase stream (live "watch the output"). */
  phases: FillPhaseEntry[];
  /** Agent activity stream (read/grep/verify_fill…) — opencode-style live watch. Capped. */
  activity: FillActivity[];
  filled: number;
  violations: number;
  errors: number;
  /** Last tsc/test gate result (from the report event). */
  typecheck: { ok: boolean } | null;
  tests: { ok: boolean; skipped?: boolean } | null;
  /** Final filled project (the `files` event) — null until done. */
  files: GeneratedFile[] | null;
  error: string | null;
  /** Whether the error is transient/retryable (provider/timeout/ERR_FILL_UNVERIFIED) — show "Try
   *  again". Plan/quota errors (402) are NOT retryable (upgrade required). */
  retryable: boolean;
}

const IDLE_FILL: FillState = {
  status: "idle", fileCount: 0, markerCount: 0, mode: null, regions: [], phases: [], activity: [],
  filled: 0, violations: 0, errors: 0, typecheck: null, tests: null, files: null, error: null, retryable: false,
};

/** Activity stream cap — a hard region calls many tools; keep only the last N so memory/render stay light. */
const ACTIVITY_CAP = 300;

/** Opens an EventSource to the Surgical AI fill stream. Accumulates per-region
 *  progress; on the terminal `files` event exposes the fully-filled project so the
 *  panel can swap the skeleton for the implemented code. Plan/quota denials (402)
 *  arrive as an SSE `error` event (never the global mutation toast) → handled here. */
export function useFillStream(projectId: string | undefined) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const [state, setState] = useState<FillState>(IDLE_FILL);

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const start = useCallback((opts?: { jest?: boolean }) => {
    if (!projectId) return;
    close();
    setState({ ...IDLE_FILL, status: "streaming" });
    // jest ("deep verify") is optional: tsc is always in the loop; jest is slow → toggle.
    const qs = opts?.jest ? "?jest=true" : "";
    const url = `${API_URL}/api/v1/projects/${projectId}/codegen/fill/stream${qs}`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.addEventListener("start", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { fileCount: number; markerCount: number };
      setState((s) => ({ ...s, fileCount: d.fileCount, markerCount: d.markerCount }));
    });
    es.addEventListener("mode", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as FillMode;
      setState((s) => ({ ...s, mode: d }));
    });
    es.addEventListener("phase", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as FillPhaseEntry;
      setState((s) => ({ ...s, phases: [...s.phases, d] }));
    });
    // The CLI's actual count of regions to fill (may differ from the marker count) —
    // use this as the counter denominator; arrives AFTER `start` and finalizes markerCount.
    es.addEventListener("begin", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { total: number };
      setState((s) => ({ ...s, markerCount: d.total }));
    });
    es.addEventListener("region", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as FillRegion;
      setState((s) => ({ ...s, regions: [...s.regions, d] }));
    });
    es.addEventListener("activity", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as FillActivity;
      setState((s) => ({ ...s, activity: [...s.activity, d].slice(-ACTIVITY_CAP) }));
    });
    es.addEventListener("report", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as {
        filled: number; violations: number; errors: number;
        typecheck?: { ok: boolean }; tests?: { ok: boolean; skipped?: boolean };
      };
      setState((s) => ({
        ...s, filled: d.filled, violations: d.violations, errors: d.errors,
        typecheck: d.typecheck ?? null, tests: d.tests ?? null,
      }));
    });
    es.addEventListener("files", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { files: GeneratedFile[] };
      setState((s) => ({ ...s, files: d.files, status: "done" }));
      close();
      qc.invalidateQueries({ queryKey: ["codegen-status", projectId] });
    });
    es.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data;
      let msg = "Surgical AI connection lost.";
      if (typeof data === "string") {
        try {
          const p = JSON.parse(data);
          msg = p.message ?? msg;
        } catch { /* native close after done → no data */ }
      }
      // Native error after done → don't clobber done.
      const retryable = true;
      setState((s) => (s.status === "done" ? s : { ...s, status: "error", error: msg, retryable }));
      close();
    });
  }, [projectId, qc, close]);

  const reset = useCallback(() => { close(); setState(IDLE_FILL); }, [close]);

  useEffect(() => close, [close]); // unmount cleanup
  return { ...state, start, reset };
}
