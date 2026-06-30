import type { JSONSchema } from "../schema-utils";
import type { FieldHint } from "../../../api/node-types";
import { Field, Input } from "../primitives";

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

interface NumSchema extends JSONSchema {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

export function NumberWidget({
  label, value, onChange, schema, hint, required, description,
}: Props) {
  const s = schema as NumSchema;
  const num = typeof value === "number" ? value : (value == null ? "" : Number(value));
  const display = typeof num === "number" && Number.isNaN(num) ? "" : (num as number | string);
  const step = s.multipleOf ?? (schema.type === "integer" ? 1 : undefined);

  const helperBits: string[] = [];
  if (description) helperBits.push(description);
  const min = s.minimum ?? s.exclusiveMinimum;
  const max = s.maximum ?? s.exclusiveMaximum;
  if (min != null && max != null) helperBits.push(`${min}–${max} range`);
  else if (min != null) helperBits.push(`min ${min}`);
  else if (max != null) helperBits.push(`max ${max}`);
  const helper = helperBits.length > 0 ? helperBits.join(" · ") : undefined;

  return (
    <Field label={label} required={required} badge={hint?.badge} helper={helper}>
      <Input
        type="number"
        value={display}
        onChange={(raw) => {
          if (raw === "") {
            onChange(0);
          } else {
            const n = Number(raw);
            if (!Number.isNaN(n)) onChange(n);
          }
        }}
        min={min}
        max={max}
        step={step}
      />
    </Field>
  );
}
