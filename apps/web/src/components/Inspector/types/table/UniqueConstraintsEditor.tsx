import {
  Input, Field, ColumnMultiSelect, EditGrid, type GridColumn,
} from "../../primitives";
import type { UniqueConstraint } from "./types";
import { columnNamesOf, newUnique } from "./types";

interface Props {
  properties: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

const COLS: readonly GridColumn[] = [
  { key: "name", label: "Name", width: "minmax(120px,1fr)" },
];

export function UniqueConstraintsEditor({ properties, onChange }: Props) {
  const localColumns = columnNamesOf(properties);
  const uniques = (Array.isArray(properties.UniqueConstraints) ? properties.UniqueConstraints : []) as UniqueConstraint[];
  const setUniques = (next: UniqueConstraint[]) => onChange({ ...properties, UniqueConstraints: next });

  const update = (i: number, patch: Partial<UniqueConstraint>) =>
    setUniques(uniques.map((u, idx) => (idx === i ? { ...u, ...patch } : u)));
  const remove = (i: number) => setUniques(uniques.filter((_, idx) => idx !== i));
  const add = () => setUniques([...uniques, newUnique()]);

  return (
    <EditGrid
      columns={COLS}
      rows={uniques}
      rowKey={(_, i) => String(i)}
      addLabel="New unique constraint"
      emptyLabel="// no unique constraints — add below"
      onAdd={add}
      onDelete={remove}
      renderCell={(u, _key, i) => (
        <Input
          density="cell"
          variant="mono"
          value={u.Name ?? ""}
          onChange={(v) => update(i, { Name: v || undefined })}
          placeholder="constraint_name (optional)"
          spellCheck={false}
          aria-label="Constraint name"
        />
      )}
      renderDetail={(u, i) => (
        <Field label="Columns" helper="column(s) that are unique together">
          <ColumnMultiSelect
            value={u.Columns}
            onChange={(next) => update(i, { Columns: next })}
            options={localColumns}
            ariaLabel="Unique columns"
          />
        </Field>
      )}
    />
  );
}
