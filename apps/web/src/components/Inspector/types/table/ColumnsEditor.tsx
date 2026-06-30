import {
  Input, Select, Field, NodeRefCombobox, EditGrid, ToggleCell, type GridColumn,
} from "../../primitives";
import type { Column, DataType } from "./types";
import { DATA_TYPES, newColumn } from "./types";

interface Props {
  properties: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  nodeId: string;
}

const COLS: readonly GridColumn[] = [
  { key: "name", label: "Name", width: "minmax(110px,1.5fr)" },
  { key: "type", label: "Type", width: "minmax(92px,0.9fr)" },
  { key: "pk", label: "PK", width: "34px", align: "center", title: "Primary key" },
  { key: "nn", label: "NN", width: "34px", align: "center", title: "Not null" },
  { key: "uq", label: "UQ", width: "34px", align: "center", title: "Unique" },
  { key: "ai", label: "AI", width: "34px", align: "center", title: "Auto increment" },
];

export function ColumnsEditor({ properties, onChange, nodeId }: Props) {
  const columns = (Array.isArray(properties.Columns) ? properties.Columns : []) as Column[];
  const setColumns = (next: Column[]) => onChange({ ...properties, Columns: next });

  const update = (i: number, patch: Partial<Column>) => {
    setColumns(columns.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const remove = (i: number) => setColumns(columns.filter((_, idx) => idx !== i));
  const add = () => setColumns([...columns, newColumn()]);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= columns.length) return;
    const next = columns.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setColumns(next);
  };

  return (
    <EditGrid
      columns={COLS}
      rows={columns}
      rowKey={(_, i) => String(i)}
      addLabel="New column"
      emptyLabel="// no columns — add below"
      onAdd={add}
      onMove={move}
      onDelete={remove}
      renderCell={(col, key, i) => {
        switch (key) {
          case "name":
            return (
              <Input
                density="cell"
                variant="mono"
                value={col.Name}
                onChange={(v) => update(i, { Name: v })}
                placeholder="column_name"
                spellCheck={false}
                aria-label="Column name"
              />
            );
          case "type":
            return (
              <Select
                density="cell"
                value={col.DataType}
                onChange={(v) => update(i, { DataType: v as DataType })}
                options={DATA_TYPES.map((t) => ({ value: t }))}
                ariaLabel="Data type"
              />
            );
          case "pk":
            return <ToggleCell tone="family" checked={col.IsPrimaryKey} onChange={(v) => update(i, { IsPrimaryKey: v })} ariaLabel="Primary key" />;
          case "nn":
            return <ToggleCell checked={col.IsNotNull} onChange={(v) => update(i, { IsNotNull: v })} ariaLabel="Not null" />;
          case "uq":
            return <ToggleCell checked={col.IsUnique} onChange={(v) => update(i, { IsUnique: v })} ariaLabel="Unique" />;
          case "ai":
            return <ToggleCell checked={col.AutoIncrement} onChange={(v) => update(i, { AutoIncrement: v })} ariaLabel="Auto increment" />;
          default:
            return null;
        }
      }}
      renderDetail={(col, i) => (
        <>
          {col.DataType === "VARCHAR" && (
            <Field label="Length" helper="VARCHAR — max character length">
              <Input
                variant="number"
                value={col.Length ?? ""}
                onChange={(v) => update(i, { Length: v === "" ? undefined : Number(v) })}
                placeholder="255"
              />
            </Field>
          )}
          {col.DataType === "DECIMAL" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Precision">
                <Input
                  variant="number"
                  value={col.Precision ?? ""}
                  onChange={(v) => update(i, { Precision: v === "" ? undefined : Number(v) })}
                  placeholder="10"
                />
              </Field>
              <Field label="Scale">
                <Input
                  variant="number"
                  value={col.Scale ?? ""}
                  onChange={(v) => update(i, { Scale: v === "" ? undefined : Number(v) })}
                  placeholder="2"
                />
              </Field>
            </div>
          )}
          {col.DataType === "ENUM" && (
            <Field label="Enum reference" helper="DataType=ENUM — link to an Enum node in the project">
              <NodeRefCombobox
                nodeType="Enum"
                value={col.EnumRef ?? ""}
                onChange={(v) => update(i, { EnumRef: v || undefined })}
                placeholder="UserRole"
                ariaLabel="Enum reference"
                linkAs={nodeId ? { sourceNodeId: nodeId, kind: "USES" } : undefined}
              />
            </Field>
          )}
          <Field label="Default value">
            <Input
              variant="mono"
              value={col.DefaultValue ?? ""}
              onChange={(v) => update(i, { DefaultValue: v || undefined })}
              placeholder="e.g. CURRENT_TIMESTAMP"
            />
          </Field>
          <Field label="Description">
            <Input
              value={col.Comment ?? ""}
              onChange={(v) => update(i, { Comment: v || undefined })}
              placeholder="column description"
            />
          </Field>
        </>
      )}
    />
  );
}
