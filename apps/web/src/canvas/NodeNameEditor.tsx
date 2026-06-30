/** NodeNameEditor — inline node name editing (on canvas, centered on node).
 *  Sketch LabelEditor pattern: auto-focus input, Enter commit, Esc cancel, blur commit. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useSelection } from "../state/selection";
import { useCanvasCommands } from "./canvas-commands";
import { useUpdateNode } from "../api/nodes";
import { nodeScreenBounds } from "./coord-utils";
import { nameOf, colorOf } from "./families";
import { nameKeyFor } from "./name-keys";
import { Z_LAYERS } from "../lib/z-layers";

export function NodeNameEditor() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const nameEditorOpen = useSelection((s) => s.nameEditorOpen);
  const selectedNodeId = useSelection((s) => s.selectedNodeId);
  const closeNameEditor = useSelection((s) => s.closeNameEditor);
  const viewport = useCanvasCommands((s) => s.viewport);
  const nodes = useCanvasCommands((s) => s.nodes);

  const node = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  const updateNode = useUpdateNode(projectId, selectedNodeId);

  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const initialValueRef = useRef("");

  // Set initial value + focus + select when opened
  useEffect(() => {
    if (!nameEditorOpen || !node) return;
    const initial = nameOf(node.properties ?? {});
    setValue(initial);
    initialValueRef.current = initial;
    // requestAnimationFrame: wait for input to mount
    const t = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(t);
  }, [nameEditorOpen, node]);

  if (!nameEditorOpen || !node) return null;

  const bounds = nodeScreenBounds(node, viewport);
  const familyColor = colorOf(node.type);
  const key = nameKeyFor(node.type);

  const commit = () => {
    // Prevent double commit if blur fires again while mutation is pending
    if (updateNode.isPending) return;
    const next = value.trim();
    if (!next || next === initialValueRef.current) {
      closeNameEditor();
      return;
    }
    const properties = { ...(node.properties ?? {}), [key]: next };
    updateNode.mutate(
      { properties, expectedVersion: (node as { version?: number }).version },
      { onSettled: () => closeNameEditor() },
    );
  };

  const cancel = () => {
    setValue(initialValueRef.current);
    closeNameEditor();
  };

  return (
    <div
      className="absolute pointer-events-auto animate-in fade-in zoom-in-95 duration-150"
      style={{
        left: bounds.centerX,
        top: bounds.centerY,
        transform: "translate(-50%, -50%)",
        zIndex: Z_LAYERS.MODAL, // always visible above drawer/topbar (55/50)
      }}
    >
      <div
        className="relative rounded-lg bg-white/95 backdrop-blur-md shadow-card"
        style={{ borderColor: `${familyColor}80`, borderWidth: 1.5, borderStyle: "solid" }}
      >
        {/* Drafting register marks — 4× corner caret (sketch DNA) */}
        <CornerCarets color={familyColor} />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
          spellCheck={false}
          className="block bg-transparent outline-none px-3 py-1.5
                     font-sans font-semibold text-center text-[14.5px]
                     min-w-[180px] text-[color:var(--ink)]"
          aria-label={`${node.type} name`}
        />
      </div>
    </div>
  );
}

function CornerCarets({ color }: { color: string }) {
  // 4 corners × 2 lines (horizontal + vertical) = 8 small carets
  const len = 5;
  const off = -1.5;
  const style = { stroke: color, strokeWidth: 1 } as const;
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: "100%", height: "100%", overflow: "visible" }}
      aria-hidden="true"
    >
      {[
        { x: 0, y: 0, hx1: off, hx2: off + len, vy1: off, vy2: off + len },     // TL
        { x: 1, y: 0, hx1: -len - off, hx2: -off, vy1: off, vy2: off + len },   // TR
        { x: 0, y: 1, hx1: off, hx2: off + len, vy1: -len - off, vy2: -off },   // BL
        { x: 1, y: 1, hx1: -len - off, hx2: -off, vy1: -len - off, vy2: -off }, // BR
      ].map((c, i) => (
        <g key={i} transform={`translate(${c.x * 100}% ${c.y * 100}%)`}>
          <line x1={c.hx1} y1={c.x === 0 ? off : -off} x2={c.hx2} y2={c.x === 0 ? off : -off} {...style} />
          <line x1={c.y === 0 ? off : -off} y1={c.vy1} x2={c.y === 0 ? off : -off} y2={c.vy2} {...style} />
        </g>
      ))}
    </svg>
  );
}
