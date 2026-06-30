import type { JSONSchema } from "../schema-utils";
import type { FieldHint } from "../../../api/node-types";
import { Eyebrow, ListRow } from "../primitives";
import { SchemaFields } from "../SchemaFields";

interface Props {
  label: string;
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
  schema: JSONSchema;
  rootSchema: JSONSchema;
  fieldHints: Record<string, FieldHint>;
  pathPrefix: string;
  hint?: FieldHint;
  required?: boolean;
  description?: string;
}

export function ObjectWidget({
  label, value, onChange, schema, rootSchema, fieldHints, pathPrefix, hint, required, description,
}: Props) {
  const obj =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return (
    <ListRow
      primary={
        <span className="p-obj-head">
          <Eyebrow>{label}</Eyebrow>
          {required && <span className="p-req">*</span>}
          {hint?.badge && <span className="p-badge">{hint.badge}</span>}
        </span>
      }
      details={
        <>
          {description && <div className="p-helper p-helper-tight">{description}</div>}
          <SchemaFields
            rootSchema={rootSchema}
            schema={schema}
            value={obj}
            onChange={onChange}
            fieldHints={fieldHints}
            pathPrefix={pathPrefix}
          />
        </>
      }
    />
  );
}
