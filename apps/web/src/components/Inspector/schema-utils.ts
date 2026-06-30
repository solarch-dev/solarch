/** JSON Schema helpers — for rendering the backend's node-type schema. */

export interface JSONSchema {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
  enum?: readonly (string | number | boolean | null)[];
  properties?: Record<string, JSONSchema>;
  required?: readonly string[];
  items?: JSONSchema;
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  definitions?: Record<string, JSONSchema>;
  default?: unknown;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  format?: string;
}

export type WidgetKind = "enum" | "string" | "number" | "boolean" | "array" | "object";

/** Resolves a `#/$defs/Foo` or `#/definitions/Foo` style reference within the root. */
export function resolveRef(root: JSONSchema, ref: string): JSONSchema {
  if (!ref.startsWith("#/")) {
    throw new Error(`[schema-utils] Unexpected $ref: ${ref}`);
  }
  const parts = ref.slice(2).split("/");
  let cur: unknown = root;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      throw new Error(`[schema-utils] $ref target not found: ${ref}`);
    }
  }
  return cur as JSONSchema;
}

/** Resolves if schema has $ref; returns as-is otherwise. Unwraps chained refs. */
export function deref(root: JSONSchema, schema: JSONSchema): JSONSchema {
  let s = schema;
  let safety = 0;
  while (s.$ref && safety++ < 16) {
    s = resolveRef(root, s.$ref);
  }
  return s;
}

/** Widget type for a field. */
export function getWidgetKind(schema: JSONSchema): WidgetKind {
  if (schema.enum && schema.enum.length > 0) return "enum";
  switch (schema.type) {
    case "string": return "string";
    case "number":
    case "integer": return "number";
    case "boolean": return "boolean";
    case "array": return "array";
    case "object": return "object";
    default: return "string";
  }
}

/** Generate an empty/default value from schema (for array push). */
export function defaultForSchema(root: JSONSchema, schema: JSONSchema): unknown {
  const s = deref(root, schema);
  if (s.default !== undefined) return s.default;
  if (s.enum && s.enum.length > 0) return s.enum[0];
  switch (s.type) {
    case "string": return "";
    case "number":
    case "integer": return 0;
    case "boolean": return false;
    case "array": return [];
    case "object": {
      const obj: Record<string, unknown> = {};
      if (s.properties) {
        for (const [key, prop] of Object.entries(s.properties)) {
          obj[key] = defaultForSchema(root, prop);
        }
      }
      return obj;
    }
    default: return null;
  }
}

/** camelCase / snake_case → "Human Readable" title. */
export function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Name-like field of an object for array item headers. */
const NAME_KEYS = [
  "Name", "name", "TableName", "ServiceName", "ControllerName", "FieldName",
  "ColumnName", "MethodName", "HandlerName", "RepositoryName", "CacheName",
  "QueueName", "GatewayName", "WorkerName", "OrchestratorName", "ComponentName",
  "AppName", "MiddlewareName", "ExceptionName", "ModuleName", "ViewName",
  "Key", "key", "Label", "label", "Path", "path", "Route",
];
export function findNameField(obj: Record<string, unknown>): string | undefined {
  for (const k of NAME_KEYS) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

/** fieldHints lookup — also tries dotted path with indices stripped.
 *  Backend: "Columns.IsPrimaryKey"; runtime path: "Columns.0.IsPrimaryKey". */
import type { FieldHint } from "../../api/node-types";
export function lookupHint(
  fieldHints: Record<string, FieldHint>,
  fullPath: string,
  key: string,
): FieldHint | undefined {
  if (fieldHints[fullPath]) return fieldHints[fullPath];
  const stripped = fullPath.split(".").filter((p) => !/^\d+$/.test(p)).join(".");
  if (stripped && stripped !== fullPath && fieldHints[stripped]) return fieldHints[stripped];
  if (fieldHints[key]) return fieldHints[key];
  return undefined;
}

/** Meta fields managed by the backend — not editable in the Inspector. */
const SYSTEM_FIELDS = new Set<string>([
  "id", "type", "kind",
  "createdAt", "updatedAt", "deletedAt",
  "homeTabId", "projectId", "tabId",
  "x", "y", "position", "Position",
  "width", "height", "w", "h",
  "isReference", "originTabId",
  "_id", "_rev", "_neo4j_id",
]);

export function isSystemField(key: string): boolean {
  return SYSTEM_FIELDS.has(key);
}

/** String input variant — JSON Schema format + name-pattern fallback. */
export type StringVariant = "text" | "textarea" | "url" | "email" | "date" | "datetime" | "color" | "code" | "cron" | "sql";

/** Variant guess from field name — fallback when backend doesn't provide a format hint. */
const NAME_TO_VARIANT: Record<string, StringVariant> = {
  // cron / schedule
  Schedule: "cron",
  Cron: "cron",
  CronExpression: "cron",
  // URL
  BaseURL: "url",
  URL: "url",
  Url: "url",
  Endpoint: "url",
  CallbackURL: "url",
  WebhookURL: "url",
  // email
  Email: "email",
  ContactEmail: "email",
  // SQL / kod
  Definition: "sql",
  Query: "sql",
  Sql: "sql",
  SQL: "sql",
  CustomQuery: "sql",
  // regex / pattern (monospace)
  Pattern: "code",
  Regex: "code",
  ValidationPattern: "code",
  KeyPattern: "code",
  Expression: "code",
  // long description
  Description: "textarea",
  Notes: "textarea",
  Documentation: "textarea",
  ErrorMessage: "textarea",
  // tarih
  Date: "date",
  StartDate: "date",
  EndDate: "date",
  CreatedDate: "datetime",
  ModifiedDate: "datetime",
};

export function getStringVariant(schema: JSONSchema, key: string): StringVariant {
  // 1) JSON Schema format is most reliable (backend provided explicitly)
  if (schema.format) {
    switch (schema.format) {
      case "uri":
      case "uri-reference":
      case "url":
        return "url";
      case "email": return "email";
      case "date": return "date";
      case "date-time": return "datetime";
      case "color": return "color";
      case "textarea": return "textarea";
    }
  }
  // 2) Name-pattern fallback
  if (NAME_TO_VARIANT[key]) return NAME_TO_VARIANT[key];
  // 3) Length hint → textarea
  if (schema.maxLength != null && schema.maxLength > 200) return "textarea";
  return "text";
}

/** Is this key required in the object schema? */
export function isRequired(parentSchema: JSONSchema, key: string): boolean {
  return Array.isArray(parentSchema.required) && parentSchema.required.includes(key);
}
