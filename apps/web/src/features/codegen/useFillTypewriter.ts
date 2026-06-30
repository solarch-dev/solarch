import { useEffect, useRef, useState } from "react";
import type { FillRegion, GeneratedFile } from "../../api/codegen";

/* ────────────────────────────────────────────────────────────────────────
 * useFillTypewriter — renders the surgical fill flow in the editor as if code
 * is "being written live". Each filled region (file + nodeId + member + body)
 * is queued; its body is typed line-by-line into the target file, and the
 * editor auto-navigates to that file/line. The backend fills regions in
 * PARALLEL, but the UI replays them sequentially (typing feel). When streaming
 * ends, the caller switches to the final files (fill.files).
 * ──────────────────────────────────────────────────────────────────────── */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Injects the FIRST n lines of a region's (nodeId#member) body into the
 *  skeleton content (typewriter). Replaces the NOT_IMPLEMENTED throw with the
 *  partial body; returns the cursor line (last visible body line, 0-based).
 *  Returns null if the region is not found or already filled. */
function injectPartialBody(
  content: string,
  nodeId: string,
  member: string,
  bodyLines: string[],
  n: number,
): { content: string; cursorLine: number } | null {
  const lines = content.split("\n");
  const markerRe = new RegExp(`@solarch:surgical\\s+id=${escapeRegex(nodeId)}#${escapeRegex(member)}(?:\\s|$)`);
  const mi = lines.findIndex((l) => markerRe.test(l));
  if (mi < 0) return null;
  let j = mi + 1;
  while (j < lines.length && /^\s*\/\//.test(lines[j]!)) j++;
  const thr = /^(\s*)throw new Error\("NOT_IMPLEMENTED:/.exec(lines[j] ?? "");
  if (!thr) return null; // already filled or unexpected format
  const indent = thr[1] ?? "";
  const revealed = bodyLines.slice(0, n).map((bl) => (bl.length > 0 ? `${indent}${bl}` : ""));
  const before = lines.slice(0, j);
  const after = lines.slice(j + 1);
  return {
    content: [...before, ...revealed, ...after].join("\n"),
    cursorLine: Math.max(0, before.length + revealed.length - 1),
  };
}

export interface FillTypewriter {
  liveFiles: Record<string, string>;
  activePath: string | null;
  typingLine: number | null;
}

export function useFillTypewriter(
  baseFiles: GeneratedFile[] | undefined,
  regions: FillRegion[],
  streaming: boolean,
): FillTypewriter {
  const [liveFiles, setLiveFiles] = useState<Record<string, string>>({});
  const [active, setActive] = useState<{ path: string; line: number } | null>(null);
  const baseRef = useRef<Record<string, string>>({}); // current base for each file (prior regions filled)
  const queueRef = useRef<FillRegion[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  // Reset when baseFiles change (new generate). Key by path signature (don't
  // reset if the ref changes but the content is the same).
  const baseKey = (baseFiles ?? []).map((f) => `${f.path}:${f.content.length}`).join("|");
  useEffect(() => {
    const m: Record<string, string> = {};
    for (const f of baseFiles ?? []) m[f.path] = f.content;
    baseRef.current = { ...m };
    setLiveFiles(m);
    setActive(null);
    queueRef.current = [];
    seenRef.current = new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);

  // Queue newly filled regions (with a body).
  useEffect(() => {
    for (const r of regions) {
      if (r.status !== "filled" || !r.body || !r.nodeId) continue;
      const key = `${r.nodeId}#${r.member}`;
      if (seenRef.current.has(key)) continue;
      seenRef.current.add(key);
      queueRef.current.push(r);
    }
  }, [regions]);

  // Typewriter driver — processes the queue throughout streaming.
  useEffect(() => {
    if (!streaming) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cur: { r: FillRegion; lines: string[]; n: number } | null = null;

    const schedule = (ms: number) => {
      timer = setTimeout(tick, ms);
    };
    function tick() {
      if (cancelled) return;
      if (!cur) {
        const next = queueRef.current.shift();
        if (!next) return schedule(120); // queue empty — wait
        cur = { r: next, lines: (next.body ?? "").split("\n"), n: 0 };
      }
      cur.n += 1;
      const { r, lines, n } = cur;
      const res = injectPartialBody(baseRef.current[r.file] ?? "", r.nodeId!, r.member, lines, n);
      if (res) {
        setLiveFiles((lf) => ({ ...lf, [r.file]: res.content }));
        setActive({ path: r.file, line: res.cursorLine });
      }
      if (n >= lines.length) {
        if (res) baseRef.current[r.file] = res.content; // commit full body to base (for the next region in the same file)
        cur = null;
        schedule(180); // brief pause between regions
      } else {
        // Speed up if the queue is long (don't fall behind); otherwise readable speed.
        schedule(queueRef.current.length > 4 ? 16 : 42);
      }
    }
    schedule(200);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [streaming]);

  return { liveFiles, activePath: active?.path ?? null, typingLine: active?.line ?? null };
}
