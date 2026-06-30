/** NodeActionBar — floating glass pill above selected node.
 *  Copy / Rename / Edit / Delete actions. */

import { useCallback, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Code2, Copy, Pencil, SquarePen, Trash2 } from "lucide-react";
import { Z_LAYERS } from "../lib/z-layers";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useSelection } from "../state/selection";
import { useCanvasCommands } from "./canvas-commands";
import { useCreateNode, useDeleteNode } from "../api/nodes";
import { useTabGraph } from "../api/tabs";
import { nameOf } from "./families";
import { nodeScreenBounds } from "./coord-utils";
import { cn } from "@/lib/utils";

const BAR_GAP = 8;
const BAR_HEIGHT = 36;

export function NodeActionBar() {
  const { projectId = "", tabId } = useParams<{ projectId: string; tabId?: string }>();
  const selectedNodeId = useSelection((s) => s.selectedNodeId);
  const nameEditorOpen = useSelection((s) => s.nameEditorOpen);
  const editorNodeId = useSelection((s) => s.editorNodeId);
  const openNameEditor = useSelection((s) => s.openNameEditor);
  const openEditor = useSelection((s) => s.openEditor);
  const selectNode = useSelection((s) => s.selectNode);

  const viewport = useCanvasCommands((s) => s.viewport);
  const nodes = useCanvasCommands((s) => s.nodes);
  const isDragging = useCanvasCommands((s) => s.isDragging);

  const createNode = useCreateNode(projectId, tabId ?? null);
  const deleteNode = useDeleteNode(projectId);
  const confirm = useConfirm();
  const { data: tabGraph } = useTabGraph(projectId, tabId ?? null);

  const node = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  const onCopy = useCallback(() => {
    if (!node) return;
    createNode.mutate(
      {
        type: node.type,
        position: { x: node.x + 20, y: node.y + 20 },
        properties: structuredClone(node.properties ?? {}),
      },
      {
        onSuccess: (created) => {
          if (!created || typeof created !== "object" || !("id" in created)) {
            console.warn("[NodeActionBar] Copy: unexpected backend response shape:", created);
            return;
          }
          selectNode((created as { id: string }).id);
        },
        onError: (err) => {
          console.error("[NodeActionBar] Copy error:", err);
        },
      },
    );
  }, [node, createNode, selectNode]);

  const onRename = () => openNameEditor();
  const onEdit = () => { if (node) openEditor(node.id); };
  // "Show Code" — TopBar listener gates + opens panel; detail.focusNodeId focuses
  // on this node's generated file. If not entitled, TopBar redirects to /billing.
  const onShowCode = () => {
    if (!node) return;
    window.dispatchEvent(
      new CustomEvent("solarch:codegen-open", { detail: { focusNodeId: node.id } }),
    );
  };

  // Delete confirmation — permanent loss + connected edge cascade. NOTE: tab-graph
  // only counts edges with both ends visible in this tab (cross-tab undercount) →
  // always keep "cannot be undone" warning, qualify with "visible in this tab" if edgeCount>0.
  const onDelete = useCallback(async () => {
    if (!node) return;
    const edgeCount = (tabGraph?.edges ?? []).filter(
      (e) => e.sourceNodeId === node.id || e.targetNodeId === node.id,
    ).length;
    const name = nameOf(node.properties ?? {}) || node.type;
    const ok = await confirm({
      title: `Delete node '${name}'`,
      description:
        edgeCount > 0
          ? `This node and ${edgeCount} visible connections in this tab will be deleted. This action cannot be undone.`
          : "This action cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    deleteNode.mutate(node.id, {
      onSuccess: () => selectNode(null),
      onError: (err) => console.error("[NodeActionBar] Delete error:", err),
    });
  }, [node, tabGraph, confirm, deleteNode, selectNode]);

  // ⌘⇧C and Del global hotkeys — AppShell keydown handler calls these callbacks.
  // Since onDelete is now async + contains confirm, global Del is also tied to approval.
  // Callbacks are in deps so useCallback deps stay current (no stale edge counts).
  useEffect(() => {
    if (!node) return;
    useCanvasCommands.getState().set({ copy: onCopy, deleteSelected: onDelete });
    return () => useCanvasCommands.getState().set({ copy: null, deleteSelected: null });
  }, [node, onCopy, onDelete]);

  // Hide if no selection, name editor open, modal open, drag active (early return AFTER hooks)
  if (!node || nameEditorOpen || !!editorNodeId || isDragging) {
    return null;
  }

  const bounds = nodeScreenBounds(node, viewport);

  // Auto-flip: render below if too close to viewport top
  const wantTop = bounds.top - BAR_HEIGHT - BAR_GAP;
  const useTop = wantTop > 60; // 60 = TopBar (48) + 12 pad
  const screenTop = useTop ? wantTop : bounds.bottom + BAR_GAP;

  return (
    <>
      <div
        className="absolute pointer-events-auto animate-in fade-in slide-in-from-bottom-1 duration-150"
        style={{
          left: bounds.centerX,
          top: screenTop,
          transform: "translateX(-50%)",
          zIndex: Z_LAYERS.CHROME,
        }}
      >
        <div className={cn(
          "flex items-center gap-0.5 p-1 rounded-2xl",
          "bg-card/95 backdrop-blur-xl border border-border shadow-float"
        )}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onCopy} className="h-7 w-7 p-0">
                <Copy size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={useTop ? "top" : "bottom"}>Copy (⌘⇧C)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onRename} className="h-7 w-7 p-0">
                <Pencil size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={useTop ? "top" : "bottom"}>Rename (F2)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 w-7 p-0">
                <SquarePen size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={useTop ? "top" : "bottom"}>Edit (⌘E)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onShowCode} className="h-7 w-7 p-0">
                <Code2 size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={useTop ? "top" : "bottom"}>Show Code</TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="h-4 mx-0.5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onDelete()}
                className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={useTop ? "top" : "bottom"}>Delete (Del)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
