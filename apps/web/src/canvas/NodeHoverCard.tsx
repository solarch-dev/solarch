/** NodeHoverCard — minimal info popover on node hover.
 *  200ms idle delay, hidden during drag/click/selected.
 *  Content: type pill + name + type description (node lib) + optional content preview. */

import { useEffect, useMemo, useState } from "react";
import { Z_LAYERS } from "../lib/z-layers";
import { useSelection } from "../state/selection";
import { useCanvasCommands } from "./canvas-commands";
import { useNodeType } from "../api/node-types";
import { nodeScreenBounds } from "./coord-utils";
import { nameOf, colorOf } from "./families";
import { previewLine } from "./hover-preview";

const HOVER_DELAY = 200;

export function NodeHoverCard() {
  const hoveredNodeId = useSelection((s) => s.hoveredNodeId);
  const selectedNodeId = useSelection((s) => s.selectedNodeId);
  const nameEditorOpen = useSelection((s) => s.nameEditorOpen);
  const editorNodeId = useSelection((s) => s.editorNodeId);
  const isDragging = useCanvasCommands((s) => s.isDragging);
  const viewport = useCanvasCommands((s) => s.viewport);
  const nodes = useCanvasCommands((s) => s.nodes);

  // 200ms delay — render when hover is idle
  const [showId, setShowId] = useState<string | null>(null);
  useEffect(() => {
    // Don't show HoverCard on selected node hover — ActionBar is already visible, prevents flicker
    if (!hoveredNodeId || hoveredNodeId === selectedNodeId) {
      setShowId(null);
      return;
    }
    const t = window.setTimeout(() => setShowId(hoveredNodeId), HOVER_DELAY);
    return () => window.clearTimeout(t);
  }, [hoveredNodeId, selectedNodeId]);

  const node = useMemo(
    () => nodes.find((n) => n.id === showId),
    [nodes, showId]
  );

  // Type description — from node lib (StaleTime: Infinity, fast cache hit)
  const { data: nodeType } = useNodeType(node?.type ?? null);

  // Hide conditions
  if (!node) return null;
  if (selectedNodeId === showId) return null;     // ActionBar visible when selected
  if (nameEditorOpen || !!editorNodeId) return null;
  if (isDragging) return null;

  const bounds = nodeScreenBounds(node, viewport);
  const familyColor = colorOf(node.type);
  const preview = previewLine(node);
  const name = nameOf(node.properties ?? {});
  const description = nodeType?.description;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: bounds.centerX,
        top: bounds.top - 12,
        transform: "translate(-50%, -100%)",
        zIndex: Z_LAYERS.GUIDES,
      }}
    >
      <div className="px-3.5 py-2.5 rounded-lg bg-card/95 backdrop-blur-xl
                      border border-border shadow-card w-[280px] animate-in fade-in slide-in-from-bottom-1 duration-150">
        <div className="font-sans text-[13.5px] font-semibold truncate min-w-0">
          <span style={{ color: familyColor }}>{name}</span>
          <span className="text-muted-foreground font-normal"> — {node.type}</span>
        </div>
        {description && (
          <div className="mt-1.5 font-sans text-[12.5px] text-muted-foreground leading-snug line-clamp-2">
            {description}
          </div>
        )}
        {node.implTotal != null && node.implTotal > 0 && (
          <div className="mt-2 pt-2 border-t border-border/60 font-sans text-[12px] text-muted-foreground leading-snug">
            <span className="font-medium text-foreground/80">Implementation</span>
            {" — "}
            {node.implFilled ?? 0}/{node.implTotal} members filled
            {(node.implAi ?? 0) > 0 && (
              <span className="text-muted-foreground/80"> · {node.implAi} by AI</span>
            )}
          </div>
        )}
        {preview && (
          <div className="mt-2 pt-2 border-t border-border/60 font-mono text-[11.5px] text-muted-foreground truncate">
            {preview}
          </div>
        )}
      </div>
    </div>
  );
}
