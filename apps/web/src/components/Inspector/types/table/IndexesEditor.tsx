import {
  Input, Select, Field, ColumnMultiSelect, EditGrid, ToggleCell, type GridColumn,
} from "../../primitives";
import type { TableIndex } from "./types";
import { columnNamesOf, newIndex, INDEX_TYPES } from "./types";

interface Props {
  properties: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

const COLS: readonly GridColumn[] = [
  { key: "name", label: "Name", width: "minmax(110px,1.4fr)" },
  { key: "type", label: "Type", width: "minmax(82px,0.8fr)" },
  { key: "uq", label: "UQ", width: "34px", align: "center", title: "Unique index" },
  { key: "part", label: "Part", width: "38px", align: "center", title: "Partial index" },
];

export function IndexesEditor({ properties, onChange }: Props) {
  const localColumns = columnNamesOf(properties);
  const indexes = (Array.isArray(properties.Indexes) ? properties.Indexes : []) as TableIndex[];
  const setIndexes = (next: TableIndex[]) => onChange({ ...properties, Indexes: next });

  const update = (i: number, patch: Partial<TableIndex>) =>
    setIndexes(indexes.map((ix, idx) => (idx === i ? { ...ix, ...patch } : ix)));
  const remove = (i: number) => setIndexes(indexes.filter((_, idx) => idx !== i));
  const add = () => setIndexes([...indexes, newIndex()]);

  return (
    <EditGrid
      columns={COLS}
      rows={indexes}
      rowKey={(_, i) => String(i)}
      addLabel="New index"
      emptyLabel="// no indexes — add below"
      onAdd={add}
      onDelete={remove}
      renderCell={(ix, key, i) => {
        switch (key) {
          case "name":
            return (
              <Input
                density="cell"
                variant="mono"
                value={ix.IndexName}
                onChange={(v) => update(i, { IndexName: v })}
                placeholder="index_name"
                spellCheck={false}
                aria-label="Index name"
              />
            );
          case "type":
            return (
              <Select
                density="cell"
                value={ix.Type}
                onChange={(v) => update(i, { Type: v as TableIndex["Type"] })}
                options={INDEX_TYPES.map((t) => ({ value: t }))}
                ariaLabel="Index type"
              />
            );
          case "uq":
            return <ToggleCell checked={ix.IsUnique} onChange={(v) => update(i, { IsUnique: v })} ariaLabel="Unique index" />;
          case "part":
            return <ToggleCell checked={!!ix.IsPartial} onChange={(v) => update(i, { IsPartial: v ? true : undefined })} ariaLabel="Partial index" />;
          default:
            return null;
        }
      }}
      renderDetail={(ix, i) => (
        <>
          <Field label="Columns">
            <ColumnMultiSelect
              value={ix.Columns}
              onChange={(next) => update(i, { Columns: next })}
              options={localColumns}
              ariaLabel="Index columns"
            />
          </Field>
          {ix.IsPartial && (
            <Field label="WHERE clause" helper="partial index filter expression">
              <Input
                variant="mono"
                value={ix.WhereClause ?? ""}
                onChange={(v) => update(i, { WhereClause: v || undefined })}
                placeholder="e.g. is_active = true"
              />
            </Field>
          )}
        </>
      )}
    />
  );
}
