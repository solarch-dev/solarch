/**
 * SchemaTree — the recursive OpenAPI schema renderer (the crux of the reference).
 *
 * Reimplements, in React + Solarch tokens, the structure of Scalar's schema
 * component tree (studied from the real Vue source):
 *   - Content/Schema/Schema.vue              — the "card" that resolves a schema, decides
 *                                              object-vs-not, and owns the collapse/expand
 *                                              disclosure (toggle shown only when nested).
 *   - Content/Schema/SchemaObjectProperties.vue — iterates `properties`, one row per property,
 *                                              required-first ordering, `required` derived from
 *                                              the parent's `required[]`.
 *   - Content/Schema/SchemaProperty.vue      — a single property row: heading + description +
 *                                              enum + nested children for object / array-of-object.
 *   - Content/Schema/SchemaPropertyHeading.vue — the flex-wrap heading line: name (mono) + type
 *                                              detail + "· ModelName" + validation details +
 *                                              `required` marker (orange in Scalar).
 *   - Content/Schema/helpers/get-schema-type.ts — type priority (const, array "X[]", raw type).
 *
 * We do NOT copy Scalar's CSS or visual identity — surfaces/text/borders use Solarch design
 * tokens (var(--paper-raised) / var(--ink*) / hsl(var(--border)) / var(--accent)), JetBrains Mono
 * for the structural code text and Satoshi (sans) for prose, dark/light handled by the existing
 * `.dark` token flip. No gradients, no glassmorphism, no fully-rounded pills.
 *
 * Scope = exactly what the backend `projectOpenApi` emits: object (properties + required), array
 * (items), `$ref` -> `#/components/schemas/*`, enum, scalar (type + format + validation keywords),
 * description. Composition (oneOf/allOf/anyOf/discriminator) is not emitted by our backend, so it is
 * not modelled — such a node simply degrades to its plain type + any description.
 *
 * Portable (props-only): the only imports are React + the pure `openapi.ts` helpers. No app store /
 * router / react-query / `@/`-singletons, so Plan B can bundle this file standalone for the
 * generated app's `/docs`.
 */

import { useState } from "react";
import type { OpenApiDoc, Schema } from "./openapi";
import { resolveRef, schemaType } from "./openapi";
import { Markdown } from "./Markdown";

/** Structural classification of a (resolved) schema node. */
type SchemaKind = "object" | "array" | "enum" | "scalar" | "const";

/** Everything a heading/branch needs about one schema node, computed once per render. */
interface Described {
  kind: SchemaKind;
  /** The concrete schema after `$ref` resolution. */
  resolved: Schema;
  /** Model name when this node came from `#/components/schemas/*` (drives the "· Model" label). */
  refName?: string;
  /** The structural type word shown in the heading ("object" / "array" / "string" / "any" / ...). */
  typeDetail: string;
  /** Referenced-model label shown after the type ("Model", or "Model[]" for arrays of a model). */
  modelName?: string;
  /** Validation keyword summaries (format, minLength, min, pattern, ...). */
  constraints: string[];
  isEnum: boolean;
  enumValues?: unknown[];
  constValue?: unknown;
  /** For arrays: the resolved `items` schema and whether it is itself an object worth expanding. */
  itemsSchema?: Schema;
  itemsIsObject?: boolean;
}

