import type { JSONSchema } from "../schema-utils";
import { deref, defaultForSchema, findNameField, humanize } from "../schema-utils";
import type { FieldHint } from "../../../api/node-types";
import { Field, ListContainer, ListRow, Eyebrow, NodeRefList } from "../primitives";
import { SchemaFields, FieldDispatch } from "../SchemaFields";

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
  /** Root node id — for linkAs in nodeRef-hinted arrays */
  sourceNodeId?: string;
}

export function ArrayWidget({
  label, value, onChange, schema, rootSchema, fieldHints, pathPrefix, hint, required, description, sourceNodeId,
}: Props) {
  const items = (Array.isArray(value) ? value : []) as unknown[];
  const itemSchema = schema.items;
  if (!itemSchema) {
    return (
      <Field label={label} required={required} helper="no items schema">
        <div />
      </Field>
    );
  }

  const resolvedItem = deref(rootSchema, itemSchema);
  const itemIsObject = resolvedItem.type === "object";
  const baseLabel = humanize(label).replace(/s$/, "") || "item";

  // Primitive string array + nodeRef hint → NodeRefList (Throws benzeri)
  if (!itemIsObject && resolvedItem.type === "string" && hint?.nodeRef) {
    return (
      <Field label={label} required={required} badge={hint?.badge} helper={description}>
        <NodeRefList
          items={items as string[]}
          onChange={(next) => onChange(next)}
          nodeType={hint.nodeRef.type}
          edgeKind={hint.nodeRef.edgeKind}
          sourceNodeId={sourceNodeId}
        />
      </Field>
    );
  }

  const addItem = () => onChange([...items, defaultForSchema(rootSchema, itemSchema)]);
  const removeItem = (i: number) => onChange(items.filter((_, j) => j !== i));
  const setItem = (i: number, v: unknown) => onChange(items.map((it, j) => (j === i ? v : it)));
  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = items.slice();
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };

  return (
    <Field
      label={`${label} (${items.length})`}
      required={required}
      badge={hint?.badge}
      helper={description}
    >
      <ListContainer
        items={items}
        addLabel={baseLabel}
        renderRow={(item, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === items.length - 1;
          if (itemIsObject) {
            const obj =
              item && typeof item === "object" && !Array.isArray(item)
                ? (item as Record<string, unknown>)
                : {};
            const header = findNameField(obj) ?? `${baseLabel} #${idx + 1}`;
            return (
              <ListRow
                key={idx}
                primary={<Eyebrow>{header}</Eyebrow>}
                onDelete={() => removeItem(idx)}
                onMoveUp={() => moveItem(idx, idx - 1)}
                onMoveDown={() => moveItem(idx, idx + 1)}
                isFirst={isFirst}
                isLast={isLast}
                details={
                  <SchemaFields
                    rootSchema={rootSchema}
                    schema={resolvedItem}
                    value={obj}
                    onChange={(v) => setItem(idx, v)}
                    fieldHints={fieldHints}
                    pathPrefix={`${pathPrefix}.${idx}`}
                    sourceNodeId={sourceNodeId}
                  />
                }
              />
            );
          }
          return (
            <ListRow
              key={idx}
              primary={
                <FieldDispatch
                  rootSchema={rootSchema}
                  fieldKey={`#${idx + 1}`}
                  propSchema={itemSchema}
                  value={item}
                  onChange={(v) => setItem(idx, v)}
                  fieldHints={fieldHints}
                  pathPrefix={`${pathPrefix}.${idx}`}
                  labelOverride=""
                />
              }
              onDelete={() => removeItem(idx)}
              onMoveUp={() => moveItem(idx, idx - 1)}
              onMoveDown={() => moveItem(idx, idx + 1)}
              isFirst={isFirst}
              isLast={isLast}
            />
          );
        }}
        onAdd={addItem}
      />
    </Field>
  );
}

