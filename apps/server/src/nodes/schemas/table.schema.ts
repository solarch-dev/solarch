import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

const DATA_TYPES = ["INT", "BIGINT", "VARCHAR", "TEXT", "BOOLEAN", "DATETIME", "DATE", "UUID", "FLOAT", "DECIMAL", "JSON", "ENUM"] as const;
const FK_ACTION = ["CASCADE", "RESTRICT", "SET_NULL", "NO_ACTION"] as const;

const ColumnSchema = z.object({
  Name: z.string().min(1).describe("Column name"),
  DataType: z.enum(DATA_TYPES).describe("SQL veri tipi"),
  Length: z.number().int().positive().optional().describe("VARCHAR(n) length"),
  Precision: z.number().int().positive().optional().describe("DECIMAL(p,s) precision"),
  Scale: z.number().int().nonnegative().optional().describe("DECIMAL(p,s) scale"),
  IsPrimaryKey: z.boolean().describe("Tek-kolon PK"),
  IsNotNull: z.boolean().describe("NOT NULL"),
  IsUnique: z.boolean().describe("UNIQUE"),
  AutoIncrement: z.boolean().describe("AUTO_INCREMENT / SERIAL"),
  DefaultValue: z.string().optional().describe("Default value expression"),
  Comment: z.string().optional().describe("Kolon yorumu"),
  EnumRef: z.string().optional().describe("DataType=ENUM ise → Enum node Name"),
  IsGenerated: z.boolean().optional().describe("GENERATED kolon"),
  GeneratedExpression: z.string().optional().describe("Generated kolon ifadesi"),
}).strict();

const ForeignKeySchema = z.object({
  Name: z.string().optional(),
  Columns: z.array(z.string().min(1)).min(1),
  ReferencesTable: z.string().min(1).describe("Hedef Table Name"),
  ReferencesColumns: z.array(z.string().min(1)).min(1),
  OnDelete: z.enum(FK_ACTION).default("NO_ACTION"),
  OnUpdate: z.enum(FK_ACTION).default("NO_ACTION"),
}).strict();

const IndexSchema = z.object({
  IndexName: z.string().min(1),
  Columns: z.array(z.string().min(1)).min(1),
  Type: z.enum(["BTree", "Hash", "GIN", "GiST"]).default("BTree"),
  IsUnique: z.boolean().default(false),
  IsPartial: z.boolean().optional(),
  WhereClause: z.string().optional(),
}).strict();

export const TableNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Table"),
  properties: z.object({
    TableName: z.string().min(1),
    Description: z.string().min(1),
    Columns: z.array(ColumnSchema).min(1),
    PrimaryKey: z.object({ Columns: z.array(z.string().min(1)).min(1) }).optional().describe("Composite PK (use Column.IsPrimaryKey for single-column)"),
    ForeignKeys: z.array(ForeignKeySchema).default([]),
    UniqueConstraints: z.array(z.object({ Name: z.string().optional(), Columns: z.array(z.string().min(1)).min(1) })).default([]),
    CheckConstraints: z.array(z.object({ Name: z.string().optional(), Expression: z.string().min(1) })).default([]),
    Indexes: z.array(IndexSchema).default([]),
  }).strict(),
}).strict();

export type TableNode = z.infer<typeof TableNodeSchema>;
