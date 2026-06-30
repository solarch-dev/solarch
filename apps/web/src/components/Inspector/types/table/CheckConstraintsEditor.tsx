import {
  Input, EditGrid, type GridColumn,
} from "../../primitives";
import type { CheckConstraint } from "./types";
import { newCheck } from "./types";

interface Props {
  properties: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

const COLS: readonly GridColumn[] = [
  { key: "name", label: "Name", width: "minmax(96px,0.8fr)" },
  { key: "expr", label: "Expression", width: "minmax(150px,1.6fr)" },
];

export function CheckConstraintsEditor({ properties, onChange }: Props) {
  const checks = (Array.isArray(properties.CheckConstraints) ? properties.CheckConstraints : []) as CheckConstraint[];
  const setChecks = (next: CheckConstraint[]) => onChange({ ...properties, CheckConstraints: next });

  const update = (i: number, patch: Partial<CheckConstraint>) =>
    setChecks(checks.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => setChecks(checks.filter((_, idx) => idx !== i));
  const add = () => setChecks([...checks, newCheck()]);

  return (
    <EditGrid
      columns={COLS}
      rows={checks}
      rowKey={(_, i) => String(i)}
      addLabel="New check constraint"
      emptyLabel="// no check constraints — add below"
      onAdd={add}
      onDelete={remove}
      renderCell={(c, key, i) => {
        if (key === "name") {
          return (
            <Input
              density="cell"
              variant="mono"
              value={c.Name ?? ""}
              onChange={(v) => update(i, { Name: v || undefined })}
              placeholder="name (optional)"
              spellCheck={false}
              aria-label="Constraint name"
            />
          );
        }
        return (
          <Input
            density="cell"
            variant="mono"
            value={c.Expression}
            onChange={(v) => update(i, { Expression: v })}
            placeholder="e.g. price > 0"
            spellCheck={false}
            aria-label="Check expression"
          />
        );
      }}
    />
  );
}
