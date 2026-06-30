import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import { API_URL } from "../lib/env";
import type { TabGraphData, TabGraphEdge, TabGraphMember } from "./tabs";

export interface ChatResult {
  reply: string;
  applied?: { idMap: Record<string, string>; nodeCount: number; edgeCount: number };
  attempts: number;
}

/** Legacy one-shot — chat() endpoint (monolithic apply_architecture_graph).
 *  Prefer useAiChatStream for streaming. */
export function useAiChat(projectId: string, tabId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (message: string) =>
      unwrap<ChatResult>(
        await api.POST("/api/v1/projects/{projectId}/ai/chat", {
          params: { path: { projectId } },
          body: { message, tabId: tabId ?? undefined } as never,
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tab-graph", projectId, tabId] });
      qc.invalidateQueries({ queryKey: ["tabs", projectId] });
    },
  });
}

// ────────────────────────────────────────────────────────────
// Streaming agent — SSE + atomic create_node/create_edge tools
// ────────────────────────────────────────────────────────────

type StreamStatus = "idle" | "streaming" | "done" | "error" | "paused";
export type AiMode = "agent" | "instruct";

interface BackendNode {
  id: string;
  type: string;
  projectId: string;
  position: { x: number; y: number };
  createdAt: string;
  updatedAt: string;
  version: number;
  properties: Record<string, unknown>;
}

interface BackendEdge {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
  properties: Record<string, unknown>;
}

export interface AiStreamState {
  status: StreamStatus;
  mode: AiMode;
  progress: { nodes: number; edges: number };
  /** instruct mode: live token-by-token accumulated text (typewriter).
   *  agent mode: unused (stays empty). */
  accumulatedText: string;
  /** done event message (final for both modes). */
  message: string | null;
  error: string | null;
  /** Whether the error is retryable (provider/timeout/connection) → show "Try again".
   *  Plan/quota (402) is NOT retryable (upgrade required). */
  retryable: boolean;
}

// ── Active stream counter ─────────────────────────────────────────────
// Canvas auto-triggers arrange on NEW edges arriving during AI generation;
// manually drawn edges don't trigger it. A module-level counter provides this
// distinction (independent of hook instances — OmniBar + InlineAiPrompt may run at once).
let activeStreams = 0;
let lastStreamEndAt = 0;
/** Whether AI generation is active — stream open OR just closed (post-stream
 *  invalidate/refetch edges also count as AI generation, trigger arrange). */
export function isAiActive(graceMs = 4000): boolean {
  return activeStreams > 0 || Date.now() - lastStreamEndAt < graceMs;
}

/** Live-listen to generated element ids (the inline suggestion flow fills its
 *  pending set with these). Called AFTER the cache update. */
export interface AiStreamCallbacks {
  onNode?: (id: string) => void;
  onEdge?: (id: string) => void;
  /** Backend terminal rollback — element deleted from DB, must drop from the set too. */
  onRemoved?: (id: string, kind: "node" | "edge") => void;
}

/** AI architect streaming — backend pushes SSE event after each create_node/create_edge
 *  tool execution. Hook incrementally updates React Query cache; canvas buildScene is
 *  diff-aware so new nodes appear with pop animation.
 *
 *  start(message): open new stream (abort previous if any).
 *  abort(): close active stream. */
