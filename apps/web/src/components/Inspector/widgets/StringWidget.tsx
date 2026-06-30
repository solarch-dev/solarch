import type { JSONSchema } from "../schema-utils";
import { getStringVariant } from "../schema-utils";
import type { FieldHint } from "../../../api/node-types";
import { Field, Input, Textarea, ValueSetSelect, NodeRefCombobox } from "../primitives";

interface Props {
  label: string;
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
  schema: JSONSchema;
  hint?: FieldHint;
  required?: boolean;
  description?: string;
  /** Root node id — for linkAs when nodeRef hint is present */
  sourceNodeId?: string;
}

export function StringWidget({
  label, fieldKey, value, onChange, schema, hint, required, description, sourceNodeId,
}: Props) {
  const str = value == null ? "" : String(value);
  const variant = getStringVariant(schema, fieldKey);
  const placeholder = placeholderFor(variant);

  // If fieldHint.nodeRef exists → NodeRefCombobox (autocomplete + create from project nodes)
  if (hint?.nodeRef) {
    return (
      <Field label={label} required={required} badge={hint?.badge} helper={description}>
        <NodeRefCombobox
          nodeType={hint.nodeRef.type}
          value={str}
          onChange={(v) => onChange(v)}
          ariaLabel={label}
          linkAs={hint.nodeRef.edgeKind && sourceNodeId
            ? { sourceNodeId, kind: hint.nodeRef.edgeKind }
            : undefined}
        />
      </Field>
    );
  }

  // If fieldHint.valueSet exists → Select widget (from backend value-sets registry)
  if (hint?.valueSet) {
    return (
      <Field label={label} required={required} badge={hint?.badge} helper={description}>
        <ValueSetSelect
          valueSetId={hint.valueSet}
          value={str}
          onChange={onChange}
          ariaLabel={label}
        />
      </Field>
    );
  }

  const isMultiline = variant === "textarea" || variant === "sql";
  const isMono = variant === "code" || variant === "cron" || variant === "sql";
  const inputType =
    variant === "url" ? "url" :
    variant === "email" ? "email" :
    variant === "date" ? "date" :
    variant === "datetime" ? "datetime-local" :
    variant === "color" ? "color" :
    "text";

  const helperBits: string[] = [];
  if (description) helperBits.push(description);
  if (schema.maxLength != null && str.length > schema.maxLength * 0.7) {
    helperBits.push(`${str.length}/${schema.maxLength}`);
  }
  if (variant === "cron") helperBits.push("format: minute hour day month weekday");
  if (variant === "sql") helperBits.push("SQL expression");
  const helper = helperBits.length > 0 ? helperBits.join(" · ") : undefined;

  return (
    <Field label={label} required={required} badge={hint?.badge} helper={helper}>
      {isMultiline ? (
        <Textarea
          variant={isMono ? "mono" : "text"}
          rows={variant === "sql" ? 4 : 3}
          value={str}
          onChange={onChange}
          maxLength={schema.maxLength}
          placeholder={placeholder}
        />
      ) : (
        <Input
          variant={isMono ? "mono" : "text"}
          type={inputType}
          value={str}
          onChange={onChange}
          maxLength={schema.maxLength}
          minLength={schema.minLength}
          placeholder={placeholder}
        />
      )}
    </Field>
  );
}

function placeholderFor(variant: string): string | undefined {
  switch (variant) {
    case "url": return "https://...";
    case "email": return "you@example.com";
    case "cron": return "0 0 * * *";
    case "sql": return "SELECT * FROM ...";
    case "code": return "regex / pattern";
    default: return undefined;
  }
}
