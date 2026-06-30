import type { CodeGraph, CodeNode } from "../../ir";
import { pascalCase } from "../../naming";

/* ────────────────────────────────────────────────────────────────────────
 * sql-type-map.ts — SQL DataType -> (TypeScript type, TypeORM @Column type).
 *
 * SINGLE SOURCE. entity-synthesis / model.emitter / dto.emitter (and indirect table
 * side) share this module; otherwise each emitter keeps its own incomplete mapping and
 * types like ENUM/JSON would produce INVALID TS (old bug: `status: ENUM`,
 * `metadata: JSON` — both break compilation / wrong type).
 *
 * MAPPING (case-insensitive; synonyms normalized):
 *   VARCHAR / TEXT / CHAR / UUID                 -> string
 *   INT / INTEGER / BIGINT / SMALLINT            -> number
 *   DECIMAL / NUMERIC / FLOAT / DOUBLE / REAL    -> number
 *   BOOLEAN / BOOL                               -> boolean
 *   TIMESTAMP / DATETIME / DATE / TIME           -> Date
 *   JSON / JSONB                                 -> Record<string, unknown>
 *   ENUM                                         -> generated enum type when
 *                                                   EnumRef resolves, else string
 *
 * PURE + DETERMINISTIC: string only + (for ENUM) ref resolution on graph;
 * no timestamp/random. Unknown type -> string (safe; no invalid TS).
 * ──────────────────────────────────────────────────────────────────────── */

/** Reduce a SQL DataType token to normalized uppercase form. */
function norm(raw: string | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

/** SQL/schema DataType -> TypeScript SCALAR type (except ENUM — use
 *  columnTsType for ENUM because resolving generated enum name requires graph).
 *
 *  unknownAsString:
 *   - true (default): unknown type -> "string" (entity/Table safe path;
 *     SQL DataType enum is closed, no invalid TS).
 *   - false: unknown type returned AS-IS (DTO/Model free-type passthrough —
 *     e.g. custom class/embedded type name; preserves old behavior).
 */
export function sqlTypeToTs(
  dataType: string | undefined,
  unknownAsString = true,
): string {
  switch (norm(dataType)) {
    case "":
      return "string";
    case "VARCHAR":
    case "TEXT":
    case "CHAR":
    case "BPCHAR":
    case "CITEXT":
    case "GUID":
    case "UUID":
    case "STRING":
      // .NET/C# boxed type name (DataType="String"/"Guid"): with unknownAsString=false
      // (DTO/Model path) a raw "String" would yield `Type 'String' is not assignable to
      // type 'string'` (TS2322). Lower the boxed wrapper to the primitive.
      return "string";
    case "INT":
    case "INTEGER":
    case "BIGINT":
    case "SMALLINT":
    case "TINYINT":
    case "LONG":
    case "DECIMAL":
    case "NUMERIC":
    case "FLOAT":
    case "DOUBLE":
    case "REAL":
    case "NUMBER":
      // .NET-style boxed number name ("Number"/"Int32") → primitive number.
      return "number";
    case "BOOLEAN":
    case "BOOL":
      return "boolean";
    case "TIMESTAMP":
    case "TIMESTAMPTZ":
    case "DATETIME":
    case "DATE":
    case "TIME":
      return "Date";
    // JSON blob synonyms: object/map/record/dict (LLM may label a schemaless body field
    // "object"; bare `object` is weak but Record<string, unknown> is consistent).
    case "JSON":
    case "JSONB":
    case "OBJECT":
    case "MAP":
    case "RECORD":
    case "DICT":
      return "Record<string, unknown>";
    case "ENUM":
      return "string";
    // Binary/file data (file upload, blob). Raw `binary` is INVALID TS (TS2304: Cannot
    // find name 'binary') — DTO path had unknownAsString=false so it passed through raw.
    // Valid TS: Buffer (Node binary type).
    case "BINARY":
    case "VARBINARY":
    case "BLOB":
    case "LONGBLOB":
    case "MEDIUMBLOB":
    case "TINYBLOB":
    case "BYTEA":
    case "BYTES":
    case "BYTE":
      return "Buffer";
    // Parameterless collection name (DataType="Array"/"List", no element type) → bare
    // `Array` is INVALID TS (TS2314). Safe degradation: `unknown` (with IsArray → unknown[]).
    case "ARRAY":
    case "LIST":
      return "unknown";
    default:
      // Unknown type: safe "string" for entity; raw passthrough for DTO/Model.
      return unknownAsString ? "string" : (dataType ?? "string");
  }
}

/** Column TS type — for ENUM returns generated enum class name (when EnumRef resolves)
 *  and allows import via `imports` callback; otherwise sqlTypeToTs. enumImporter(node)
 *  receives resolved Enum node and must return class name (after adding import) —
 *  return null to fall back to "string". */
export function columnTsType(
  dataType: string | undefined,
  enumRef: string | undefined,
  graph: CodeGraph | undefined,
  enumImporter?: (enumNode: CodeNode) => string,
): string {
  if (norm(dataType) === "ENUM" && enumRef && graph) {
    const enumNode = graph.resolveRef("Enum", enumRef);
    if (enumNode) {
      return enumImporter ? enumImporter(enumNode) : pascalCase(enumNode.name);
    }
  }
  return sqlTypeToTs(dataType);
}

/** TypeORM `@Column` `type` option for a column (deterministic). ENUM/JSON included —
 * physical type suitable for TypeORM. ENUM -> "enum" (caller also adds enum: TheEnum),
 * JSON/JSONB -> "jsonb". */
export function columnOrmType(dataType: string | undefined): string {
  switch (norm(dataType)) {
    // SQL + Model free-type synonyms map to same physical TypeORM type.
    case "VARCHAR":
    case "CHAR":
    case "BPCHAR":
    case "CITEXT":
    case "STRING":
      return "varchar";
    case "TEXT":
      return "text";
    case "GUID":
    case "UUID":
      return "uuid";
    case "INT":
    case "INTEGER":
    case "SMALLINT":
    case "TINYINT":
    case "NUMBER":
      return "int";
    case "BIGINT":
    case "LONG":
      return "bigint";
    case "BOOLEAN":
    case "BOOL":
      return "boolean";
    case "TIMESTAMP":
    case "TIMESTAMPTZ":
    case "DATETIME":
      return "timestamp";
    case "DATE":
      return "date";
    case "TIME":
      return "time";
    case "FLOAT":
    case "DOUBLE":
    case "REAL":
      return "double precision";
    case "DECIMAL":
    case "NUMERIC":
      return "decimal";
    // JSON blob synonyms → jsonb. TypeORM has no "object" column type;
    // default would emit `type: "object"` (TS2769: no overload — real bug).
    case "JSON":
    case "JSONB":
    case "OBJECT":
    case "MAP":
    case "RECORD":
    case "DICT":
      return "jsonb";
    // Binary/file data → postgres bytea (TypeORM raw `binary` is MySQL-specific;
    // codegen targets postgres → bytea is consistent).
    case "BINARY":
    case "VARBINARY":
    case "BLOB":
    case "LONGBLOB":
    case "MEDIUMBLOB":
    case "TINYBLOB":
    case "BYTEA":
    case "BYTES":
    case "BYTE":
      return "bytea";
    case "ENUM":
      return "enum";
    default:
      return norm(dataType).length > 0 ? norm(dataType).toLowerCase() : "varchar";
  }
}