/** Truncate long literals (e.g. regex patterns) so the heading line stays readable. */
function truncate(value: string, max = 28): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Render a literal (enum value / const) compactly: strings verbatim, everything else as JSON. */
function formatLiteral(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Count the own properties of an object schema (0 when it has none / is not an object). */
function propertyCount(schema: Schema): number {
  const props = schema.properties;
  return props && typeof props === "object" ? Object.keys(props as object).length : 0;
}

/**
 * Collect validation-keyword summaries, mirroring SchemaPropertyHeading's `validationProperties`
 * but scoped to the keywords our emitter produces. String length uses "minLength/maxLength" so it
 * does not collide with numeric "min/max".
 */
function constraintsOf(schema: Schema): string[] {
  const out: string[] = [];
  const num = (v: unknown): v is number => typeof v === "number";

  if (typeof schema.format === "string") {
    out.push(schema.format);
  }
  if (num(schema.minLength)) {
    out.push(`minLength: ${schema.minLength}`);
  }
  if (num(schema.maxLength)) {
    out.push(`maxLength: ${schema.maxLength}`);
  }
  if (typeof schema.pattern === "string") {
    out.push(`pattern: ${truncate(schema.pattern)}`);
  }
  if (num(schema.minimum)) {
    out.push(`min: ${schema.minimum}`);
  }
  if (num(schema.exclusiveMinimum)) {
    out.push(`> ${schema.exclusiveMinimum}`);
  }
  if (num(schema.maximum)) {
    out.push(`max: ${schema.maximum}`);
  }
  if (num(schema.exclusiveMaximum)) {
    out.push(`< ${schema.exclusiveMaximum}`);
  }
  if (num(schema.multipleOf)) {
    out.push(`multiple of ${schema.multipleOf}`);
  }
  if (num(schema.minItems) || num(schema.maxItems)) {
    out.push(`${num(schema.minItems) ? schema.minItems : ""}…${num(schema.maxItems) ? schema.maxItems : ""} items`);
  }
  if (schema.uniqueItems === true) {
    out.push("unique");
  }
  return out;
}

/**
 * Classify a schema-or-`$ref` for rendering. Resolves the ref, then branches array / object / enum
 * / const / scalar in the same priority order Scalar's `get-schema-type` uses (const and array are
 * special-cased; everything else falls back to the raw type).
 */
function describe(doc: OpenApiDoc, rawSchema: unknown): Described {
  const { schema, refName } = resolveRef(doc, rawSchema);
  const baseType = schemaType(schema);
  const hasProps = propertyCount(schema) > 0;
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  const constValue = "const" in schema && schema.const !== undefined ? schema.const : undefined;
  const constraints = constraintsOf(schema);

  // Array — describe the element type and whether it is expandable.
  if (baseType === "array" || schema.items !== undefined) {
    const { schema: itemsSchema, refName: itemsRef } = resolveRef(doc, schema.items);
    const itemsType = schemaType(itemsSchema);
    const itemsIsObject = itemsType === "object" || propertyCount(itemsSchema) > 0;
    let typeDetail = "array";
    let modelName: string | undefined;
    if (itemsRef) {
      modelName = `${itemsRef}[]`;
    } else if (!itemsIsObject && itemsType) {
      typeDetail = `array ${itemsType}[]`;
    }
    return { kind: "array", resolved: schema, refName, typeDetail, modelName, constraints, isEnum: false, itemsSchema, itemsIsObject };
  }

  // Object.
  if (hasProps || baseType === "object") {
    return { kind: "object", resolved: schema, refName, typeDetail: "object", modelName: refName, constraints, isEnum: false };
  }

  // Enum (no properties).
  if (enumValues && enumValues.length > 0) {
    return { kind: "enum", resolved: schema, refName, typeDetail: baseType || "enum", modelName: refName, constraints, isEnum: true, enumValues };
  }

  // Const literal.
  if (constValue !== undefined) {
    return { kind: "const", resolved: schema, refName, typeDetail: baseType, modelName: refName, constraints, isEnum: false, constValue };
  }

  // Scalar (or an unconstrained / composition node, which degrades to "any").
  return { kind: "scalar", resolved: schema, refName, typeDetail: baseType || "any", modelName: refName, constraints, isEnum: false };
}

/** A small disclosure caret that points right (closed) / down (open). */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden
      className="mt-[3px] shrink-0 text-[var(--ink-faint)]"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms ease" }}
    >
      <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Enum values as quiet rounded-rectangle chips (not pills) — capped with a "+N more" overflow. */
function EnumChips({ values }: { values: unknown[] }) {
  const max = 16;
  const shown = values.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((value, i) => (
        <span
          key={i}
          className="rounded-[4px] border border-[hsl(var(--border))] bg-[var(--paper-sunken)] px-1.5 py-0.5 font-mono text-[11px] leading-none text-[var(--ink-soft)]"
        >
          {formatLiteral(value)}
        </span>
      ))}
      {values.length > max && (
        <span className="self-center font-mono text-[11px] text-[var(--ink-faint)]">+{values.length - max} more</span>
      )}
    </div>
  );
}

