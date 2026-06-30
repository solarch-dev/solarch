/** Utilities that convert [[node:ID|Name]] and [[edge:ID|Name]] markers in
 *  Markdown text into React components (NodeChip / EdgeChip).
 *
 *  During streaming, chunk boundaries may split a marker in half
 *  (e.g. "[[node:" chunk-1, "abc|X]]" chunk-2). safeText() hides unclosed
 *  markers — renders as chip as soon as it closes (smooth UX). */

import { Children, type ReactNode } from "react";
import { NodeChip, EdgeChip } from "./node-chip";
import type { TabGraphData } from "../../api/tabs";

const MARKER_REGEX = /\[\[(node|edge):([^|\]]+)\|([^\]]+)\]\]/g;

/** Sentence/block splitting — for step-by-step guided playback.
 *  Sentence terminator [.!?] + (whitespace|newline|EOF). Markdown headings
 *  and list items count as their own "sentence" (they end with newline).
 *  buffer: last incomplete sentence (stream may still be in progress). */
export function splitSentences(text: string): { sentences: string[]; buffer: string } {
  const sentences: string[] = [];
  let lastIdx = 0;
  // Markdown heading or bullet item: line ending with \n counts as its own sentence
  // Standard sentence: whitespace/newline/EOF after [.!?]
  const re = /([.!?][)"”]?\s+|\n\s*\n|^#{1,6} [^\n]+\n)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const endIdx = m.index + m[0].length;
    const sent = text.slice(lastIdx, endIdx);
    if (sent.trim().length > 0) sentences.push(sent);
    lastIdx = endIdx;
  }
  return { sentences, buffer: text.slice(lastIdx) };
}

/** Extract all [[node:ID|name]] and [[edge:ID|name]] markers from text.
 *  Order matters for sequential focus. */
export function extractMarkers(text: string): Array<{ kind: "node" | "edge"; id: string; name: string }> {
  const markers: Array<{ kind: "node" | "edge"; id: string; name: string }> = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MARKER_REGEX.source, "g");
  while ((m = re.exec(text)) !== null) {
    markers.push({ kind: m[1] as "node" | "edge", id: m[2].trim(), name: m[3].trim() });
  }
  return markers;
}

/** Stream-safe — if there's an unclosed [[ ... at the end, cut up to that point.
 *  Renders fully as soon as the marker closes. */
export function safeText(text: string): string {
  const lastOpen = text.lastIndexOf("[[");
  const lastClose = text.lastIndexOf("]]");
  if (lastOpen === -1) return text;
  if (lastClose > lastOpen) return text; // last [[ is already closed
  return text.slice(0, lastOpen);
}

/** Split a string into parts: plain text + NodeChip/EdgeChip JSX. */
export function renderTextWithChips(
  text: string,
  focusedSet: Set<string>,
  graph: TabGraphData | null,
  focusOnMount: boolean = true,
): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  MARKER_REGEX.lastIndex = 0;

  while ((m = MARKER_REGEX.exec(text)) !== null) {
    const [full, kind, rawId, rawName] = m;
    const id = rawId.trim();
    const name = rawName.trim();
    if (m.index > lastIdx) {
      parts.push(text.slice(lastIdx, m.index));
    }
    if (kind === "node") {
      const node = graph?.nodes.find((n) => n.id === id);
      parts.push(
        <NodeChip key={`n-${key++}-${id}`} id={id} name={name} type={node?.type} focusedSet={focusedSet} focusOnMount={focusOnMount} />,
      );
    } else {
      parts.push(
        <EdgeChip key={`e-${key++}-${id}`} id={id} name={name} focusedSet={focusedSet} focusOnMount={focusOnMount} />,
      );
    }
    lastIdx = m.index + full.length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts;
}

/** For react-markdown components prop: converts strings in p/li/strong/em children
 *  to chips. Non-string children (nested elements) pass through as-is.
 *  focusOnMount=false: chip does NOT auto-focus (sentence player orchestrator took over). */
export function processChildren(
  children: ReactNode,
  focusedSet: Set<string>,
  graph: TabGraphData | null,
  focusOnMount: boolean = true,
): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  Children.forEach(children, (child) => {
    if (typeof child === "string") {
      out.push(...renderTextWithChips(child, focusedSet, graph, focusOnMount).map((p, i) =>
        typeof p === "string" ? <span key={`s-${key++}-${i}`}>{p}</span> : p,
      ));
    } else {
      out.push(child);
    }
  });
  return out;
}
