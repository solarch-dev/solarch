/** EditGrid — dense inline-edit grid (sibling of ListContainer+ListRow; Airtable/Retool pattern).
 *
 *  Research (deep-research): density+hierarchy REDUCES cognitive load; editable cells + expand-row;
 *  ONE header row instead of per-cell labels (density gain); editability on hover; Enter→new row.
 *
 *  - columns: header labels + shared grid-template-columns (cells aligned).
 *  - renderCell: control for each cell (cell-variant input/select/segmented/toggle).
 *  - renderDetail?: remaining/optional fields shown on row expand (chevron).
 *  - onMove/onDelete: row actions (always visible = keyboard/touch reachable, a11y).
 *  - onAdd + Enter on the last row → new row + focus first input of the new row.
 *  Theme: --ins-card (lifted) + --hairline divider + --ins-overlay-hover (NO zebra — research). */

import { useEffect, useRef, type ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MoveButtons } from "./MoveButtons";
import { DeleteButton } from "./DeleteButton";
import { AddRowButton } from "./AddRowButton";
import { EmptyHint } from "./EmptyHint";

export interface GridColumn {
  key: string;
  label: string;
  /** grid-template-columns fragment (e.g. "minmax(120px,1fr)", "84px", "max-content"). */
  width: string;
  align?: "left" | "center";
  /** Hover hint for abbreviated headers (e.g. "PK" → "Primary key"). */
  title?: string;
}

interface Props<T> {
  columns: readonly GridColumn[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  renderCell: (row: T, colKey: string, index: number) => ReactNode;
  renderDetail?: (row: T, index: number) => ReactNode;
  onMove?: (index: number, dir: -1 | 1) => void;
  onDelete?: (index: number) => void;
  onAdd: () => void;
  addLabel: string;
  emptyLabel?: string;
}

export function EditGrid<T>({
  columns, rows, rowKey, renderCell, renderDetail, onMove, onDelete, onAdd, addLabel, emptyLabel = "No items yet",
}: Props<T>) {
  const hasDetail = !!renderDetail;
  const hasActions = !!onMove || !!onDelete;
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusNextRef = useRef(false);

  // gridTemplate: [chevron] [data cells] [actions].
  // IMPORTANT: header and rows are SEPARATE grid containers → column widths are computed
  // per grid from their own content. A `max-content`/empty header cell breaks alignment; so
  // chevron + actions use FIXED px (same in both grids) → fr columns line up exactly.
  const actionsCol = hasActions ? (onMove ? "70px" : "30px") : null;
  const template = [hasDetail ? "16px" : null, ...columns.map((c) => c.width), actionsCol]
    .filter(Boolean)
    .join(" ");

  // Enter on the last row → new row (research: quick-add is a first-class affordance).
  // With nested grids, only react to THIS grid's direct last row (filter out bubbling).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLElement;
    if (t.tagName !== "INPUT") return;
    const row = (t.closest("[data-grid-row]") as HTMLElement | null);
    const body = bodyRef.current;
    if (!row || !body || row.parentElement !== body) return; // nested grid row → skip
    if (row !== body.lastElementChild) return; // only on the last row
    e.preventDefault();
    focusNextRef.current = true;
    onAdd();
  };

  // When a new row is added, focus the first editable control of the last row.
  useEffect(() => {
    if (!focusNextRef.current) return;
    focusNextRef.current = false;
    const last = bodyRef.current?.lastElementChild;
    last?.querySelector<HTMLElement>("input, [role='combobox'], button")?.focus();
  }, [rows.length]);

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 ? (
        <EmptyHint>{emptyLabel}</EmptyHint>
      ) : (
        <div
          className="overflow-hidden rounded-lg border"
          style={{ borderColor: "var(--hairline)", background: "var(--ins-card)" }}
        >
          {/* Header row — column labels (instead of per-cell labels) */}
          <div
            className="grid items-center gap-1.5 px-1.5 py-1.5"
            style={{ gridTemplateColumns: template, borderBottom: "1px solid var(--hairline)", background: "var(--ins-track)" }}
          >
            {hasDetail && <span />}
            {columns.map((c) => (
              <span
                key={c.key}
                title={c.title ?? c.label}
                className={cn(
                  "truncate font-mono text-[10px] font-semibold uppercase tracking-[0.07em]",
                  c.align === "center" && "text-center",
                  c.title && "cursor-help",
                )}
                style={{ color: "var(--ink-faint)" }}
              >
                {c.label}
              </span>
            ))}
            {hasActions && <span />}
          </div>

          {/* Rows */}
          <div ref={bodyRef} onKeyDown={onKeyDown}>
            {rows.map((row, i) => (
              <Row
                key={rowKey(row, i)}
                template={template}
                hasDetail={hasDetail}
                isLast={i === rows.length - 1}
                cells={columns.map((c) => (
                  <div key={c.key} className={cn("min-w-0", c.align === "center" && "flex justify-center")}>
                    {renderCell(row, c.key, i)}
                  </div>
                ))}
                detail={renderDetail ? renderDetail(row, i) : null}
                actions={
                  hasActions ? (
                    <div className="flex items-center gap-px pl-1">
                      {onMove && <MoveButtons isFirst={i === 0} isLast={i === rows.length - 1} onUp={() => onMove(i, -1)} onDown={() => onMove(i, 1)} />}
                      {onDelete && <DeleteButton onClick={() => onDelete(i)} />}
                    </div>
                  ) : null
                }
              />
            ))}
          </div>
        </div>
      )}
      <AddRowButton label={addLabel} onClick={onAdd} />
    </div>
  );
}

function Row({
  template, hasDetail, isLast, cells, detail, actions,
}: {
  template: string;
  hasDetail: boolean;
  isLast: boolean;
  cells: ReactNode;
  detail: ReactNode;
  actions: ReactNode;
}) {
  const divider = isLast ? undefined : "1px solid var(--hairline)";
  const head = (
    <div
      className="grid items-center gap-1.5 px-1.5 transition-colors hover:bg-[var(--ins-overlay-hover)]"
      style={{ gridTemplateColumns: template, minHeight: 38 }}
    >
      {hasDetail && (
        <CollapsibleTrigger asChild>
          <button type="button" aria-label="Expand row" className="flex h-6 w-4 items-center justify-center rounded text-[color:var(--ink-faint)] outline-none hover:text-[color:var(--ink)] focus-visible:ring-2 focus-visible:ring-[color:var(--ins-family-accent,var(--accent))]/40">
            <ChevronRight size={12} className="transition-transform group-data-[state=open]/row:rotate-90" />
          </button>
        </CollapsibleTrigger>
      )}
      {cells}
      {actions}
    </div>
  );

  // Row divider on the outer wrapper → head flows seamlessly into detail (no line between them).
  if (!hasDetail) return <div data-grid-row style={{ borderBottom: divider }}>{head}</div>;

  return (
    <Collapsible className="group/row block" data-grid-row style={{ borderBottom: divider }}>
      {head}
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="flex flex-col gap-[14px] px-4 pb-4 pt-2" style={{ background: "var(--ins-card-sunken)" }}>
          {detail}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