/**
 * The heading detail segments after the property name: type word, "· Model" link-label, const
 * literal, validation summaries, enum marker, and the orange `required` marker. Mirrors
 * SchemaPropertyHeading's detail row; rendered as plain inline mono text (no pills).
 */
function TypeDetails({ d, required }: { d: Described; required: boolean }) {
  return (
    <>
      {d.typeDetail && <span className="font-mono text-[12px] leading-none text-[var(--ink-soft)]">{d.typeDetail}</span>}
      {d.modelName && <span className="font-mono text-[12px] leading-none text-[var(--accent)]">· {d.modelName}</span>}
      {d.kind === "const" && d.constValue !== undefined && (
        <span className="font-mono text-[12px] leading-none text-[var(--ink-soft)]">const: {formatLiteral(d.constValue)}</span>
      )}
      {d.constraints.map((c, i) => (
        <span key={i} className="font-mono text-[11px] leading-none text-[var(--ink-faint)]">
          {c}
        </span>
      ))}
      {d.isEnum && <span className="font-mono text-[11px] leading-none text-[var(--ink-faint)]">enum</span>}
      {required && (
        <span className="font-medium uppercase leading-none tracking-[0.06em] text-[10.5px] text-[var(--accent)]">required</span>
      )}
    </>
  );
}

/** A faint note shown where recursion stops at a self-referential `$ref`. */
function CircularNote({ name }: { name?: string }) {
  return (
    <p className="font-mono text-[12px] text-[var(--ink-faint)]">circular reference{name ? ` to ${name}` : ""}</p>
  );
}

/**
 * The bordered list of an object's properties (required-first, then declared order). One row per
 * property, each row a recursive <SchemaTree> in property mode. Reimplements
 * SchemaObjectProperties.vue + the `.schema-properties` container.
 */
function PropertiesList({
  doc,
  objectSchema,
  depth,
  seen,
}: {
  doc: OpenApiDoc;
  objectSchema: Schema;
  depth: number;
  seen: Set<string>;
}) {
  const props =
    objectSchema.properties && typeof objectSchema.properties === "object"
      ? (objectSchema.properties as Record<string, unknown>)
      : {};
  const requiredList = Array.isArray(objectSchema.required) ? (objectSchema.required as string[]) : [];
  const entries = Object.entries(props);

  if (entries.length === 0) {
    return <p className="px-3 py-2 font-mono text-[12px] text-[var(--ink-faint)]">Empty object</p>;
  }

  // Required-first; Array.sort is stable so declared order is preserved within each group.
  const sorted = [...entries].sort(
    (a, b) => (requiredList.includes(a[0]) ? 0 : 1) - (requiredList.includes(b[0]) ? 0 : 1),
  );

  return (
    <ul className="overflow-hidden rounded-[7px] border border-[hsl(var(--border))] bg-[var(--paper-raised)]">
      {sorted.map(([propName, propSchema], i) => (
        <li key={propName} className={i > 0 ? "border-t border-[hsl(var(--border))]" : ""}>
          <SchemaTree
            doc={doc}
            name={propName}
            schema={propSchema}
            required={requiredList.includes(propName)}
            depth={depth}
            seen={seen}
          />
        </li>
      ))}
    </ul>
  );
}

