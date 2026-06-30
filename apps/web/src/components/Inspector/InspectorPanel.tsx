import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Code2 } from "lucide-react";
import { useSelection } from "../../state/selection";
import { useNode } from "../../api/nodes";
import { useNodeType } from "../../api/node-types";
import { colorOf, familyOf, nameOf } from "../../canvas/families";
import { GenericForm } from "./GenericForm";
import { TableInspector } from "./types/TableInspector";
import { ServiceInspector } from "./types/ServiceInspector";
import { ControllerInspector } from "./types/ControllerInspector";
import { DTOInspector } from "./types/DTOInspector";
import type { JSONSchema } from "./schema-utils";
import { InspectorShell } from "./primitives";
import "./Inspector.css";

/** Contextual node inspector that sits inside the left slide-in LeftDrawer.
 *  Delete action is via NodeActionBar / Del shortcut — no delete UI in this panel (Linear/Figma pattern). */
export function InspectorPanel() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const editorNodeId = useSelection((s) => s.editorNodeId);
  const closeEditor = useSelection((s) => s.closeEditor);
  const editingNodeId = useSelection((s) => s.editingNodeId);
  const stopEditing = useSelection((s) => s.stopEditing);
  const { data: node, isLoading } = useNode(projectId, editorNodeId);
  const { data: nodeType } = useNodeType(node?.type ?? null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Double-click / F2 → editingNodeId → first input auto-focus + select.
  useEffect(() => {
    if (!node || editingNodeId !== node.id) return;
    const handle = requestAnimationFrame(() => {
      const root = bodyRef.current;
      if (!root) return;
      const inp = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "input:not([type='number']):not([type='checkbox']):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])"
      );
      if (inp) {
        inp.focus();
        try { (inp as HTMLInputElement).select(); } catch { /* skip if textarea can't select */ }
      }
      stopEditing();
    });
    return () => cancelAnimationFrame(handle);
  }, [node, editingNodeId, stopEditing]);

  if (!editorNodeId) return null;

  if (isLoading || !node) {
    return (
      <section className="flex flex-col bg-[color:var(--paper-raised)] border-t border-[color:var(--hairline)]" aria-label="Node Inspector">
        <div className="h-[3px] bg-[color:var(--accent)]" />
        <div className="font-mono text-[12px] text-[color:var(--ink-faint)] p-[14px]">loading…</div>
      </section>
    );
  }

  const shared = {
    projectId,
    nodeId: node.id,
    tabId: node.homeTabId,
    properties: node.properties,
  };

  const family = familyOf(node.type);
  const familyColor = colorOf(node.type);

  const renderBody = () => {
    switch (node.type) {
      case "Table":      return <TableInspector {...shared} />;
      case "Service":    return <ServiceInspector {...shared} />;
      case "Controller": return <ControllerInspector {...shared} />;
      case "DTO":        return <DTOInspector {...shared} />;
      default:
        return (
          <GenericForm
            {...shared}
            type={node.type}
            fieldHints={nodeType?.fieldHints ?? {}}
            schema={nodeType?.schema as JSONSchema | undefined}
          />
        );
    }
  };

  // "Show Code" — TopBar listener opens panel; detail.focusNodeId focuses this node's file.
  const onShowCode = () => {
    window.dispatchEvent(
      new CustomEvent("solarch:codegen-open", { detail: { focusNodeId: node.id } }),
    );
  };

  return (
    <InspectorShell
      family={family}
      familyColor={familyColor}
      typeLabel={nodeType?.familyLabel ?? family.toUpperCase()}
      typeName={node.type}
      title={nameOf(node.properties)}
      description={nodeType?.description}
      onClose={() => closeEditor()}
      bodyRef={bodyRef}
      headerActions={
        <button
          type="button"
          onClick={onShowCode}
          aria-label="Show Code"
          title="Show Code"
          className="w-8 h-8 flex items-center justify-center border-0 bg-transparent text-[color:var(--ink-soft)] rounded-md shrink-0 transition-colors hover:bg-[var(--ins-overlay-hover)] hover:text-[color:var(--ink)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Code2 size={16} />
        </button>
      }
    >
      {renderBody()}
    </InspectorShell>
  );
}
