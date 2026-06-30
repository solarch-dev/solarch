import type { JSONSchema } from "../schema-utils";
import type { FieldHint } from "../../../api/node-types";
import { Field, Pill, Select } from "../primitives";

interface Props {
  label: string;
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
  schema: JSONSchema;
  hint?: FieldHint;
  required?: boolean;
  description?: string;
}

export function EnumWidget({
  label, value, onChange, schema, hint, required, description,
}: Props) {
  const options = (schema.enum ?? []) as (string | number | boolean | null)[];
  const cur = value == null ? "" : String(value);
  const useChips =
    options.length > 0 && options.length <= 4 && options.every((o) => typeof o === "string");

  if (useChips) {
    return (
      <Field label={label} required={required} badge={hint?.badge} helper={description}>
        <div className="p-chips" role="radiogroup">
          {options.map((opt) => {
            const v = String(opt);
            return (
              <Pill
                key={v}
                tone="accent"
                interactive
                active={v === cur}
                onClick={() => onChange(coerce(opt, schema))}
              >
                {v}
              </Pill>
            );
          })}
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} required={required} badge={hint?.badge} helper={description}>
      <Select
        value={cur}
        onChange={(raw) => onChange(coerceRaw(raw, schema))}
        options={options.map((o) => ({ value: String(o), label: String(o) }))}
      />
    </Field>
  );
}

function coerce(opt: string | number | boolean | null, schema: JSONSchema): unknown {
  if (typeof opt === "string" && schema.type !== "string" && schema.type != null) {
    return coerceRaw(opt, schema);
  }
  return opt;
}
function coerceRaw(raw: string, schema: JSONSchema): unknown {
  if (schema.type === "number" || schema.type === "integer") return Number(raw);
  if (schema.type === "boolean") return raw === "true";
  return raw;
}
