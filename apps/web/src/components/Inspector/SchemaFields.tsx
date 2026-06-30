/** SchemaFields — renders the properties of an object schema.
 *  Recursive: also called from nested object/array widgets. */

import { useMemo } from "react";
import type { JSONSchema } from "./schema-utils";
import { deref, getWidgetKind, humanize, isRequired, isSystemField, lookupHint } from "./schema-utils";
import type { FieldHint } from "../../api/node-types";
import { SectionHeader } from "./primitives";
import { StringWidget } from "./widgets/StringWidget";
import { NumberWidget } from "./widgets/NumberWidget";
import { BooleanWidget } from "./widgets/BooleanWidget";
import { EnumWidget } from "./widgets/EnumWidget";
import { ArrayWidget } from "./widgets/ArrayWidget";
import { ObjectWidget } from "./widgets/ObjectWidget";

interface SchemaFieldsProps {
  rootSchema: JSONSchema;
  schema: JSONSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  fieldHints: Record<string, FieldHint>;
  pathPrefix: string;
  /** ID of the node being edited — for NodeRefCombobox linkAs (edge creation source) */
  sourceNodeId?: string;
}

export function SchemaFields({
  rootSchema, schema, value, onChange, fieldHints, pathPrefix, sourceNodeId,
}: SchemaFieldsProps) {
  const objSchema = deref(rootSchema, schema);

  const grouped = useMemo(() => {
    if (!objSchema.properties) return [] as Array<[string, string[]]>;
    const groups = new Map<string, string[]>();
    const isRoot = pathPrefix === "";
    for (const key of Object.keys(objSchema.properties)) {
      if (isRoot && isSystemField(key)) continue;
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      const g = lookupHint(fieldHints, path, key)?.group ?? "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(key);
    }
    return [...groups.entries()];
  }, [objSchema, fieldHints, pathPrefix]);

  if (!objSchema.properties) return null;

  return (
    <div className="p-fields">
      {grouped.map(([group, keys], gIdx) => (
        <div className="p-group" key={group || "_default"}>
          {group && <SectionHeader label={group} divider={gIdx > 0} />}
          <div className="p-group-body">
            {keys.map((key) => {
              const propSchema = objSchema.properties![key];
              const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;
              const required = isRequired(objSchema, key);
              return (
                <FieldDispatch
                  key={key}
                  rootSchema={rootSchema}
                  fieldKey={key}
                  propSchema={propSchema}
                  value={value[key]}
                  onChange={(v) => onChange({ ...value, [key]: v })}
                  fieldHints={fieldHints}
                  pathPrefix={fullPath}
                  required={required}
                  sourceNodeId={sourceNodeId}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

interface FieldDispatchProps {
  rootSchema: JSONSchema;
  fieldKey: string;
  propSchema: JSONSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  fieldHints: Record<string, FieldHint>;
  pathPrefix: string;
  required?: boolean;
  /** If empty string is given, label is not rendered (for array primitive items). */
  labelOverride?: string;
  /** Root node ID being edited — for linkAs in nodeRef-hinted fields. */
  sourceNodeId?: string;
}

export function FieldDispatch({
  rootSchema, fieldKey, propSchema, value, onChange, fieldHints, pathPrefix, required, labelOverride, sourceNodeId,
}: FieldDispatchProps) {
  const resolved = deref(rootSchema, propSchema);
  const kind = getWidgetKind(resolved);
  const label = labelOverride !== undefined ? labelOverride : humanize(fieldKey);
  const hint = lookupHint(fieldHints, pathPrefix, fieldKey);
  const common = {
    label,
    fieldKey,
    value,
    onChange,
    hint,
    required,
    description: resolved.description,
  };

  switch (kind) {
    case "enum":
      return <EnumWidget {...common} schema={resolved} />;
    case "string":
      return <StringWidget {...common} schema={resolved} sourceNodeId={sourceNodeId} />;
    case "number":
      return <NumberWidget {...common} schema={resolved} />;
    case "boolean":
      return <BooleanWidget {...common} />;
    case "array":
      return (
        <ArrayWidget
          {...common}
          schema={resolved}
          rootSchema={rootSchema}
          fieldHints={fieldHints}
          pathPrefix={pathPrefix}
          sourceNodeId={sourceNodeId}
        />
      );
    case "object":
      return (
        <ObjectWidget
          {...common}
          schema={resolved}
          rootSchema={rootSchema}
          fieldHints={fieldHints}
          pathPrefix={pathPrefix}
        />
      );
  }
}
