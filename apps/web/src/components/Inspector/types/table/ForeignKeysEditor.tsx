import { useParams } from "react-router-dom";
import { useProjectNodes } from "../../../../api/nodes";
import { nameOf } from "../../../../canvas/families";
import {
  Input, Select, Field, NodeRefCombobox, ColumnMultiSelect, EditGrid, type GridColumn,
} from "../../primitives";
import type { ForeignKey } from "./types";
import { columnNamesOf, newForeignKey, FK_ACTIONS } from "./types";

interface Props {
  properties: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

const COLS: readonly GridColumn[] = [
  { key: "name", label: "Name", width: "minmax(96px,1fr)" },
  { key: "target", label: "References", width: "minmax(120px,1.3fr)" },
];

export function ForeignKeysEditor({ properties, onChange }: Props) {
  const { projectId = "" } = useParams<{ projectId?: string }>();
  const { data: tables = [] } = useProjectNodes(projectId, "Table");

  const localColumns = columnNamesOf(properties);
  const fks = (Array.isArray(properties.ForeignKeys) ? properties.ForeignKeys : []) as ForeignKey[];
  const setFks = (next: ForeignKey[]) => onChange({ ...properties, ForeignKeys: next });

  const update = (i: number, patch: Partial<ForeignKey>) =>
    setFks(fks.map((fk, idx) => (idx === i ? { ...fk, ...patch } : fk)));
  const remove = (i: number) => setFks(fks.filter((_, idx) => idx !== i));
  const add = () => setFks([...fks, newForeignKey()]);

  return (
    <EditGrid
      columns={COLS}
      rows={fks}
      rowKey={(_, i) => String(i)}
      addLabel="New foreign key"
      emptyLabel="// no foreign keys — add below"
      onAdd={add}
      onDelete={remove}
      renderCell={(fk, key, i) => {
        if (key === "name") {
          return (
            <Input
              density="cell"
              variant="mono"
              value={fk.Name ?? ""}
              onChange={(v) => update(i, { Name: v || undefined })}
              placeholder="fk_name (optional)"
              spellCheck={false}
              aria-label="Foreign key name"
            />
          );
        }
        return (
          <NodeRefCombobox
            density="cell"
            nodeType="Table"
            value={fk.ReferencesTable}
            onChange={(v) => update(i, { ReferencesTable: v })}
            placeholder="target table"
            ariaLabel="Reference table"
          />
        );
      }}
      renderDetail={(fk, i) => {
        const target = tables.find((t) => nameOf(t.properties) === fk.ReferencesTable);
        const targetColumns = target ? columnNamesOf(target.properties) : [];
        const arityMismatch =
          fk.Columns.length > 0 && fk.ReferencesColumns.length > 0 &&
          fk.Columns.length !== fk.ReferencesColumns.length;
        return (
          <>
            <Field label="Columns (this table)" helper="Local column(s) that form the FK">
              <ColumnMultiSelect
                value={fk.Columns}
                onChange={(next) => update(i, { Columns: next })}
                options={localColumns}
                ariaLabel="FK columns"
              />
            </Field>
            <Field
              label="Reference columns (target table)"
              badge={arityMismatch ? "arity ≠" : undefined}
              helper={fk.ReferencesTable ? "columns of the target table" : "select target table first"}
            >
              <ColumnMultiSelect
                value={fk.ReferencesColumns}
                onChange={(next) => update(i, { ReferencesColumns: next })}
                options={targetColumns}
                ariaLabel="Reference columns"
                placeholder={fk.ReferencesTable ? "+ column" : "—"}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="On Delete">
                <Select
                  value={fk.OnDelete}
                  onChange={(v) => update(i, { OnDelete: v as ForeignKey["OnDelete"] })}
                  options={FK_ACTIONS.map((a) => ({ value: a }))}
                  ariaLabel="On delete behavior"
                />
              </Field>
              <Field label="On Update">
                <Select
                  value={fk.OnUpdate}
                  onChange={(v) => update(i, { OnUpdate: v as ForeignKey["OnUpdate"] })}
                  options={FK_ACTIONS.map((a) => ({ value: a }))}
                  ariaLabel="On update behavior"
                />
              </Field>
            </div>
          </>
        );
      }}
    />
  );
}