/** Public props. `seen` is internal recursion state and is not part of the consumed interface. */
export interface SchemaTreeProps {
  doc: OpenApiDoc;
  /** A schema object or a `{ $ref }` — resolved internally. */
  schema: unknown;
  /** When set, this node renders as a named property row; when omitted, as a root container. */
  name?: string;
  /** Whether this property is in its parent's `required[]`. */
  required?: boolean;
  /** Nesting level — nested objects auto-expand at depth <= 1, collapse deeper. */
  depth?: number;
}

/**
 * Recursive schema renderer.
 *
 * Two modes, selected by `name`:
 *   - root/container (no `name`): renders the resolved schema's shape directly — an object's
 *     property list, an array's element type + its items' property list, or an enum/scalar summary.
 *     Used by callers that pass a request-body / response / model schema.
 *   - property row (`name` set): one heading line (name + type + constraints + required) with an
 *     optional disclosure that reveals nested object / array-of-object properties.
 */
export function SchemaTree({ doc, schema, name, required = false, depth = 0, seen }: SchemaTreeProps & { seen?: Set<string> }) {
  const d = describe(doc, schema);
  // Nested object/array rows auto-expand near the top, collapse deeper (mirrors Scalar's default).
  const [open, setOpen] = useState(depth <= 1);

  // Cycle guard: stop when a `$ref` model is already on the current expansion path.
  const cyclic = Boolean(d.refName && seen?.has(d.refName));
  const childSeen = d.refName ? new Set(seen ?? []).add(d.refName) : seen ?? new Set<string>();

  const description = typeof d.resolved.description === "string" ? d.resolved.description : undefined;
  const hasObjectChildren = d.kind === "object" && propertyCount(d.resolved) > 0 && !cyclic;
  const hasArrayChildren =
    d.kind === "array" && Boolean(d.itemsIsObject && d.itemsSchema && propertyCount(d.itemsSchema) > 0) && !cyclic;
  const hasChildren = hasObjectChildren || hasArrayChildren;
  const childObjectSchema = hasArrayChildren ? d.itemsSchema! : d.resolved;

  // ── Root / container mode ──────────────────────────────────────────────────────────────────
  if (name === undefined) {
    if (d.kind === "object") {
      return (
        <div className="flex flex-col gap-1.5">
          {d.refName && <div className="font-mono text-[12px] text-[var(--ink-soft)]">{d.refName}</div>}
          {cyclic ? (
            <CircularNote name={d.refName} />
          ) : (
            <PropertiesList doc={doc} objectSchema={d.resolved} depth={depth} seen={childSeen} />
          )}
        </div>
      );
    }
    if (d.kind === "array") {
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
            <TypeDetails d={d} required={false} />
          </div>
          {d.itemsIsObject && d.itemsSchema ? (
            cyclic ? (
              <CircularNote name={d.refName} />
            ) : (
              <PropertiesList doc={doc} objectSchema={d.itemsSchema} depth={depth} seen={childSeen} />
            )
          ) : null}
        </div>
      );
    }
    // enum / scalar / const root.
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
          <TypeDetails d={d} required={false} />
        </div>
        {description && <Markdown size="sm">{description}</Markdown>}
        {d.isEnum && d.enumValues && <EnumChips values={d.enumValues} />}
      </div>
    );
  }

  // ── Property-row mode ──────────────────────────────────────────────────────────────────────
  const headingInner = (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
      {hasChildren && <Caret open={open} />}
      <span className="break-words font-mono text-[13px] font-semibold text-[var(--ink)]">{name}</span>
      <TypeDetails d={d} required={required} />
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      {hasChildren ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 rounded-[4px]"
        >
          {headingInner}
        </button>
      ) : (
        headingInner
      )}

      {description && <p className="font-sans text-[12.5px] leading-[1.5] text-[var(--ink-soft)]">{description}</p>}
      {d.isEnum && d.enumValues && <EnumChips values={d.enumValues} />}
      {cyclic && <CircularNote name={d.refName} />}

      {hasChildren && open && (
        <div className="mt-1.5">
          <PropertiesList doc={doc} objectSchema={childObjectSchema} depth={depth + 1} seen={childSeen} />
        </div>
      )}
    </div>
  );
}
