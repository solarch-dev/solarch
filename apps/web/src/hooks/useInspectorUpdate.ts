/** Properties update + history tracking — shared across all inspectors.
 *  draft + debounced save + history record in one place.
 *
 *  DATA LOSS PROTECTION (4.3): pending debounce record is FLUSHED when node selection
 *  changes and when panel unmounts (previously clearTimeout discarded the last edit).
 *  Happy-path (same node, 500ms) goes through update.mutate → SaveStatus + version handling preserved.
 *  On switch/unmount the hook's `update` mutation may be bound to the new node, so RAW fetch
 *  (snapshotted explicit nodeId + expectedVersion) is used. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useUpdateNode } from "../api/nodes";
import { useHistory } from "../state/history";
import { rawUpdateNodeProps } from "../api/raw";

interface Pending {
  projectId: string;
  nodeId: string;
  next: Record<string, unknown>;
  before: Record<string, unknown>;
}

export function useInspectorUpdate(
  projectId: string,
  nodeId: string,
  serverProperties: Record<string, unknown>,
) {
  const update = useUpdateNode(projectId, nodeId);
  const qc = useQueryClient();

  const [draft, setDraft] = useState(serverProperties);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Last value written to backend — undo's "before"
  const savedRef = useRef(serverProperties);
  // Active node — so that flush onSuccess returning after node switch doesn't corrupt savedRef.
  const currentNodeIdRef = useRef(nodeId);
  currentNodeIdRef.current = nodeId;
  // Pending record (queue IMMEDIATELY snapshots: target identity + before). expectedVersion
  // is NOT snapshotted → read fresh at flush time (prevents self-inflicted false conflict).
  const pendingRef = useRef<Pending | null>(null);
  const timerRef = useRef<number | null>(null);

  // Happy-path flush (timer) — node still active; via mutation (SaveStatus + version).
  const flushViaMutation = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    // Read expectedVersion fresh at FLUSH time → on consecutive rapid edits the version
    // updated by our own in-flight mutation is used (no false conflict).
    const expectedVersion = qc.getQueryData<{ version?: number }>(["node", p.projectId, p.nodeId])?.version;
    update.mutate({ properties: p.next, expectedVersion }, {
      onSuccess: () => {
        if (!useHistory.getState().isReplaying) {
          useHistory.getState().record({
            undo: () => rawUpdateNodeProps(p.projectId, p.nodeId, p.before, qc),
            redo: () => rawUpdateNodeProps(p.projectId, p.nodeId, p.next, qc),
          });
        }
        // Only update savedRef if the SAME node is still active — otherwise onSuccess
        // returning after node switch corrupts another node's savedRef (undo writes to wrong node).
        if (currentNodeIdRef.current === p.nodeId) savedRef.current = p.next;
      },
    });
  }, [update, qc]);

  // Switch/unmount flush — pending record may belong to ANOTHER (old) node; since `update`
  // is bound to the new node, use RAW (explicit snapshot nodeId). Prevents data loss.
  const flushPendingRaw = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const expectedVersion = qc.getQueryData<{ version?: number }>(["node", p.projectId, p.nodeId])?.version;
    void rawUpdateNodeProps(p.projectId, p.nodeId, p.next, qc, expectedVersion)
      .then(() => {
        if (!useHistory.getState().isReplaying) {
          useHistory.getState().record({
            undo: () => rawUpdateNodeProps(p.projectId, p.nodeId, p.before, qc),
            redo: () => rawUpdateNodeProps(p.projectId, p.nodeId, p.next, qc),
          });
        }
      })
      .catch((e: unknown) => {
        // Conflict/error → server state is re-fetched (throwIfNotOk threw before invalidate).
        qc.invalidateQueries({ queryKey: ["node", p.projectId, p.nodeId] });
        qc.invalidateQueries({ queryKey: ["tab-graph"] });
        const code = (e as { code?: string } | null)?.code;
        if (code !== "ERR_VERSION_CONFLICT") {
          toast.error("Last change could not be saved", { description: e instanceof Error ? e.message : undefined });
        }
      });
  }, [qc]);

  // When node changes: FIRST flush the old node's pending record (prevent data loss), then reset.
  useEffect(() => {
    flushPendingRaw();
    setDraft(serverProperties);
    savedRef.current = serverProperties;
    // flushPendingRaw is stable ([qc]); adding to deps causes unnecessary re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverProperties, nodeId]);

  // Flush pending record on unmount (last edit should not be lost when panel closes).
  useEffect(() => () => { flushPendingRaw(); }, [flushPendingRaw]);

  const queueSave = useCallback((next: Record<string, unknown>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = { projectId, nodeId, next, before: savedRef.current };
    timerRef.current = window.setTimeout(flushViaMutation, 500);
  }, [projectId, nodeId, flushViaMutation]);

  const setField = useCallback((key: string, value: unknown) => {
    const next = { ...draftRef.current, [key]: value };
    setDraft(next);
    queueSave(next);
  }, [queueSave]);

  // Replace all properties (for drawers)
  const setAll = useCallback((next: Record<string, unknown>) => {
    setDraft(next);
    queueSave(next);
  }, [queueSave]);

  return { draft, setField, setAll, update };
}