export function useAiChatStream(projectId: string, tabId: string | null, callbacks?: AiStreamCallbacks) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  // Callback identity can change on every render (inline object) — read via ref
  // so that start() stays stable.
  const cbRef = useRef<AiStreamCallbacks | undefined>(callbacks);
  useEffect(() => {
    cbRef.current = callbacks;
  }, [callbacks]);
  // Last request (message+mode) — "Continue" reopens the same request with continue=true.
  const lastReqRef = useRef<{ message: string; mode: AiMode }>({ message: "", mode: "agent" });
  // React buffering: text-delta chunks land in useRef buffer; flushed to setState
  // once per frame via rAF → 60fps maintained, no render spam.
  const textBufferRef = useRef<string[]>([]);
  const flushScheduledRef = useRef(false);

  const [state, setState] = useState<AiStreamState>({
    status: "idle",
    mode: "agent",
    progress: { nodes: 0, edges: 0 },
    accumulatedText: "",
    message: null,
    error: null,
    retryable: false,
  });

  const flushText = useCallback(() => {
    flushScheduledRef.current = false;
    const chunks = textBufferRef.current;
    if (chunks.length === 0) return;
    textBufferRef.current = [];
    const concat = chunks.join("");
    setState((s) => ({ ...s, accumulatedText: s.accumulatedText + concat }));
  }, []);

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
      activeStreams = Math.max(0, activeStreams - 1);
      if (activeStreams === 0) lastStreamEndAt = Date.now();
    }
  }, []);

  const abort = useCallback(() => {
    close();
    setState((s) => ({ ...s, status: s.status === "streaming" ? "idle" : s.status }));
  }, [close]);

  const start = useCallback(
    (message: string, mode: AiMode = "agent", continueRun = false) => {
      if (!projectId || !message.trim()) return;
      close(); // close previous stream if any
      textBufferRef.current = [];
      lastReqRef.current = { message, mode }; // store for "Continue"

    // Same-origin EventSource uses credentials; no Authorization header needed.
      const baseUrl = API_URL;
      const params = new URLSearchParams({ message, mode });
      if (tabId) params.set("tabId", tabId);
      // "Continue": resume generation paused at step limit — backend sees existing
      // graph and completes gaps (won't re-create existing ones).
      if (continueRun) params.set("continue", "true");
      // Idempotency key — once per submission. EventSource auto-reconnect reopens
      // the same URL (same requestId) → backend rejects duplicate generation
      // (duplicate generation + duplicate nodes).
      params.set("requestId", crypto.randomUUID());
      const url = `${baseUrl}/api/v1/projects/${projectId}/ai/chat/stream?${params.toString()}`;

      setState({
        status: "streaming",
        mode,
        progress: { nodes: 0, edges: 0 },
        accumulatedText: "",
        message: null,
        error: null,
        retryable: false,
      });

      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;
      activeStreams += 1; // close() decrements (done/paused/error/abort/unmount all go through close)

      es.addEventListener("node", (e) => {
        const node = JSON.parse((e as MessageEvent).data) as BackendNode;
        const member: TabGraphMember = {
          id: node.id,
          type: node.type,
          properties: node.properties,
          position: node.position,
          version: node.version,
          isReference: false,
        };
        // UPSERT — agent can now update an existing node and re-emit the same id
        // (refactor). Instead of append, replace if id exists (no duplicate).
        let isNew = true;
        qc.setQueryData<TabGraphData | undefined>(["tab-graph", projectId, tabId], (old) => {
          if (!old) return old;
          isNew = !old.nodes.some((n) => n.id === member.id);
          return {
            ...old,
            nodes: isNew ? [...old.nodes, member] : old.nodes.map((n) => (n.id === member.id ? member : n)),
          };
        });
        // Counter increments only on creation; an update mustn't inflate "N nodes created".
        if (isNew) setState((s) => ({ ...s, progress: { ...s.progress, nodes: s.progress.nodes + 1 } }));
        cbRef.current?.onNode?.(node.id);
      });

      es.addEventListener("edge", (e) => {
        const edge = JSON.parse((e as MessageEvent).data) as BackendEdge;
        const item: TabGraphEdge = {
          id: edge.id,
          kind: edge.kind,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
        };
        qc.setQueryData<TabGraphData | undefined>(["tab-graph", projectId, tabId], (old) =>
          old ? { ...old, edges: [...old.edges, item] } : old,
        );
        setState((s) => ({ ...s, progress: { ...s.progress, edges: s.progress.edges + 1 } }));
        cbRef.current?.onEdge?.(edge.id);
      });

      es.addEventListener("removed", (e) => {
        // Terminal rollback — backend deleted orphan node; remove from cache.
        // (On error path done doesn't invalidate; this listener is the only cleanup.)
        const { id, kind } = JSON.parse((e as MessageEvent).data) as { id: string; kind: "node" | "edge" };
        qc.setQueryData<TabGraphData | undefined>(["tab-graph", projectId, tabId], (old) => {
          if (!old) return old;
          if (kind === "node") {
            return {
              ...old,
              nodes: old.nodes.filter((n) => n.id !== id),
              edges: old.edges.filter((ed) => ed.sourceNodeId !== id && ed.targetNodeId !== id),
            };
          }
          return { ...old, edges: old.edges.filter((ed) => ed.id !== id) };
        });
        cbRef.current?.onRemoved?.(id, kind);
      });

      es.addEventListener("text-delta", (e) => {
        const { delta } = JSON.parse((e as MessageEvent).data) as { delta: string };
        textBufferRef.current.push(delta);
        if (!flushScheduledRef.current) {
          flushScheduledRef.current = true;
          requestAnimationFrame(flushText);
        }
      });

      es.addEventListener("done", (e) => {
        const payload = JSON.parse((e as MessageEvent).data) as { message: string; counts?: { nodes: number; edges: number } };
        // Final flush — drain remaining buffer if any
        if (textBufferRef.current.length > 0) flushText();
        // Align progress with backend truth — after orphan rollback 'removed'
        // events don't decrement the counter, prevent inflated summary.
        setState((s) => ({ ...s, status: "done", message: payload.message, progress: payload.counts ?? s.progress }));
        close();
        if (mode === "agent") {
          // Truth sync — nodes/edges created in agent mode, align cache with backend
          qc.invalidateQueries({ queryKey: ["tab-graph", projectId, tabId] });
          qc.invalidateQueries({ queryKey: ["tabs", projectId] });
        }
        // 4h quota counter consumed → refresh the remaining-allowance badge.
      });

      es.addEventListener("paused", (e) => {
        // Step limit reached, work incomplete — orphans PRESERVED. Resumes with "Continue".
        const payload = JSON.parse((e as MessageEvent).data) as { message: string; counts?: { nodes: number; edges: number } };
        if (textBufferRef.current.length > 0) flushText();
        setState((s) => ({ ...s, status: "paused", message: payload.message, progress: payload.counts ?? s.progress }));
        close();
        // Partial generation written to DB → align cache with backend.
        qc.invalidateQueries({ queryKey: ["tab-graph", projectId, tabId] });
        qc.invalidateQueries({ queryKey: ["tabs", projectId] });
      });

      es.addEventListener("error", (e) => {
        const data = (e as MessageEvent).data;
        let errMsg = "AI connection lost.";
        let code: string | undefined;
        if (typeof data === "string") {
          try {
            const parsed = JSON.parse(data);
            errMsg = parsed.message ?? errMsg;
            code = parsed.code;
          } catch { /* ignore */ }
        }
        // Duplicate connection (reconnect dedupe) — original stream continues, don't show error to user.
        if (code === "ERR_DUPLICATE_REQUEST") {
          close();
          return;
        }
        // Provider/timeout/connection error → retryable (retry via lastReqRef).
        setState((s) => ({ ...s, status: "error", error: errMsg, retryable: true }));
        close();
      });
    },
    [projectId, tabId, qc, close, flushText],
  );

  // "Continue" — reopen last request with continue=true (resumes where it left off).
  const continueRun = useCallback(() => {
    const { message, mode } = lastReqRef.current;
    if (message) start(message, mode, true);
  }, [start]);

  // "Try again" — after a provider/timeout error, run the last request from SCRATCH (not continue).
  const retry = useCallback(() => {
    const { message, mode } = lastReqRef.current;
    if (message) start(message, mode, false);
  }, [start]);

  useEffect(() => close, [close]); // unmount cleanup

  return { ...state, start, abort, continueRun, retry };
}
