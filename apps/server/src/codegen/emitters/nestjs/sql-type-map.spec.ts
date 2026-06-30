import { describe, it, expect } from "vitest";
import { columnOrmType, columnTsType, sqlTypeToTs } from "./sql-type-map";
import { buildCodeGraph } from "../../ir";
import type { StoredNode } from "../../../nodes/nodes.repository";

/* ────────────────────────────────────────────────────────────────────────
 * sql-type-map.spec.ts — SQL DataType -> (TS tipi, TypeORM @Column tipi).
 * entity/model/dto emitter'ları için TEK KAYNAK; ENUM/JSON dahil GEÇERLİ TS.
 * ──────────────────────────────────────────────────────────────────────── */

function enumNode(): StoredNode {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    type: "Enum",
    projectId: "00000000-0000-4000-8000-000000000000",
    positionX: 0,
    positionY: 0,
    homeTabId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties: { Name: "OrderStatus", Description: "x", BackingType: "string", Values: [{ Key: "A" }] },
  };
}

describe("sqlTypeToTs", () => {
  it("string ailesi -> string (VARCHAR/TEXT/CHAR/UUID, harf duyarsız)", () => {
    for (const t of ["VARCHAR", "text", "Char", "uuid", "BPCHAR", "citext"]) {
      expect(sqlTypeToTs(t)).toBe("string");
    }
  });

  it("sayısal aile -> number (INT/INTEGER/BIGINT/SMALLINT/DECIMAL/NUMERIC/FLOAT)", () => {
    for (const t of ["INT", "integer", "BIGINT", "SMALLINT", "DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "REAL"]) {
      expect(sqlTypeToTs(t)).toBe("number");
    }
  });

  it("BOOLEAN/BOOL -> boolean", () => {
    expect(sqlTypeToTs("BOOLEAN")).toBe("boolean");
    expect(sqlTypeToTs("bool")).toBe("boolean");
  });

  it("zaman aile -> Date (TIMESTAMP/DATETIME/DATE/TIME)", () => {
    for (const t of ["TIMESTAMP", "DATETIME", "DATE", "TIME", "timestamptz"]) {
      expect(sqlTypeToTs(t)).toBe("Date");
    }
  });

  it("JSON/JSONB/object/map/record -> Record<string, unknown>", () => {
    expect(sqlTypeToTs("JSON")).toBe("Record<string, unknown>");
    expect(sqlTypeToTs("jsonb")).toBe("Record<string, unknown>");
    expect(sqlTypeToTs("object")).toBe("Record<string, unknown>");
    expect(sqlTypeToTs("map")).toBe("Record<string, unknown>");
  });

  it("ENUM -> string (generated tip için columnTsType kullan)", () => {
    expect(sqlTypeToTs("ENUM")).toBe("string");
  });

  it("boş/undefined -> string", () => {
    expect(sqlTypeToTs("")).toBe("string");
    expect(sqlTypeToTs(undefined)).toBe("string");
  });

  it("bilinmeyen tip: unknownAsString=true -> string; false -> ham geçiş", () => {
    expect(sqlTypeToTs("Buffer")).toBe("string");
    expect(sqlTypeToTs("Buffer", false)).toBe("Buffer");
    // serbest tip (DTO/Model) geçişi: özel sınıf adı korunur.
    expect(sqlTypeToTs("GeoPoint", false)).toBe("GeoPoint");
  });

  it("ikili/dosya ailesi (binary/blob/bytes) -> Buffer — DTO yolunda da (ham `binary` TS2304'tü)", () => {
    for (const t of ["binary", "BINARY", "varbinary", "blob", "BLOB", "bytea", "bytes"]) {
      expect(sqlTypeToTs(t)).toBe("Buffer");
      expect(sqlTypeToTs(t, false)).toBe("Buffer"); // DTO/Model yolu da ham `binary` döndürmemeli
    }
  });

  it(".NET/boxed tip adı -> primitive (String->string, Number->number) — DTO/Model yolunda da", () => {
    // unknownAsString=false (DTO/Model) ham "String" döndürmemeli; aksi halde
    // `Type 'String' is not assignable to type 'string'` (TS2322).
    expect(sqlTypeToTs("String", false)).toBe("string");
    expect(sqlTypeToTs("string", false)).toBe("string");
    expect(sqlTypeToTs("Number", false)).toBe("number");
    expect(sqlTypeToTs("STRING")).toBe("string");
  });
});

describe("columnTsType (ENUM çözümü)", () => {
  it("ENUM + çözülen EnumRef -> generated enum sınıf adı", () => {
    const graph = buildCodeGraph([enumNode()], []);
    expect(columnTsType("ENUM", "OrderStatus", graph)).toBe("OrderStatus");
  });

  it("ENUM + çözülemeyen EnumRef -> string (güvenli)", () => {
    const graph = buildCodeGraph([], []);
    expect(columnTsType("ENUM", "Missing", graph)).toBe("string");
  });

  it("ENUM ama EnumRef yok -> string", () => {
    const graph = buildCodeGraph([enumNode()], []);
    expect(columnTsType("ENUM", undefined, graph)).toBe("string");
  });

  it("enumImporter callback'i çözülen node ile çağrılır", () => {
    const graph = buildCodeGraph([enumNode()], []);
    let seen = "";
    const out = columnTsType("ENUM", "OrderStatus", graph, (n) => {
      seen = n.name;
      return "Aliased";
    });
    expect(seen).toBe("OrderStatus");
    expect(out).toBe("Aliased");
  });

  it("ENUM olmayan tip -> sqlTypeToTs ile aynı (callback çağrılmaz)", () => {
    const graph = buildCodeGraph([], []);
    expect(columnTsType("JSON", undefined, graph)).toBe("Record<string, unknown>");
    expect(columnTsType("UUID", undefined, graph)).toBe("string");
  });
});

describe("columnOrmType (TypeORM @Column type)", () => {
  it("SQL tipleri doğru fiziksel TypeORM tipine eşlenir", () => {
    expect(columnOrmType("VARCHAR")).toBe("varchar");
    expect(columnOrmType("TEXT")).toBe("text");
    expect(columnOrmType("UUID")).toBe("uuid");
    expect(columnOrmType("INT")).toBe("int");
    expect(columnOrmType("BIGINT")).toBe("bigint");
    expect(columnOrmType("BOOLEAN")).toBe("boolean");
    expect(columnOrmType("DATETIME")).toBe("timestamp");
    expect(columnOrmType("DATE")).toBe("date");
    expect(columnOrmType("FLOAT")).toBe("double precision");
    expect(columnOrmType("DECIMAL")).toBe("decimal");
    expect(columnOrmType("JSON")).toBe("jsonb");
    expect(columnOrmType("JSONB")).toBe("jsonb");
    expect(columnOrmType("ENUM")).toBe("enum");
  });

  it("object/map/record (şemasız JSON blob) -> jsonb (TypeORM 'object' tipi YOK; eski TS2769)", () => {
    expect(columnOrmType("object")).toBe("jsonb");
    expect(columnOrmType("OBJECT")).toBe("jsonb");
    expect(columnOrmType("map")).toBe("jsonb");
    expect(columnOrmType("record")).toBe("jsonb");
  });

  it("Model serbest tip eş anlamlıları aynı fiziksel tipe düşer", () => {
    expect(columnOrmType("string")).toBe("varchar");
    expect(columnOrmType("number")).toBe("int");
    expect(columnOrmType("bool")).toBe("boolean");
    expect(columnOrmType("long")).toBe("bigint");
  });

  it("ikili/dosya ailesi (binary/blob/bytes) -> bytea (postgres; ham 'binary' MySQL'e özgü)", () => {
    for (const t of ["binary", "BINARY", "varbinary", "blob", "bytea", "bytes"]) {
      expect(columnOrmType(t)).toBe("bytea");
    }
  });
});
