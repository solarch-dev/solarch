/** openapi.ts — pure OpenAPI 3.1 helpers for the Solarch-native API reference.
 *
 *  This file owns the two responsibilities Scalar's store does internally, reimplemented as plain TS
 *  so the presentational components stay dumb: (1) `$ref` resolution and (2) a tag -> operation nav
 *  tree (plus a flat model list). It also generates example values from a schema for response/body
 *  previews. No app imports, no React — portable by design (Plan B bundles these files standalone).
 *
 *  Studied (real Scalar source) and reimplemented in TS:
 *  - features/Search/helpers/create-search-index.ts — the recursive nav walk that branches by entry
 *    type (operation / model / tag). Scalar pre-bakes an `x-scalar-navigation` tree; we build the
 *    same shape directly from `paths` + `tags` + `components.schemas` (buildNav + listSchemas).
 *  - features/example-responses/ExampleResponse.vue — shows `getExampleFromSchema(schema, {
 *    emptyString: 'string', mode: 'read' })` over a deep-resolved schema; `exampleFromSchema` mirrors
 *    that contract (resolve refs, prefer example/default/const/enum, recurse, scalar placeholder).
 *  - components/Content/Schema/helpers/get-ref-name.ts — `#/components/schemas/Name` -> `Name`;
 *    `getRefName` reimplements it (with JSON Pointer token unescaping).
 *  - components/Content/Schema/helpers/get-schema-type.ts — type priority (const, array, raw type);
 *    `schemaType` is a scoped single-type version (our emitter never unions types).
 *
 *  Scope matches what the backend `projectOpenApi` emits: object (properties + required), array
 *  (items), `$ref` -> `#/components/schemas/*`, enum, scalar (type + format + validation keywords).
 *  Composition (oneOf/allOf/anyOf/discriminator) is NOT emitted by our backend; helpers degrade
 *  gracefully rather than modelling the full composition surface. */

/** A schema or schema-fragment. Loose on purpose — we only read the keys our emitter produces. */
export type Schema = Record<string, unknown>;

/** A single request/response parameter (path or query for our emitter). */
export interface ParameterObject {
  name: string;
  in: "path" | "query" | "header" | "cookie" | string;
  required?: boolean;
  description?: string;
  schema?: Schema;
  [key: string]: unknown;
}

/** One media-type entry of a request body or response (we only use `application/json`). */
export interface MediaTypeObject {
  schema?: Schema;
  example?: unknown;
  examples?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RequestBodyObject {
  required?: boolean;
  description?: string;
  content?: Record<string, MediaTypeObject>;
  [key: string]: unknown;
}

export interface ResponseObject {
  description?: string;
  content?: Record<string, MediaTypeObject>;
  [key: string]: unknown;
}

/** A single operation under a path item (the value of `paths[path][method]`). */
export interface OperationObject {
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
  security?: Array<Record<string, string[]>>;
  [key: string]: unknown;
}

/** A path item — a map of HTTP method -> operation (plus optional shared `parameters`, etc.). */
export type PathItem = Record<string, unknown>;

/** The OpenAPI document we render. Structurally identical to the host's `OpenApiDoc` (src/api) so a
 *  fetched doc passes straight in without a cast. */
export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
  tags?: { name: string; description?: string }[];
}

/** Result of resolving a (possibly `$ref`) schema: the concrete schema plus the model name if it
 *  came from `#/components/schemas/*` (used to render a "type · ModelName" label). */
export interface ResolvedSchema {
  schema: Schema;
  refName?: string;
}

/** One operation row in the sidebar / content selection. `id = method + ":" + path`. */
export interface NavOp {
  id: string;
  method: string;
  path: string;
  summary?: string;
  operation: OperationObject;
}

/** A tag group in the sidebar: a tag and its operations (document order within the group). */
export interface NavGroup {
  tag: string;
  description?: string;
  operations: NavOp[];
}

/** HTTP methods we recognise on a path item, in canonical order. */
export const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/** Fallback tag for operations with no `tags[0]`. */
const DEFAULT_TAG = "default";

/** Unescape JSON Pointer reference tokens (`~1` -> `/`, `~0` -> `~`). */
function decodeRefToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Extract the model name from a `$ref` string.
 *
 *  `#/components/schemas/Name` -> `Name`; falls back to the last path segment for any other pointer.
 *  Reimplements Scalar's `get-ref-name.ts`. */
export function getRefName(ref: string): string | undefined {
  if (!ref) {
    return undefined;
  }
  const schemaMatch = /#\/components\/schemas\/(.+)$/.exec(ref);
  if (schemaMatch) {
    return decodeRefToken(schemaMatch[1]);
  }
  const parts = ref.split("/");
  const last = parts[parts.length - 1];
  return last ? decodeRefToken(last) : undefined;
}

/** Resolve a schema-or-`$ref` against the document.
 *
 *  `{ $ref: '#/components/schemas/X' }` -> `doc.components.schemas.X` + `refName: 'X'`; anything else
 *  is returned as-is. An unresolvable ref returns an empty schema but keeps `refName` for display. */
