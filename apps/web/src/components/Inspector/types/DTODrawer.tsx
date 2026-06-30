import {
  SubPageShell, Field, Input, Textarea, Select, SectionHeader,
  NodeRefCombobox, ValueSetCombobox,
  EditGrid, ToggleCell, type GridColumn,
} from "../primitives";

const VALIDATION_RULES = ["Min", "Max", "MinLength", "MaxLength", "Email", "Url", "Regex", "Pattern", "Positive", "Negative"] as const;
type ValidationRuleName = typeof VALIDATION_RULES[number];

interface ValidationRule {
  Rule: ValidationRuleName;
  Value?: string;
}
interface DtoField {
  Name: string;
  DataType: string;
  IsRequired: boolean;
  IsArray: boolean;
  ValidationRules: ValidationRule[];
  DefaultValue?: string;
  NestedDTORef?: string;
  EnumRef?: string;
  Description?: string;
}

const newField = (): DtoField => ({
  Name: "",
  DataType: "string",
  IsRequired: true,
  IsArray: false,
  ValidationRules: [],
});

const RULE_NEEDS_VALUE: Record<ValidationRuleName, boolean> = {
  Min: true, Max: true, MinLength: true, MaxLength: true,
  Regex: true, Pattern: true,
  Email: false, Url: false, Positive: false, Negative: false,
};

interface Props {
  /** ID of the DTO node being edited — for NodeRefCombobox linkAs (HAS/USES edge creation). */
  nodeId: string;
  dtoName: string;
  properties: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  saveStatus?: "idle" | "pending" | "success" | "error";
  onBack: () => void;
}

const FIELD_COLS: readonly GridColumn[] = [
  { key: "name", label: "Field", width: "minmax(110px,1.3fr)" },
  { key: "type", label: "Type", width: "minmax(120px,1.2fr)" },
  { key: "req", label: "Req", width: "38px", align: "center", title: "Required" },
  { key: "arr", label: "Arr", width: "38px", align: "center", title: "Array" },
];

export function DTODrawer({ nodeId, dtoName, properties, onChange, saveStatus = "idle", onBack }: Props) {
  const fields = (Array.isArray(properties.Fields) ? properties.Fields : []) as DtoField[];

  const setFields = (next: DtoField[]) => onChange({ ...properties, Fields: next });
  const update = (i: number, patch: Partial<DtoField>) =>
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const remove = (i: number) => setFields(fields.filter((_, idx) => idx !== i));
  const add = () => setFields([...fields, newField()]);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = fields.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
  };

  const statusText = saveStatus === "pending" ? "saving…"
    : saveStatus === "success" ? "saved"
    : saveStatus === "error" ? "save failed"
    : undefined;

  return (
    <SubPageShell
      title="Fields"
      subtitle={dtoName || "(unnamed DTO)"}
      onBack={onBack}
      onSave={onBack}
      saveDisabled={saveStatus === "pending"}
      saveStatusText={statusText}
      saveStatusTone={saveStatus}
    >
      <EditGrid
        columns={FIELD_COLS}
        rows={fields}
        rowKey={(_, i) => String(i)}
        addLabel="New field"
        emptyLabel="// no fields"
        onAdd={add}
        onMove={move}
        onDelete={remove}
        renderCell={(f, key, i) => {
          switch (key) {
            case "name":
              return (
                <Input
                  density="cell"
                  variant="mono"
                  value={f.Name}
                  onChange={(v) => update(i, { Name: v })}
                  placeholder="email"
                  spellCheck={false}
                  aria-label="Field name"
                />
              );
            case "type":
              return (
                <ValueSetCombobox
                  density="cell"
                  valueSetId="parameter-types"
                  value={f.DataType}
                  onChange={(v) => update(i, { DataType: v })}
                  placeholder="string / UserDto"
                  ariaLabel="Data type"
                />
              );
            case "req":
              return <ToggleCell tone="family" checked={f.IsRequired} onChange={(v) => update(i, { IsRequired: v })} ariaLabel="Required" />;
            case "arr":
              return <ToggleCell checked={f.IsArray} onChange={(v) => update(i, { IsArray: v })} ariaLabel="Array" />;
            default:
              return null;
          }
        }}
        renderDetail={(f, i) => <FieldDetail nodeId={nodeId} field={f} update={(patch) => update(i, patch)} />}
      />
    </SubPageShell>
  );
}

const RULE_COLS: readonly GridColumn[] = [
  { key: "rule", label: "Rule", width: "minmax(120px,1fr)" },
  { key: "value", label: "Value", width: "minmax(120px,1.2fr)" },
];

function FieldDetail({
  nodeId, field: _f, update,
}: { nodeId: string; field: DtoField; update: (patch: Partial<DtoField>) => void }) {
  const field: DtoField = {
    ..._f,
    ValidationRules: _f.ValidationRules ?? [],
  };

  const setRule = (i: number, patch: Partial<ValidationRule>) =>
    update({ ValidationRules: field.ValidationRules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const addRule = () => update({ ValidationRules: [...field.ValidationRules, { Rule: "MinLength", Value: "1" }] });
  const delRule = (i: number) => update({ ValidationRules: field.ValidationRules.filter((_, idx) => idx !== i) });

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nested DTO ref">
          <NodeRefCombobox
            nodeType="DTO"
            value={field.NestedDTORef ?? ""}
            onChange={(v) => update({ NestedDTORef: v || undefined })}
            placeholder="AddressDto"
            ariaLabel="Nested DTO reference"
            linkAs={nodeId ? { sourceNodeId: nodeId, kind: "HAS" } : undefined}
          />
        </Field>
        <Field label="Enum ref">
          <NodeRefCombobox
            nodeType="Enum"
            value={field.EnumRef ?? ""}
            onChange={(v) => update({ EnumRef: v || undefined })}
            placeholder="UserRole"
            ariaLabel="Enum reference"
            linkAs={nodeId ? { sourceNodeId: nodeId, kind: "USES" } : undefined}
          />
        </Field>
      </div>

      <Field label="Default value">
        <Input
          variant="mono"
          value={field.DefaultValue ?? ""}
          onChange={(v) => update({ DefaultValue: v || undefined })}
          placeholder="(optional)"
          spellCheck={false}
        />
      </Field>

      <div>
        <SectionHeader label="Validation rules" count={field.ValidationRules.length} divider />
        <EditGrid
          columns={RULE_COLS}
          rows={field.ValidationRules}
          rowKey={(_, i) => String(i)}
          addLabel="rule"
          emptyLabel="// no rules"
          onAdd={addRule}
          onDelete={delRule}
          renderCell={(r, key, i) => {
            if (key === "rule") {
              return (
                <Select
                  density="cell"
                  value={r.Rule}
                  onChange={(v) => setRule(i, { Rule: v as ValidationRuleName })}
                  options={VALIDATION_RULES.map((v) => ({ value: v }))}
                  ariaLabel="Validation rule"
                />
              );
            }
            return RULE_NEEDS_VALUE[r.Rule] ? (
              <Input
                density="cell"
                variant="mono"
                value={r.Value ?? ""}
                onChange={(v) => setRule(i, { Value: v || undefined })}
                placeholder={r.Rule === "Regex" || r.Rule === "Pattern" ? "regex pattern" : "value"}
                spellCheck={false}
                aria-label="Rule value"
              />
            ) : (
              <span className="font-mono text-[12px] text-[color:var(--ink-faint)] pl-2">—</span>
            );
          }}
        />
      </div>

      <Field label="Description">
        <Textarea value={field.Description ?? ""} rows={2} onChange={(v) => update({ Description: v || undefined })} />
      </Field>
    </>
  );
}
