/** SchemaForm — renders an inspector form from a backend node-type JSON Schema.
 *  Controller pattern: scalar fields (string/number/bool/enum) directly in the top form.
 *  Array / nested object fields as DrawerTrigger buttons in a "Behavior" section →
 *  push to in-modal subpage. Consistent UX for all 21 types. */

import { useMemo, useState } from "react";
import { useInspectorUpdate } from "../../hooks/useInspectorUpdate";
import { deref, getWidgetKind, humanize, isSystemField, isRequired, type JSONSchema } from "./schema-utils";
import type { FieldHint } from "../../api/node-types";
import { SaveStatus, SectionHeader, DrawerTrigger, SubPageShell } from "./primitives";
import { FieldDispatch } from "./SchemaFields";

interface SchemaFormProps {
  projectId: string;
  nodeId: string;
  properties: Record<string, unknown>;
  fieldHints: Record<string, FieldHint>;
  schema: JSONSchema;
}

/** Which keys are scalar (inline form) / which are complex (subpage trigger). */
function splitKeys(schema: JSONSchema, rootSchema: JSONSchema) {
  const scalar: string[] = [];
  const complex: string[] = [];
  if (!schema.properties) return { scalar, complex };
  for (const key of Object.keys(schema.properties)) {
    if (isSystemField(key)) continue;
    const propSchema = deref(rootSchema, schema.properties[key]);
    const kind = getWidgetKind(propSchema);
    if (kind === "array" || kind === "object") complex.push(key);
    else scalar.push(key);
  }
  return { scalar, complex };
}

export function SchemaForm({
  projectId, nodeId, properties, fieldHints, schema,
}: SchemaFormProps) {
  const { draft, setAll, update } = useInspectorUpdate(projectId, nodeId, properties);
  // Inline subpage state — no modal context (stale snapshot bug fix)
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const status: "idle" | "pending" | "success" | "error" =
    update.isPending ? "pending" :
    update.isError ? "error" :
    update.isSuccess ? "success" :
    "idle";
  const errorMessage = update.error instanceof Error ? update.error.message : undefined;

  // Backend sometimes returns a "Node wrapper schema" ({id, type, ..., properties: {...}}).
  // Form draft = node.properties, i.e. the contents of the "properties" sub-object. If the schema
  // has a nested "properties" key, unwrap it — otherwise form fields won't match the schema
  // (a single DrawerTrigger "Properties" would appear containing Name/Description).
  const formSchema = useMemo(() => {
    if (schema.properties?.properties) {
      const inner = deref(schema, schema.properties.properties);
      if (inner.properties) return inner;
    }
    return schema;
  }, [schema]);

  const { scalar: scalarKeys, complex: complexKeys } = useMemo(
    () => splitKeys(formSchema, formSchema),
    [formSchema],
  );

  // Find the Name field for subpage subtitle (possible keys for each type)
  const nameField = useMemo(() => {
    for (const k of ["Name", "TableName", "ServiceName", "ControllerName", "ClassName", "ViewName", "RepositoryName", "AppName", "ComponentName", "QueueName", "CacheName", "GatewayName", "OrchestratorName", "WorkerName", "HandlerName", "MiddlewareName", "ExceptionName", "ModuleName", "Key"]) {
      if (typeof draft[k] === "string" && (draft[k] as string).length > 0) return draft[k] as string;
    }
    return null;
  }, [draft]);

  // When activeKey is set, render inline — fresh draft + onChange direct
  const activeSchema = activeKey ? formSchema.properties?.[activeKey] : null;
  const activeResolved = activeSchema ? deref(formSchema, activeSchema) : null;

  const itemCount = (key: string): number => {
    const v = draft[key];
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === "object") return Object.keys(v).length;
    return 0;
  };

  // If sub-page is open, render inline — fresh draft, onChange direct to parent state
  if (activeKey && activeResolved) {
    const statusText = status === "pending" ? "saving…"
      : status === "success" ? "saved"
      : status === "error" ? "save failed"
      : undefined;

    return (
      <SubPageShell
        title={humanize(activeKey)}
        subtitle={nameField ?? undefined}
        onBack={() => setActiveKey(null)}
        onSave={() => setActiveKey(null)}
        saveDisabled={status === "pending"}
        saveStatusText={statusText}
        saveStatusTone={status}
      >
        <FieldDispatch
          rootSchema={formSchema}
          fieldKey={activeKey}
          propSchema={activeResolved}
          value={draft[activeKey]}
          onChange={(v) => setAll({ ...draft, [activeKey]: v })}
          fieldHints={fieldHints}
          pathPrefix={activeKey}
          labelOverride=""
          sourceNodeId={nodeId}
        />
      </SubPageShell>
    );
  }

  return (
    <form className="p-form" onSubmit={(e) => e.preventDefault()}>
      {/* Scalar fields — Name, Description, etc. direct input/textarea */}
      {scalarKeys.length > 0 && (
        <div className="p-group-body">
          {scalarKeys.map((key) => {
            const propSchema = formSchema.properties![key];
            return (
              <FieldDispatch
                key={key}
                rootSchema={formSchema}
                fieldKey={key}
                propSchema={propSchema}
                value={draft[key]}
                onChange={(v) => setAll({ ...draft, [key]: v })}
                fieldHints={fieldHints}
                pathPrefix={key}
                required={isRequired(formSchema, key)}
                sourceNodeId={nodeId}
              />
            );
          })}
        </div>
      )}

      {/* Complex fields — array / object → inline subpage */}
      {complexKeys.length > 0 && (
        <div className="p-group">
          <SectionHeader label="Behavior" divider />
          <div className="p-group-body">
            {complexKeys.map((key) => (
              <DrawerTrigger
                key={key}
                label={humanize(key)}
                fieldKey={key}
                count={itemCount(key)}
                onClick={() => setActiveKey(key)}
              />
            ))}
          </div>
        </div>
      )}

      <SaveStatus status={status} errorMessage={errorMessage} />
    </form>
  );
}
