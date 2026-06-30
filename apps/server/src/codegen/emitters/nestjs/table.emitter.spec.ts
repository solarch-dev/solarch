import { describe, it, expect } from "vitest";
import { emitTable } from "./table.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";

/* ── Fixture yardımcıları ──────────────────────────────────────────────── */
function tableNode(properties: Record<string, unknown>, id: string): StoredNode {
  return {
    id,
    type: "Table",
    projectId: "00000000-0000-4000-8000-000000000000",
    positionX: 0,
    positionY: 0,
    homeTabId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function ctxFor(...nodes: StoredNode[]): { ctx: EmitterContext } {
  const graph = buildCodeGraph(nodes, []);
  return { ctx: { graph, target: "nestjs" } };
}

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const USER_TABLE = {
  // TableName fiziksel ad olarak alınır (çoğullanmaz) -> doğal çoğul yazılır.
  TableName: "users",
  Description: "Uygulama kullanıcısı",
  Columns: [
    { Name: "Id", DataType: "INT", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: true },
    { Name: "Email", DataType: "VARCHAR", Length: 320, IsPrimaryKey: false, IsNotNull: true, IsUnique: true },
    { Name: "FullName", DataType: "VARCHAR", Length: 120, IsPrimaryKey: false, IsNotNull: false, IsUnique: false },
    { Name: "Balance", DataType: "DECIMAL", Precision: 12, Scale: 2, IsPrimaryKey: false, IsNotNull: true, IsUnique: false, DefaultValue: "0" },
    { Name: "IsActive", DataType: "BOOLEAN", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, DefaultValue: "true" },
  ],
  ForeignKeys: [],
  UniqueConstraints: [],
  CheckConstraints: [{ Expression: "balance >= 0" }],
  Indexes: [{ IndexName: "idx_user_email", Columns: ["Email"], Type: "BTree", IsUnique: true }],
};

const ORDER_TABLE = {
  TableName: "orders",
  Description: "Sipariş kaydı",
  Columns: [
    { Name: "Id", DataType: "BIGINT", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: true },
    { Name: "UserId", DataType: "INT", IsPrimaryKey: false, IsNotNull: true, IsUnique: false },
    { Name: "Total", DataType: "DECIMAL", Precision: 10, Scale: 2, IsPrimaryKey: false, IsNotNull: true, IsUnique: false },
    { Name: "Payload", DataType: "JSON", IsPrimaryKey: false, IsNotNull: false, IsUnique: false },
    { Name: "CreatedAt", DataType: "DATETIME", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, DefaultValue: "now()" },
  ],
  ForeignKeys: [
    {
      Columns: ["UserId"],
      ReferencesTable: "users",
      ReferencesColumns: ["Id"],
      OnDelete: "CASCADE",
      OnUpdate: "NO_ACTION",
    },
  ],
  UniqueConstraints: [],
  CheckConstraints: [],
  Indexes: [{ IndexName: "idx_order_user", Columns: ["UserId"], Type: "Hash" }],
};

describe("emitTable (Table -> Postgres migration SQL)", () => {
  it("tam tablo (PK + unique + check + index) — snapshot", () => {
    const node = tableNode(USER_TABLE, USER_ID);
    const { ctx } = ctxFor(node);
    const [file] = emitTable(ctx.graph.byId(node.id)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "-- Uygulama kullanıcısı

      CREATE TABLE "users" (
        "id" SERIAL NOT NULL,
        "email" VARCHAR(320) NOT NULL UNIQUE,
        "full_name" VARCHAR(120),
        "balance" DECIMAL(12, 2) NOT NULL DEFAULT 0,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        PRIMARY KEY ("id"),
        CONSTRAINT "ck_users_balance_0" CHECK (balance >= 0)
      );

      CREATE UNIQUE INDEX "idx_user_email" ON "users" ("email");
      ",
        "language": "sql",
        "path": "migrations/001_create_users.sql",
        "surgicalMarkers": 0,
      }
    `);
  });

  it("FK referans çözümü + migration sırası: referans edilen tablo önce gelir", () => {
    const user = tableNode(USER_TABLE, USER_ID);
    const order = tableNode(ORDER_TABLE, ORDER_ID);
    const { ctx } = ctxFor(user, order);

    const [userFile] = emitTable(ctx.graph.byId(USER_ID)!, ctx);
    const [orderFile] = emitTable(ctx.graph.byId(ORDER_ID)!, ctx);

    // User'a FK ile bağımlı olan Order, topolojide sonra (002) gelir.
    expect(userFile.path).toBe("migrations/001_create_users.sql");
    expect(orderFile.path).toBe("migrations/002_create_orders.sql");

    // FK tüm tablodan sonra ALTER TABLE ile, hedef tablo "users" çözülmüş.
    expect(orderFile.content).toContain(
      'ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;',
    );
    // BIGINT + AutoIncrement -> BIGSERIAL.
    expect(orderFile.content).toContain('"id" BIGSERIAL NOT NULL');
    // JSON -> JSONB; DATETIME -> TIMESTAMP.
    expect(orderFile.content).toContain('"payload" JSONB');
    expect(orderFile.content).toContain('"created_at" TIMESTAMP NOT NULL DEFAULT now()');
    // Hash index -> USING HASH.
    expect(orderFile.content).toContain('CREATE INDEX "idx_order_user" ON "orders" USING HASH ("user_id");');
  });

  it("composite PK (PrimaryKey.Columns) + UNIQUE constraint", () => {
    const node = tableNode(
      {
        TableName: "user_roles",
        Description: "Kullanıcı-rol eşleşmesi",
        Columns: [
          { Name: "UserId", DataType: "INT", IsPrimaryKey: false, IsNotNull: true, IsUnique: false },
          { Name: "RoleId", DataType: "INT", IsPrimaryKey: false, IsNotNull: true, IsUnique: false },
        ],
        PrimaryKey: { Columns: ["UserId", "RoleId"] },
        ForeignKeys: [],
        UniqueConstraints: [{ Columns: ["UserId", "RoleId"] }],
        CheckConstraints: [],
        Indexes: [],
      },
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
    const { ctx } = ctxFor(node);
    const [file] = emitTable(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain('PRIMARY KEY ("user_id", "role_id")');
    expect(file.content).toContain('CONSTRAINT "uq_user_roles_user_id_role_id" UNIQUE ("user_id", "role_id")');
  });

  it("GENERATED kolon + tek-kolon UNIQUE kolon dekoratörü", () => {
    const node = tableNode(
      {
        TableName: "Invoice",
        Description: "Fatura",
        Columns: [
          { Name: "Id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false },
          { Name: "Net", DataType: "DECIMAL", Precision: 10, Scale: 2, IsPrimaryKey: false, IsNotNull: true, IsUnique: false },
          { Name: "Tax", DataType: "DECIMAL", Precision: 10, Scale: 2, IsPrimaryKey: false, IsNotNull: true, IsUnique: false },
          {
            Name: "Gross",
            DataType: "DECIMAL",
            Precision: 10,
            Scale: 2,
            IsPrimaryKey: false,
            IsNotNull: false,
            IsUnique: false,
            IsGenerated: true,
            GeneratedExpression: "net + tax",
          },
        ],
        ForeignKeys: [],
        UniqueConstraints: [],
        CheckConstraints: [],
        Indexes: [],
      },
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    const { ctx } = ctxFor(node);
    const [file] = emitTable(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain('"id" UUID NOT NULL');
    expect(file.content).toContain('"gross" DECIMAL(10, 2) GENERATED ALWAYS AS (net + tax) STORED');
  });

  it("edge-case: kayıp FK ref + boş koleksiyonlar -> throw yok, FK ham isimden türer", () => {
    const node = tableNode(
      {
        TableName: "comments",
        Description: "Yorum",
        Columns: [
          { Name: "Id", DataType: "INT", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: true },
          { Name: "PostId", DataType: "INT", IsPrimaryKey: false, IsNotNull: true, IsUnique: false },
        ],
        // ForeignKeys/UniqueConstraints/CheckConstraints/Indexes BİLEREK eksik (Zod default'suz ham node).
        ForeignKeys: [
          { Columns: ["PostId"], ReferencesTable: "posts", ReferencesColumns: ["Id"] },
        ],
      },
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );
    const { ctx } = ctxFor(node);
    expect(() => emitTable(ctx.graph.byId(node.id)!, ctx)).not.toThrow();
    const [file] = emitTable(ctx.graph.byId(node.id)!, ctx);
    // Hedef "posts" graph'ta yok -> ham isim fiziksel ad sayılır (çoğullanmaz), throw yok.
    expect(file.content).toContain(
      'ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_post_id" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;',
    );
    // Boş Index/Unique/Check -> ekstra satır yok.
    expect(file.content).not.toContain("CREATE INDEX");
    expect(file.content).not.toContain("UNIQUE (");
    expect(file.content.endsWith(";\n")).toBe(true);
  });

  it("dil 'sql', yol migrations/ altında, içerik tek satır sonu ile biter", () => {
    const node = tableNode(USER_TABLE, USER_ID);
    const { ctx } = ctxFor(node);
    const [file] = emitTable(ctx.graph.byId(node.id)!, ctx);
    expect(file.language).toBe("sql");
    expect(file.path).toMatch(/^migrations\/\d{3}_create_users\.sql$/);
    expect(file.content.endsWith("\n")).toBe(true);
    expect(file.content.endsWith("\n\n")).toBe(false);
  });

  it("DETERMİNİZM: aynı node iki kez -> byte-identical", () => {
    const node = tableNode(ORDER_TABLE, ORDER_ID);
    const { ctx } = ctxFor(node);
    const a = emitTable(ctx.graph.byId(node.id)!, ctx)[0].content;
    const b = emitTable(ctx.graph.byId(node.id)!, ctx)[0].content;
    expect(a).toBe(b);
  });

  it("surgicalMarkers SQL'de 0", () => {
    const node = tableNode(ORDER_TABLE, ORDER_ID);
    const { ctx } = ctxFor(node);
    const [file] = emitTable(ctx.graph.byId(node.id)!, ctx);
    expect(file.surgicalMarkers).toBe(0);
  });

  /* ── ENUM kolonu -> VARCHAR + CHECK (entity ile tutarlı) ─────────────────
   * #56: entity @Column({type:"enum"}) ama migration TEXT -> tutarsız. Karar:
   * varchar + CHECK. Migration enum kolonunu VARCHAR yapar ve değerleri CHECK ile
   * kısıtlar (DB-seviyesi doğrulama); native CREATE TYPE YOK (diyagram evrilince
   * migration kâbusu olmasın). Değerler EnumRef -> Enum node Values (Value ?? Key). */
  it("ENUM kolonu -> VARCHAR + CHECK (col IN ...), TEXT/CREATE TYPE değil", () => {
    const enumNode: StoredNode = {
      id: "e0000000-0000-4000-8000-000000000001",
      type: "Enum",
      projectId: "00000000-0000-4000-8000-000000000000",
      positionX: 0,
      positionY: 0,
      homeTabId: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      version: 1,
      properties: {
        Name: "OrderStatus",
        Description: "Sipariş durumu",
        BackingType: "string",
        Values: [
          { Key: "PENDING", Value: "pending" },
          { Key: "CONFIRMED", Value: "confirmed" },
          { Key: "CANCELLED", Value: "cancelled" },
        ],
      },
    };
    const table = tableNode(
      {
        TableName: "orders",
        Description: "Sipariş",
        Columns: [
          { Name: "Id", DataType: "BIGINT", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: true },
          { Name: "Status", DataType: "ENUM", EnumRef: "OrderStatus", IsPrimaryKey: false, IsNotNull: true, IsUnique: false },
        ],
        ForeignKeys: [],
        UniqueConstraints: [],
        CheckConstraints: [],
        Indexes: [],
      },
      ORDER_ID,
    );
    const { ctx } = ctxFor(table, enumNode);
    const [file] = emitTable(ctx.graph.byId(ORDER_ID)!, ctx);
    // Kolon VARCHAR (TEXT/native-enum DEĞİL).
    expect(file.content).toMatch(/"status" VARCHAR/);
    expect(file.content).not.toMatch(/"status" TEXT/);
    expect(file.content).not.toContain("CREATE TYPE");
    // CHECK constraint enum backing değerleriyle (Value ?? Key).
    expect(file.content).toMatch(
      /CHECK \("status" IN \('pending', 'confirmed', 'cancelled'\)\)/,
    );
  });
});
