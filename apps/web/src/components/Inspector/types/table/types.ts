/** Frontend mirror of backend solarch-backend/src/nodes/schemas/table.schema.ts.
 *  Field names and defaults must match backend Zod exactly (so .strict() doesn't reject). */

export const DATA_TYPES = ["INT", "BIGINT", "VARCHAR", "TEXT", "BOOLEAN", "DATETIME", "DATE", "UUID", "FLOAT", "DECIMAL", "JSON", "ENUM"] as const;
export type DataType = typeof DATA_TYPES[number];

export const FK_ACTIONS = ["NO_ACTION", "CASCADE", "RESTRICT", "SET_NULL"] as const;
export type FkAction = typeof FK_ACTIONS[number];

export const INDEX_TYPES = ["BTree", "Hash", "GIN", "GiST"] as const;
export type IndexType = typeof INDEX_TYPES[number];

export interface Column {
  Name: string;
  DataType: DataType;
  Length?: number;
  Precision?: number;
  Scale?: number;
  IsPrimaryKey: boolean;
  IsNotNull: boolean;
  IsUnique: boolean;
  AutoIncrement: boolean;
  DefaultValue?: string;
  Comment?: string;
  EnumRef?: string;
}

export interface ForeignKey {
  Name?: string;
  Columns: string[];
  ReferencesTable: string;
  ReferencesColumns: string[];
  OnDelete: FkAction;
  OnUpdate: FkAction;
}

export interface TableIndex {
  IndexName: string;
  Columns: string[];
  Type: IndexType;
  IsUnique: boolean;
  IsPartial?: boolean;
  WhereClause?: string;
}

export interface UniqueConstraint {
  Name?: string;
  Columns: string[];
}

export interface CheckConstraint {
  Name?: string;
  Expression: string;
}

export const newColumn = (): Column => ({
  Name: "",
  DataType: "VARCHAR",
  Length: 255,
  IsPrimaryKey: false,
  IsNotNull: false,
  IsUnique: false,
  AutoIncrement: false,
});

export const newForeignKey = (): ForeignKey => ({
  Columns: [],
  ReferencesTable: "",
  ReferencesColumns: [],
  OnDelete: "NO_ACTION",
  OnUpdate: "NO_ACTION",
});

export const newIndex = (): TableIndex => ({
  IndexName: "",
  Columns: [],
  Type: "BTree",
  IsUnique: false,
});

export const newUnique = (): UniqueConstraint => ({ Columns: [] });

export const newCheck = (): CheckConstraint => ({ Expression: "" });

/** Extract column names from properties.Columns — ColumnMultiSelect options in editors. */
export function columnNamesOf(properties: Record<string, unknown>): string[] {
  const cols = Array.isArray(properties.Columns) ? properties.Columns : [];
  return cols
    .map((c) => String((c as Record<string, unknown>).Name ?? ""))
    .filter((name) => name.length > 0);
}
