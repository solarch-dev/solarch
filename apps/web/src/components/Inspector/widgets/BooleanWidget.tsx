import type { FieldHint } from "../../../api/node-types";
import { Field, Switch } from "../primitives";

interface Props {
  label: string;
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
  hint?: FieldHint;
  required?: boolean;
  description?: string;
}

export function BooleanWidget({ label, value, onChange, hint, required, description }: Props) {
  const checked = Boolean(value);
  return (
    <Field label={label} layout="row" required={required} badge={hint?.badge} helper={description}>
      <Switch checked={checked} onChange={onChange} ariaLabel={label} />
    </Field>
  );
}
