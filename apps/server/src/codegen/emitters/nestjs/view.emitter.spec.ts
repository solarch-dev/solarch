import { describe, it, expect } from "vitest";
import { emitView } from "./view.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";

/* ── Fixture helpers ──────────────────────────────────────────────── */
function viewNode(properties: Record<string, unknown>, id: string): StoredNode {
  return {
    id,
    type: "View",
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

const VIEW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USERS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDERS_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ACTIVE_USERS_VIEW = {
  ViewName: "ActiveUsersView",
  Description: "Active user summary",
  Definition: "SELECT id, email FROM users WHERE is_active = true",
  SourceTables: ["users"],
  Materialized: false,
  Columns: [
    { Name: "id", DataType: "INT" },
    { Name: "email", DataType: "VARCHAR" },
  ],
};

const USERS_TABLE = {
  TableName: "users",
  Description: "User",
  Columns: [
    { Name: "Id", DataType: "INT", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: true },
    { Name: "IsActive", DataType: "BOOLEAN", IsPrimaryKey: false, IsNotNull: true, IsUnique: false },
  ],
};

const ORDERS_TABLE = {
  TableName: "orders",
  Description: "Order",
  Columns: [
    { Name: "Id", DataType: "INT", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: true },
  ],
};

describe("emitView (View -> Postgres CREATE VIEW migration SQL)", () => {
  it("normal view (Materialized=false) — snapshot", () => {
    const node = viewNode(ACTIVE_USERS_VIEW, VIEW_ID);
    const { ctx } = ctxFor(node);
    const [file] = emitView(ctx.graph.byId(node.id)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "-- Active user summary

      CREATE VIEW "active_users_view" AS
      SELECT id, email FROM users WHERE is_active = true;
      ",
        "language": "sql",
        "path": "migrations/001_create_active_users_view.sql",
        "surgicalMarkers": 0,
      }
    `);
  });

  it("TS @ViewEntity de emit eder (repository View'i tip olarak import edebilsin)", () => {
    const node = viewNode(ACTIVE_USERS_VIEW, VIEW_ID);
    const { ctx } = ctxFor(node);
    const files = emitView(ctx.graph.byId(node.id)!, ctx);
    expect(files).toHaveLength(2); // migration (sql) + entity (ts)
    const entity = files.find((f) => f.language === "typescript")!;
    expect(entity.path).toMatch(/\/entities\/.*\.view\.ts$/);
    expect(entity.content).toContain('import { ViewColumn, ViewEntity } from "typeorm";');
    expect(entity.content).toContain("@ViewEntity(");
    expect(entity.content).toContain("export class ActiveUsersView {");
    expect(entity.content).toContain("@ViewColumn()");
    expect(entity.content).toContain("id!: number;"); // INT → number
    expect(entity.content).toContain("email!: string;"); // VARCHAR → string
  });

  it("materialized view + RefreshStrategy yorumu", () => {
    const node = viewNode(
      {
        ViewName: "RevenueDaily",
        Description: "Daily revenue",
        Definition: "SELECT date_trunc('day', created_at) AS d, sum(total) FROM orders GROUP BY 1",
        SourceTables: ["orders"],
        Materialized: true,
        Columns: [],
        RefreshStrategy: "scheduled",
      },
      VIEW_ID,
    );
    const { ctx } = ctxFor(node);
    const [file] = emitView(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain("-- RefreshStrategy: scheduled");
    expect(file.content).toContain('CREATE MATERIALIZED VIEW "revenue_daily" AS');
    expect(file.content).toContain("GROUP BY 1;");
  });

  it("Materialized=false -> RefreshStrategy verilse bile yorum yazilmaz", () => {
    const node = viewNode(
      {
        ...ACTIVE_USERS_VIEW,
        RefreshStrategy: "onDemand",
      },
      VIEW_ID,
    );
    const { ctx } = ctxFor(node);
    const [file] = emitView(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).not.toContain("RefreshStrategy");
    expect(file.content).toContain('CREATE VIEW "active_users_view" AS');
  });

  it("Definition'daki sondaki ; ve fazladan bosluk tekrarlanmaz", () => {
    const node = viewNode(
      {
        ViewName: "TrimMe",
        Description: "trim",
        Definition: "  SELECT 1 ;  ",
        SourceTables: ["users"],
        Materialized: false,
        Columns: [],
      },
      VIEW_ID,
    );
    const { ctx } = ctxFor(node);
    const [file] = emitView(ctx.graph.byId(node.id)!, ctx);
    // Tek ";" — cift ";;" yok, bas/son bosluk trimildi.
    expect(file.content).toContain("AS\nSELECT 1;\n");
    expect(file.content).not.toContain(";;");
  });

  it("CRLF satir sonlari LF'e indirgenir", () => {
    const node = viewNode(
      {
        ViewName: "MultiLine",
        Description: "multiline",
        Definition: "SELECT a\r\nFROM t\r\nWHERE a > 0",
        SourceTables: ["users"],
        Materialized: false,
        Columns: [],
      },
      VIEW_ID,
    );
    const { ctx } = ctxFor(node);
    const [file] = emitView(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).not.toContain("\r");
    expect(file.content).toContain("SELECT a\nFROM t\nWHERE a > 0;");
  });

  it("migration sirasi: View kaynak Table'larindan AFTER gelir (NNN)", () => {
    // users + orders Table'lari + ActiveUsersView (SourceTables: ["users"]).
    const view = viewNode(ACTIVE_USERS_VIEW, VIEW_ID);
    const users = tableNode(USERS_TABLE, USERS_ID);
    const orders = tableNode(ORDERS_TABLE, ORDERS_ID);
    const { ctx } = ctxFor(view, users, orders);
    const [file] = emitView(ctx.graph.byId(VIEW_ID)!, ctx);
    // 2 Table once (001, 002), View sonra (003) — kaynak Table'lardan sonra.
    expect(file.path).toBe("migrations/003_create_active_users_view.sql");
  });

  it("dil 'sql', yol migrations/ altinda, content ends with single newline", () => {
    const node = viewNode(ACTIVE_USERS_VIEW, VIEW_ID);
    const { ctx } = ctxFor(node);
    const [file] = emitView(ctx.graph.byId(node.id)!, ctx);
    expect(file.language).toBe("sql");
    expect(file.path).toMatch(/^migrations\/\d{3}_create_active_users_view\.sql$/);
    expect(file.content.endsWith("\n")).toBe(true);
    expect(file.content.endsWith("\n\n")).toBe(false);
  });

  it("saf SQL -> surgicalMarkers 0", () => {
    const node = viewNode(ACTIVE_USERS_VIEW, VIEW_ID);
    const { ctx } = ctxFor(node);
    const [file] = emitView(ctx.graph.byId(node.id)!, ctx);
    expect(file.surgicalMarkers).toBe(0);
  });

  it("throw yok + DETERMINISM: same node twice -> byte-identical", () => {
    const node = viewNode(ACTIVE_USERS_VIEW, VIEW_ID);
    const { ctx } = ctxFor(node);
    expect(() => emitView(ctx.graph.byId(node.id)!, ctx)).not.toThrow();
    const a = emitView(ctx.graph.byId(node.id)!, ctx)[0].content;
    const b = emitView(ctx.graph.byId(node.id)!, ctx)[0].content;
    expect(a).toBe(b);
  });
});
