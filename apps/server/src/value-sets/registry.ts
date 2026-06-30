/** Solarch value-set registry — static enum/lookup catalog.
 *  Shared domain enums across all node type properties.
 *  Referenced via fieldHint.valueSet; frontend uses Select widget. */

export interface ValueOption {
  /** Canonical machine value — stored in DB/JSON. */
  value: string;
  /** Display label — falls back to value if omitted. */
  label?: string;
  /** Tooltip / description. */
  description?: string;
  /** Subgroup (e.g. primitives, collections, async). */
  group?: string;
}

export interface ValueSet {
  id: string;
  label: string;
  description: string;
  values: ValueOption[];
}

export const VALUE_SETS: Record<string, ValueSet> = {
  // ── Basic types ───────────────────────────────────────────────
  "primitive-types": {
    id: "primitive-types",
    label: "Primitive Types",
    description: "TypeScript / language-agnostic primitive data types.",
    values: [
      { value: "string", description: "Text" },
      { value: "number", description: "Number (float)" },
      { value: "integer", description: "Integer" },
      { value: "boolean", description: "true / false" },
      { value: "Date", description: "Date + time" },
      { value: "UUID", description: "Universally unique identifier" },
      { value: "any", description: "Type unknown (not recommended)" },
      { value: "void", description: "No return value" },
      { value: "null", description: "Empty value" },
    ],
  },

  // ── Parameter / Return tipi (primitives + collection + async) ──
  "parameter-types": {
    id: "parameter-types",
    label: "Parameter / Return Types",
    description: "Commonly used types for method parameters and return values.",
    values: [
      // primitives
      { value: "string", group: "primitive" },
      { value: "number", group: "primitive" },
      { value: "integer", group: "primitive" },
      { value: "boolean", group: "primitive" },
      { value: "Date", group: "primitive" },
      { value: "UUID", group: "primitive" },
      { value: "void", group: "primitive" },
      { value: "any", group: "primitive" },
      // collections
      { value: "string[]", group: "collection" },
      { value: "number[]", group: "collection" },
      { value: "any[]", group: "collection" },
      { value: "Record<string, any>", group: "collection" },
      { value: "Map<string, any>", group: "collection" },
      // async
      { value: "Promise<void>", group: "async" },
      { value: "Promise<string>", group: "async" },
      { value: "Promise<boolean>", group: "async" },
      { value: "Observable<any>", group: "async" },
    ],
  },

  // ── OO visibility ──────────────────────────────────────────────
  visibility: {
    id: "visibility",
    label: "Visibility (Access Modifier)",
    description: "Method/property access level.",
    values: [
      { value: "public", description: "Accessible from outside" },
      { value: "private", description: "Class-internal only" },
      { value: "protected", description: "Class + subclasses" },
    ],
  },

  // ── HTTP ──────────────────────────────────────────────────────
  "http-methods": {
    id: "http-methods",
    label: "HTTP Methods",
    description: "REST endpoint HTTP verbs.",
    values: [
      { value: "GET", description: "Read a resource (idempotent)" },
      { value: "POST", description: "Create a resource" },
      { value: "PUT", description: "Full update (idempotent)" },
      { value: "PATCH", description: "Partial update" },
      { value: "DELETE", description: "Delete a resource (idempotent)" },
      { value: "OPTIONS", description: "CORS preflight, capability discovery" },
      { value: "HEAD", description: "Headers only (no body)" },
    ],
  },

  "http-status": {
    id: "http-status",
    label: "HTTP Status Codes",
    description: "Commonly used HTTP status codes.",
    values: [
      { value: "200", label: "200 OK", group: "success" },
      { value: "201", label: "201 Created", group: "success" },
      { value: "202", label: "202 Accepted", group: "success" },
      { value: "204", label: "204 No Content", group: "success" },
      { value: "301", label: "301 Moved Permanently", group: "redirect" },
      { value: "302", label: "302 Found", group: "redirect" },
      { value: "304", label: "304 Not Modified", group: "redirect" },
      { value: "400", label: "400 Bad Request", group: "client-error" },
      { value: "401", label: "401 Unauthorized", group: "client-error" },
      { value: "403", label: "403 Forbidden", group: "client-error" },
      { value: "404", label: "404 Not Found", group: "client-error" },
      { value: "409", label: "409 Conflict", group: "client-error" },
      { value: "422", label: "422 Unprocessable Entity", group: "client-error" },
      { value: "429", label: "429 Too Many Requests", group: "client-error" },
      { value: "500", label: "500 Internal Server Error", group: "server-error" },
      { value: "502", label: "502 Bad Gateway", group: "server-error" },
      { value: "503", label: "503 Service Unavailable", group: "server-error" },
    ],
  },

  // ── Validation rules ──────────────────────────────────────────
  "validation-rules": {
    id: "validation-rules",
    label: "Validation Rules",
    description: "DTO field validation rule names.",
    values: [
      { value: "Min", description: "Numeric lower bound" },
      { value: "Max", description: "Numeric upper bound" },
      { value: "MinLength", description: "String / array minimum length" },
      { value: "MaxLength", description: "String / array maximum length" },
      { value: "Email", description: "Valid email format" },
      { value: "Url", description: "Valid URL format" },
      { value: "Regex", description: "Regex pattern match" },
      { value: "Pattern", description: "General pattern (Regex alias)" },
      { value: "Positive", description: "Number greater than zero" },
      { value: "Negative", description: "Number less than zero" },
      { value: "Required", description: "Cannot be empty" },
      { value: "Optional", description: "Can be left empty" },
    ],
  },

  // ── DB column data types ──────────────────────────────────────
  "column-data-types": {
    id: "column-data-types",
    label: "Column Data Types",
    description: "SQL DDL column types (common PostgreSQL/MySQL set).",
    values: [
      { value: "INT", group: "numeric" },
      { value: "BIGINT", group: "numeric" },
      { value: "FLOAT", group: "numeric" },
      { value: "DECIMAL", description: "With Precision + Scale", group: "numeric" },
      { value: "VARCHAR", description: "Length parameter required", group: "text" },
      { value: "TEXT", description: "Unlimited length", group: "text" },
      { value: "BOOLEAN", group: "boolean" },
      { value: "DATE", group: "date" },
      { value: "DATETIME", description: "Date + time", group: "date" },
      { value: "UUID", group: "identifier" },
      { value: "JSON", description: "JSON / JSONB", group: "structured" },
      { value: "ENUM", description: "Reference via EnumRef required", group: "structured" },
    ],
  },

  // ── ORM relations ─────────────────────────────────────────────
  "relation-types": {
    id: "relation-types",
    label: "Relation Types",
    description: "ORM relationship cardinality.",
    values: [
      { value: "OneToOne", description: "1:1 — User ↔ Profile" },
      { value: "OneToMany", description: "1:N — User ↔ Orders" },
      { value: "ManyToOne", description: "N:1 — Orders → User" },
      { value: "ManyToMany", description: "N:N — Students ↔ Courses (junction table)" },
    ],
  },

  // ── Foreign key actions ───────────────────────────────────────
  "on-delete-actions": {
    id: "on-delete-actions",
    label: "ON DELETE / UPDATE Actions",
    description: "Foreign key referential integrity actions.",
    values: [
      { value: "CASCADE", description: "When the parent is deleted, the child is deleted too" },
      { value: "RESTRICT", description: "Prevent deletion if a child exists" },
      { value: "SET_NULL", description: "The FK on the child is set to NULL (column must be nullable)" },
      { value: "NO_ACTION", description: "DB-level default (usually RESTRICT)" },
    ],
  },

  // ── Protocols ─────────────────────────────────────────────────
  protocols: {
    id: "protocols",
    label: "Communication Protocols",
    description: "Inter-service communication protocols.",
    values: [
      { value: "HTTP", description: "Over REST / GraphQL" },
      { value: "gRPC", description: "Protocol Buffers + HTTP/2" },
      { value: "TCP", description: "Low-level stream" },
      { value: "WebSocket", description: "Bidirectional persistent" },
      { value: "AMQP", description: "RabbitMQ messaging" },
      { value: "MQTT", description: "IoT / pub-sub" },
    ],
  },

  // ── Service dependency kinds ─────────────────────────────────
  "service-dep-kinds": {
    id: "service-dep-kinds",
    label: "Service Dependency Kinds",
    description: "The injected dependency type of a Service.",
    values: [
      { value: "Repository", description: "Persistence layer (DB)" },
      { value: "Service", description: "Another bounded-context service" },
      { value: "Cache", description: "Redis / Memcached etc." },
      { value: "ExternalService", description: "Stripe, SendGrid, OpenAI etc." },
    ],
  },

  // ── Middleware types ─────────────────────────────────────────
  "middleware-types": {
    id: "middleware-types",
    label: "Middleware Types",
    description: "Pipeline middleware category.",
    values: [
      { value: "Auth", description: "JWT / session validation" },
      { value: "Logging", description: "Request logging" },
      { value: "RateLimit", description: "Per-IP / per-user request counter" },
      { value: "Cors", description: "CORS headers" },
      { value: "Compression", description: "gzip / brotli response" },
      { value: "ErrorHandler", description: "Global exception → JSON" },
      { value: "Custom", description: "Other" },
    ],
  },

  // ── Middleware applies-to scope ──────────────────────────────
  "middleware-scope": {
    id: "middleware-scope",
    label: "Middleware Scope",
    description: "The scope the middleware is applied to.",
    values: [
      { value: "Global", description: "On all routes" },
      { value: "SpecificRoutes", description: "Only on specific endpoints" },
    ],
  },

  // ── Enum backing type ────────────────────────────────────────
  "enum-backing-types": {
    id: "enum-backing-types",
    label: "Enum Backing Types",
    description: "Storage type of enum values.",
    values: [
      { value: "string", description: "String backing (recommended)" },
      { value: "int", description: "Integer backing (legacy)" },
    ],
  },

  // ── View refresh strategy ────────────────────────────────────
  "view-refresh-strategy": {
    id: "view-refresh-strategy",
    label: "View Refresh Strategy",
    description: "Materialized view refresh trigger.",
    values: [
      { value: "onDemand", description: "Via a manual REFRESH command" },
      { value: "scheduled", description: "Cron schedule" },
      { value: "onChange", description: "On change in the source tables" },
    ],
  },
};

export const VALUE_SET_IDS = Object.keys(VALUE_SETS);
