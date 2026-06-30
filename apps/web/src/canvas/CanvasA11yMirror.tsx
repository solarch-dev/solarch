import { useRef } from "react";
import type { TabGraphData } from "../api/tabs";
import { nameOf, familyOf } from "./families";

/** INVISIBLE DOM mirror of the canvas for screen readers + keyboard.
 *
 *  Canvas pixels never reach the accessibility tree (WCAG) → the drawn graph is
 *  fully invisible to a screen reader. This list makes every node and its
 *  connections readable. Roving tabindex navigates with arrow keys; focusing an
 *  item makes the canvas select that node + pan the camera to it (visual ↔ a11y
 *  sync); Enter/Space opens the editor.
 *
 *  Visually hidden (sr-only) but focusable + announced — the canvas visual stays
 *  as-is for the sighted user. */
export function CanvasA11yMirror({
  graph,
  selectedId,
  onActivate,
  onOpen,
}: {
  graph: TabGraphData | undefined;
  selectedId: string | null;
  onActivate: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];

  if (!nodes.length) return null;

  // Connection blurbs: outgoing/incoming neighbors per node (name + edge kind).
  const nameById = new Map(nodes.map((n) => [n.id, nameOf(n.properties)]));
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const e of edges) {
    const tn = nameById.get(e.targetNodeId);
    const sn = nameById.get(e.sourceNodeId);
    if (tn) { const a = out.get(e.sourceNodeId) ?? []; a.push(`${e.kind} → ${tn}`); out.set(e.sourceNodeId, a); }
    if (sn) { const a = inc.get(e.targetNodeId) ?? []; a.push(`${sn} (${e.kind})`); inc.set(e.targetNodeId, a); }
  }

  const focusAt = (idx: number) => {
    listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-node]")[idx]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = nodes.length - 1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); focusAt(i === last ? 0 : i + 1); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); focusAt(i === 0 ? last : i - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    else if (e.key === "End") { e.preventDefault(); focusAt(last); }
  };

  // Roving tabindex: selected node (or first) tabindex 0, rest -1 — single Tab stop.
  const activeIdx = Math.max(0, nodes.findIndex((n) => n.id === selectedId));

  return (
    <ul
      ref={listRef}
      className="sr-only"
      aria-label={`Architecture diagram — ${nodes.length} nodes. Navigate with arrow keys, open the editor with Enter.`}
    >
      {nodes.map((n, i) => {
        const nm = nameOf(n.properties);
        const fam = familyOf(n.type);
        const outs = out.get(n.id);
        const incs = inc.get(n.id);
        const conn =
          [outs?.length ? `Connects to: ${outs.join(", ")}` : "", incs?.length ? `Incoming: ${incs.join(", ")}` : ""]
            .filter(Boolean).join(". ") || "No connections";
        return (
          <li key={n.id}>
            <button
              type="button"
              data-node={n.id}
              tabIndex={i === activeIdx ? 0 : -1}
              aria-current={n.id === selectedId ? "true" : undefined}
              onFocus={() => onActivate(n.id)}
              onClick={() => onOpen(n.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {`${nm}, ${fam} node. ${conn}.`}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
