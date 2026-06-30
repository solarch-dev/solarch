/** NodeRefList — multi NodeRefCombobox + add/remove for primitive string[] fields.
 *  For Throws / MiddlewareRefs / ChildComponentRefs / ExposedServices / Module.Dependencies.
 *  Uses ArrayWidget in the SchemaForm path; directly imported in custom drawers. */

import { Plus, X } from "lucide-react";
import { NodeRefCombobox } from "./NodeRefCombobox";
import { cn } from "@/lib/utils";

interface Props {
  items: string[];
  onChange: (next: string[]) => void;
  nodeType: string;
  /** If provided, creates a source → target (kind) edge after each selection/creation. */
  edgeKind?: string;
  sourceNodeId?: string;
  addLabel?: string;
}

export function NodeRefList({
  items, onChange, nodeType, edgeKind, sourceNodeId, addLabel,
}: Props) {
  const setAt = (i: number, v: string) =>
    onChange(items.map((t, idx) => (idx === i ? v : t)));
  const removeAt = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const addEmpty = () => onChange([...items, ""]);

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((t, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0">
            <NodeRefCombobox
              nodeType={nodeType}
              value={t}
              onChange={(v) => setAt(i, v)}
              placeholder={`Select ${nodeType}…`}
              ariaLabel={`${nodeType} ${i + 1}`}
              linkAs={edgeKind && sourceNodeId ? { sourceNodeId, kind: edgeKind } : undefined}
            />
          </div>
          <button
            type="button"
            onClick={() => removeAt(i)}
            aria-label="Remove this item"
            className={cn(
              "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors",
              "text-[color:var(--ink-faint)] hover:bg-[var(--ins-overlay-hover)] hover:text-[color:var(--danger)]",
            )}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addEmpty}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 self-start rounded-md text-[13.5px] font-medium",
          "text-[color:var(--ink-soft)] hover:text-[color:var(--ink)] hover:bg-[var(--ins-track)] transition-colors",
          "border border-dashed border-[color:var(--hairline-strong)]",
        )}
      >
        <Plus size={12} />
        {addLabel ?? `Add ${nodeType}`}
      </button>
    </div>
  );
}
