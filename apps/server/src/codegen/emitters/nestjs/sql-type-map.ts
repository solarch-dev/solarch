import type { CodeGraph, CodeNode } from "../../ir";
import { pascalCase } from "../../naming";

/* ────────────────────────────────────────────────────────────────────────
 * sql-type-map.ts — SQL DataType -> (TypeScript tipi, TypeORM @Column tipi).
 *
 * TEK KAYNAK. entity-synthesis / model.emitter / dto.emitter (ve dolaylı table
 * tarafı) bu modülü paylaşır; aksi halde her emitter kendi eksik eşlemesini
 * tutar ve ENUM/JSON gibi tipler GEÇERSİZ TS üretirdi (eski hata: `status: ENUM`,
 * `metadata: JSON` — ikisi de derlemeyi kırar / yanlış tip).
 *
 * EŞLEME (büyük/küçük harf duyarsız; eş anlamlılar normalize):
 *   VARCHAR / TEXT / CHAR / UUID                 -> string
 *   INT / INTEGER / BIGINT / SMALLINT            -> number
 *   DECIMAL / NUMERIC / FLOAT / DOUBLE / REAL    -> number
 *   BOOLEAN / BOOL                               -> boolean
 *   TIMESTAMP / DATETIME / DATE / TIME           -> Date
 *   JSON / JSONB                                 -> Record<string, unknown>
 *   ENUM                                         -> ilgili generated enum tipi
 *                                                   (EnumRef çözülürse) yoksa string
 *
 * SAF + DETERMİNİSTİK: yalnız string + (ENUM için) graph üzerinde ref çözümü;
 * timestamp/random yok. Bilinmeyen tip -> string (güvenli; geçersiz TS üretmez).
 * ──────────────────────────────────────────────────────────────────────── */

/** Bir SQL DataType token'ını normalize edilmiş büyük-harf forma indirger. */
function norm(raw: string | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

/** SQL/şema DataType -> TypeScript SKALER tipi (ENUM hariç — ENUM için
 *  columnTsType kullan; çünkü generated enum adını çözmek graph gerektirir).
 *
 *  unknownAsString:
 *   - true (varsayılan): bilinmeyen tip -> "string" (entity/Table güvenli yolu;
 *     SQL DataType enum'ı kapalıdır, geçersiz TS üretme).
 *   - false: bilinmeyen tip OLDUĞU GİBİ döner (DTO/Model serbest tip geçişi —
 *     ör. özel sınıf/embedded tip adı; eski davranış korunur).
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
    // JSON blob eş anlamlıları: object/map/record/dict (LLM şemasız bir gövde alanını
    // "object" diye verir; bare `object` zayıf ama Record<string, unknown> tutarlı).
    case "JSON":
    case "JSONB":
    case "OBJECT":
    case "MAP":
    case "RECORD":
    case "DICT":
      return "Record<string, unknown>";
    case "ENUM":
      return "string";
    // İkili/dosya verisi (file upload, blob). Ham `binary` GEÇERSİZ TS (TS2304: Cannot
    // find name 'binary') — DTO yolunda unknownAsString=false olduğu için default'tan
    // ham geçiyordu. Geçerli TS: Buffer (Node ikili tipi).
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
    // Parametresiz koleksiyon-ism'i (DataType="Array"/"List", eleman tipi yok) → bare
    // `Array` GEÇERSİZ TS (TS2314). Güvenli degradasyon: `unknown` (IsArray ekiyle unknown[]).
    case "ARRAY":
    case "LIST":
      return "unknown";
    default:
      // Bilinmeyen tip: entity için güvenli "string"; DTO/Model için ham geçiş.
      return unknownAsString ? "string" : (dataType ?? "string");
  }
}

/** Bir kolonun TS tipi — ENUM ise generated enum sınıf adını (EnumRef çözülürse)
 *  döndürür ve `imports` callback'i ile import edilmesine izin verir; aksi halde
 *  sqlTypeToTs. enumImporter(node) çözülen Enum node'unu alıp sınıf adını (import
 *  ekledikten sonra) döndürmelidir — null dönerse "string"e düşülür. */
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

/** Bir kolonun TypeORM `@Column` `type` seçeneği (deterministik). ENUM/JSON dahil
 *  TypeORM'a uygun fiziksel tip. ENUM -> "enum" (çağıran ayrıca enum: TheEnum
 *  ekler), JSON/JSONB -> "jsonb". */
export function columnOrmType(dataType: string | undefined): string {
  switch (norm(dataType)) {
    // SQL + Model serbest tip eş anlamlıları aynı fiziksel TypeORM tipine düşer.
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
    // JSON blob eş anlamlıları → jsonb. TypeORM'da "object" diye kolon tipi YOK;
    // default'a düşse `type: "object"` üretirdi (TS2769: no overload — gerçek bug).
    case "JSON":
    case "JSONB":
    case "OBJECT":
    case "MAP":
    case "RECORD":
    case "DICT":
      return "jsonb";
    // İkili/dosya verisi → postgres bytea (TypeORM'da ham `binary` MySQL'e özgü;
    // codegen postgres hedefler → bytea tutarlı).
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