export function resolveRef(doc: OpenApiDoc, schemaOrRef: unknown): ResolvedSchema {
  if (
    schemaOrRef &&
    typeof schemaOrRef === "object" &&
    typeof (schemaOrRef as Record<string, unknown>).$ref === "string"
  ) {
    const ref = (schemaOrRef as { $ref: string }).$ref;
    const refName = getRefName(ref);
    if (refName) {
      const target = doc.components?.schemas?.[refName];
      if (target && typeof target === "object") {
        return { schema: target as Schema, refName };
      }
    }
    return { schema: {}, refName };
  }
  return { schema: (schemaOrRef ?? {}) as Schema };
}

/** Build the sidebar nav: operations grouped by their first tag.
 *
 *  Group order follows `doc.tags` (the order the document declares them, matching Scalar), then any
 *  tags discovered only on operations, then `default`. Within a group, operations keep document
 *  order. Empty declared tags (no operations) are dropped. */
export function buildNav(doc: OpenApiDoc): NavGroup[] {
  const groups = new Map<string, NavGroup>();
  const order: string[] = [];

  const ensure = (tag: string, description?: string): NavGroup => {
    let group = groups.get(tag);
    if (!group) {
      group = { tag, description, operations: [] };
      groups.set(tag, group);
      order.push(tag);
    }
    return group;
  };

  // Seed groups in declared-tag order so the sidebar matches the document's tag ordering.
  for (const tag of doc.tags ?? []) {
    ensure(tag.name, tag.description);
  }

  for (const [path, pathItemRaw] of Object.entries(doc.paths ?? {})) {
    const pathItem = (pathItemRaw ?? {}) as PathItem;
    for (const method of HTTP_METHODS) {
      const opRaw = pathItem[method];
      if (!opRaw || typeof opRaw !== "object") {
        continue;
      }
      const operation = opRaw as OperationObject;
      const tag = operation.tags?.[0] ?? DEFAULT_TAG;
      ensure(tag).operations.push({
        id: `${method}:${path}`,
        method,
        path,
        summary: operation.summary,
        operation,
      });
    }
  }

  return order.map((tag) => groups.get(tag)!).filter((group) => group.operations.length > 0);
}

/** List the reusable component schemas (the "Schemas"/models section), in document order. */
export function listSchemas(doc: OpenApiDoc): { name: string; schema: Schema }[] {
  const schemas = doc.components?.schemas ?? {};
  return Object.entries(schemas).map(([name, schema]) => ({
    name,
    schema: (schema ?? {}) as Schema,
  }));
}

/** The structural type of a schema: a single `type`, or the first entry of a `type` array. Empty
 *  string when no type is present (e.g. a bare `$ref` or composition node). */
export function schemaType(schema: Schema): string {
  const type = schema.type;
  if (typeof type === "string") {
    return type;
  }
  if (Array.isArray(type) && typeof type[0] === "string") {
    return type[0];
  }
  return "";
}

/** Placeholder value for a scalar schema, honouring common string formats. */
function scalarExample(schema: Schema, type: string): unknown {
  switch (type) {
    case "string": {
      const format = typeof schema.format === "string" ? schema.format : undefined;
      if (format === "date-time") {
        return new Date().toISOString();
      }
      if (format === "date") {
        return new Date().toISOString().slice(0, 10);
      }
      if (format === "uuid") {
        return "00000000-0000-0000-0000-000000000000";
      }
      if (format === "email") {
        return "user@example.com";
      }
      if (format === "uri") {
        return "https://example.com";
      }
      return "string";
    }
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      // Unknown / composition node (oneOf/allOf/anyOf) — degrade gracefully.
      return null;
  }
}

/** Generate an example value from a schema (resolving `$ref`s along the way).
 *
 *  Priority mirrors Scalar's `getExampleFromSchema`: explicit `example` / `default` / `const` / first
 *  `enum` win; then object -> `{ prop: example(child) }`, array -> `[example(items)]`, scalar -> a
 *  typed placeholder. `seen` tracks the current `$ref` expansion path so self-referential schemas
 *  terminate instead of recursing forever (a fresh copy per descent keeps sibling refs independent). */
export function exampleFromSchema(doc: OpenApiDoc, schema: unknown, seen: Set<string> = new Set<string>()): unknown {
  const { schema: resolved, refName } = resolveRef(doc, schema);

  // Cycle guard — a ref already on the current expansion path stops here.
  let nextSeen = seen;
  if (refName) {
    if (seen.has(refName)) {
      return {};
    }
    nextSeen = new Set(seen).add(refName);
  }

  // Explicit example signals (highest priority).
  if ("example" in resolved && resolved.example !== undefined) {
    return resolved.example;
  }
  if ("default" in resolved && resolved.default !== undefined) {
    return resolved.default;
  }
  if ("const" in resolved && resolved.const !== undefined) {
    return resolved.const;
  }
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0];
  }

  const type = schemaType(resolved);

  // Object — expand each property.
  if (type === "object" || (resolved.properties && typeof resolved.properties === "object")) {
    const properties = (resolved.properties ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(properties)) {
      out[key] = exampleFromSchema(doc, propSchema, nextSeen);
    }
    return out;
  }

  // Array — a single example item.
  if (type === "array" || resolved.items !== undefined) {
    return [exampleFromSchema(doc, resolved.items, nextSeen)];
  }

  return scalarExample(resolved, type);
}
