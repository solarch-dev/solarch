import type { FieldHint } from "../../api/node-types";
import type { JSONSchema } from "./schema-utils";
import { SchemaForm } from "./SchemaForm";

/** GenericForm — renders an inspector form from a backend node-type JSON Schema.
 *  All logic is in SchemaForm + widgets/. This wrapper only checks "is schema loaded?". */
export function GenericForm({
  projectId, nodeId, properties, fieldHints, schema,
}: {
  projectId: string;
  nodeId: string;
  tabId: string;
  type: string;
  properties: Record<string, unknown>;
  fieldHints: Record<string, FieldHint>;
  schema?: JSONSchema;
}) {
  if (!schema) {
    return <div className="font-mono text-[12px] text-[color:var(--ink-faint)] py-3">loading schema…</div>;
  }
  return (
    <SchemaForm
      projectId={projectId}
      nodeId={nodeId}
      properties={properties}
      fieldHints={fieldHints}
      schema={schema}
    />
  );
}
