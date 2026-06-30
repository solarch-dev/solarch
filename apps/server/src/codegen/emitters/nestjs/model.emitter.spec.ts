import { describe, it, expect } from "vitest";
import { emitModel } from "./model.emitter";
import { emitTable } from "./table.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";

/* ── Fixture helpers ──────────────────────────────────────────────── */
function modelNode(properties: Record<string, unknown>, id: string): StoredNode {
  return {
    id,
    type: "Model",
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

function ctxFor(nodes: StoredNode[], edges: StoredEdge[] = []): { ctx: EmitterContext } {
  const graph = buildCodeGraph(nodes, edges);
  return { ctx: { graph, target: "nestjs" } };
}

const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const POST_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const TABLE_ID = "cccccccc-3333-4333-8333-333333333333";

const USER_MODEL = {
  ClassName: "User",
  Description: "Uygulama kullanicisi",
  TableRef: "users",
  Properties: [
    { Name: "id", Type: "uuid" },
    { Name: "email", Type: "string" },
    { Name: "age", Type: "int", IsNullable: true },
    { Name: "isActive", Type: "boolean" },
    {
      Name: "posts",
      Type: "Post",
      IsCollection: true,
      RelationType: "OneToMany",
      RelatedModelRef: "Post",
    },
  ],
  Methods: [
    {
      MethodName: "fullName",
      Visibility: "public",
      Parameters: [],
      ReturnType: "string",
      IsAsync: false,
      IsStatic: false,
    },
  ],
};

const POST_MODEL = {
  ClassName: "Post",
  Description: "User gonderisi",
  Properties: [
    { Name: "id", Type: "uuid" },
    { Name: "title", Type: "string" },
  ],
  Methods: [],
};

describe("emitModel", () => {
  it("tam model (PK + kolonlar + iliski + method) — snapshot", () => {
    const user = modelNode(USER_MODEL, USER_ID);
    const post = modelNode(POST_MODEL, POST_ID);
    const table = tableNode({ TableName: "users", Columns: [] }, TABLE_ID);
    const { ctx } = ctxFor([user, post, table]);
    const [file] = emitModel(ctx.graph.byId(USER_ID)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

      /** Uygulama kullanicisi */
      @Entity("users")
      export class User {
        @PrimaryGeneratedColumn("uuid")
        id!: string;

        @Column({ type: "varchar" })
        email!: string;

        @Column({ type: "int", nullable: true })
        age?: number;

        @Column({ type: "boolean" })
        isActive!: boolean;

        // TODO: relation "posts" (OneToMany -> Post) — inverse side required (no reciprocal @ManyToOne found); add manually

        fullName(): string {
          // @solarch:surgical id=aaaaaaaa-1111-4111-8111-111111111111#fullName
          throw new Error("NOT_IMPLEMENTED: User.fullName");
        }
      }
      ",
        "language": "typescript",
        "path": "users/entities/user.entity.ts",
        "surgicalMarkers": 1,
      }
    `);
  });

  it("@Entity adi bagli Table node'unun fiziksel adindan gelir (tekrar cogullanmaz)", () => {
    const model = modelNode(
      { ClassName: "Category", Description: "kategori", TableRef: "categories", Properties: [{ Name: "id", Type: "uuid" }] },
      USER_ID,
    );
    const table = tableNode({ TableName: "categories", Columns: [] }, TABLE_ID);
    const { ctx } = ctxFor([model, table]);
    const [file] = emitModel(ctx.graph.byId(USER_ID)!, ctx);
    expect(file.content).toContain('@Entity("categories")');
  });

  it("@Entity adi, tekil/PascalCase TableName icin table.emitter ile AYNI (ayrismaz)", () => {
    // Tekil/PascalCase TableName: eski hata burada ortaya cikardi (entity 'user',
    // migration 'users'). Artik ikisi de tableSqlName -> 'user' (birebir ayni).
    const table = tableNode(
      {
        TableName: "User",
        Description: "kullanici",
        Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true }],
      },
      TABLE_ID,
    );
    const model = modelNode(
      { ClassName: "User", Description: "kullanici", TableRef: "User", Properties: [{ Name: "id", Type: "uuid" }] },
      USER_ID,
    );
    const { ctx } = ctxFor([model, table]);

    const entityFile = emitModel(ctx.graph.byId(USER_ID)!, ctx)[0];
    const tableFile = emitTable(ctx.graph.byId(TABLE_ID)!, ctx)[0];

    // table.emitter'in CREATE TABLE adi.
    const createMatch = tableFile.content.match(/CREATE TABLE "([^"]+)"/);
    expect(createMatch).not.toBeNull();
    const physicalName = createMatch![1];
    expect(physicalName).toBe("user"); // cogullanmaz

    // model.emitter'in @Entity argumani ile BIREBIR ayni.
    expect(entityFile.content).toContain(`@Entity("${physicalName}")`);
  });

  it("TableRef yoksa @Entity ClassName'den TURETILIR (pluralizeSnake — acik tablo yok)", () => {
    const model = modelNode(
      { ClassName: "OrderItem", Description: "kalem", Properties: [{ Name: "id", Type: "uuid" }] },
      USER_ID,
    );
    const { ctx } = ctxFor([model]);
    const [file] = emitModel(ctx.graph.byId(USER_ID)!, ctx);
    // Acik TableName yok -> class adindan tablo adi turetilir ("order_items"),
    // bu da boyle bir Table eklendiginde dogal/cogul TableName ile tutarlidir.
    expect(file.content).toContain('@Entity("order_items")');
    expect(file.path).toBe("order-item/entities/order-item.entity.ts");
  });

  it("PK 'id' yoksa ilk property primary key olur (uuid degil)", () => {
    const model = modelNode(
      { ClassName: "Token", Description: "token", Properties: [{ Name: "value", Type: "string" }] },
      USER_ID,
    );
    const { ctx } = ctxFor([model]);
    const [file] = emitModel(ctx.graph.byId(USER_ID)!, ctx);
    expect(file.content).toContain("@PrimaryGeneratedColumn()");
    expect(file.content).toContain("value!: string;");
  });

  it("EDGE-CASE: kayip iliski referansi -> TODO satiri, throw NONE, import NONE", () => {
    const model = modelNode(
      {
        ClassName: "Comment",
        Description: "yorum",
        Properties: [
          { Name: "id", Type: "uuid" },
          {
            Name: "author",
            Type: "User",
            RelationType: "ManyToOne",
            RelatedModelRef: "Ghost",
          },
        ],
      },
      USER_ID,
    );
    const { ctx } = ctxFor([model]);
    expect(() => emitModel(ctx.graph.byId(USER_ID)!, ctx)).not.toThrow();
    const [file] = emitModel(ctx.graph.byId(USER_ID)!, ctx);
    expect(file.content).toContain("// TODO: relation \"author\"");
    // Kayip ref -> import NONE, dekorator satiri NONE (yalniz TODO yorumu).
    expect(file.content).not.toContain("ghost.entity");
    expect(file.content).not.toContain("@ManyToOne");
  });

  it("TypeORM import sirali; OneToMany inverse-side yoksa TODO'ya duser (decorator/import yok)", () => {
    const user = modelNode(USER_MODEL, USER_ID);
    const post = modelNode(POST_MODEL, POST_ID);
    const { ctx } = ctxFor([user, post]);
    const [file] = emitModel(ctx.graph.byId(USER_ID)!, ctx);
    // OneToMany'de inverseSide ZORUNLU (TS2554); semada InverseSide yok → iliski TODO,
    // OneToMany ve iliski entity'si (Post) import EDILMEZ.
    expect(file.content).toMatch(/import \{ Column, Entity, PrimaryGeneratedColumn \} from "typeorm";/);
    expect(file.content).not.toContain("@OneToMany"); // decorator emit edilmez (TODO yorumu haric)
    expect(file.content).not.toContain("import { Post }");
    expect(file.content).toContain('// TODO: relation "posts" (OneToMany -> Post)');
  });

  it("OneToMany ters-yon: iliskili Model'de geri-donen @ManyToOne varsa inverse uretilir", () => {
    // User.posts (OneToMany -> Post) + Post.author (ManyToOne -> User) → karsilikli.
    // Beklenen: @OneToMany(() => Post, (post) => post.author) + Post import + Post[] tipi.
    const user = modelNode(USER_MODEL, USER_ID);
    const postWithAuthor = modelNode(
      {
        ClassName: "Post",
        Description: "User gonderisi",
        Properties: [
          { Name: "id", Type: "uuid" },
          { Name: "title", Type: "string" },
          { Name: "author", Type: "User", RelationType: "ManyToOne", RelatedModelRef: "User" },
        ],
        Methods: [],
      },
      POST_ID,
    );
    const { ctx } = ctxFor([user, postWithAuthor]);
    const [file] = emitModel(ctx.graph.byId(USER_ID)!, ctx);
    expect(file.content).toContain("@OneToMany(() => Post, (post) => post.author)");
    expect(file.content).toContain("posts!: Post[];");
    expect(file.content).toContain("import { Post }");
    expect(file.content).toContain("OneToMany"); // typeorm import'una eklendi
    expect(file.content).not.toContain('// TODO: relation "posts"');
  });

  it("PascalCase property + .NET Guid → camelCase TS uye + string + @Column uuid", () => {
    const id = "aaaa1111-2222-3333-4444-555566667777";
    const model = modelNode(
      {
        ClassName: "Account",
        Description: "x",
        Properties: [
          { Name: "Id", Type: "Guid", IsNullable: false, IsPrimaryKey: true },
          { Name: "CustomerId", Type: "Guid", IsNullable: false },
        ],
      },
      id,
    );
    const { ctx } = ctxFor([model]);
    const [file] = emitModel(ctx.graph.byId(id)!, ctx);
    expect(file.content).toContain("customerId!: string;"); // PascalCase→camelCase + Guid→string
    expect(file.content).not.toContain("CustomerId");
    expect(file.content).not.toContain("Guid");
    expect(file.content).toContain('type: "uuid"'); // @Column Guid→uuid
  });

  it("method govdesi surgical marker + NOT_IMPLEMENTED icerir", () => {
    const user = modelNode(USER_MODEL, USER_ID);
    const post = modelNode(POST_MODEL, POST_ID);
    const { ctx } = ctxFor([user, post]);
    const [file] = emitModel(ctx.graph.byId(USER_ID)!, ctx);
    expect(file.content).toContain(`// @solarch:surgical id=${USER_ID}#fullName`);
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: User.fullName");');
    expect(file.surgicalMarkers).toBe(1);
  });

  it("content ends with single newline", () => {
    const user = modelNode(USER_MODEL, USER_ID);
    const post = modelNode(POST_MODEL, POST_ID);
    const { ctx } = ctxFor([user, post]);
    const [file] = emitModel(ctx.graph.byId(USER_ID)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMINISM: same node twice -> byte-identical", () => {
    const user = modelNode(USER_MODEL, USER_ID);
    const post = modelNode(POST_MODEL, POST_ID);
    const { ctx } = ctxFor([user, post]);
    const a = emitModel(ctx.graph.byId(USER_ID)!, ctx)[0].content;
    const b = emitModel(ctx.graph.byId(USER_ID)!, ctx)[0].content;
    expect(a).toBe(b);
  });

  /* ── ENUM property -> @Column({ type: "varchar" }) + TS tipi generated enum ───
   * #56: native Postgres enum NOT (migration de VARCHAR + CHECK uretir -> tutarli).
   * TS alan tipi yine generated enum sinifi (status!: OrderStatus) ve import edilir. */
  it("ENUM property -> @Column({ type: 'varchar' }), TS tipi generated enum + import", () => {
    const orderStatus: StoredNode = {
      id: "e1e1e1e1-1111-4111-8111-e1e1e1e1e1e1",
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
        Description: "Order status",
        BackingType: "string",
        Values: [{ Key: "PENDING", Value: "pending" }, { Key: "PAID", Value: "paid" }],
      },
    };
    const order = modelNode(
      {
        ClassName: "Order",
        Description: "Order",
        Properties: [
          { Name: "id", Type: "uuid" },
          { Name: "status", Type: "OrderStatus" },
        ],
      },
      "0d0d0d0d-1111-4111-8111-0d0d0d0d0d0d",
    );
    const { ctx } = ctxFor([order, orderStatus]);
    const [file] = emitModel(ctx.graph.byId(order.id)!, ctx);
    // @Column VARCHAR (native enum NOT), TS tipi yine generated enum + import.
    expect(file.content).toMatch(/@Column\(\{ type: "varchar" \}\)\s*\n\s*status!: OrderStatus;/);
    expect(file.content).toContain('import { OrderStatus }');
    expect(file.content).not.toContain('type: "enum"');
    expect(file.content).not.toContain("enum: OrderStatus");
  });
});
