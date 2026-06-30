import { describe, it, expect } from "vitest";
import {
  emitSyntheticEntity,
  entityClassNameForTable,
  synthEntityFilePath,
  tablesNeedingSyntheticEntity,
} from "./entity-synthesis";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { NodeKind } from "../../../nodes/schemas";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ────────────────────────────────────────────────────────────────────────
 * entity-synthesis.spec.ts — Table'dan SENTEZLENEN TypeORM entity.
 *
 * Model'i WITHOUT ama bir Repository tarafindan referans edilen Table icin
 * @Entity sinifi uretilir; @InjectRepository/Repository<T>/forFeature tutarli
 * olur ve uygulama BOOT BOOTS (Table-only graph BOOT garantisi).
 * ──────────────────────────────────────────────────────────────────────── */

let seq = 0;
function node(type: NodeKind, properties: Record<string, unknown>): StoredNode {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    type,
    projectId: "11111111-1111-4111-8111-111111111111",
    positionX: 0,
    positionY: 0,
    homeTabId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}
function edge(kind: EdgeKind, s: StoredNode, t: StoredNode): StoredEdge {
  seq += 1;
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    projectId: "11111111-1111-4111-8111-111111111111",
    sourceNodeId: s.id,
    targetNodeId: t.id,
    kind,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: false },
  };
}
function ctxFor(nodes: StoredNode[], edges: StoredEdge[]): EmitterContext {
  return { graph: buildCodeGraph(nodes, edges), target: "nestjs" };
}

const imagesTable = () =>
  node("Table", {
    TableName: "GeneratedImages",
    Description: "Uretilen gorseller",
    Columns: [
      { Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false },
      { Name: "url", DataType: "TEXT", IsPrimaryKey: false, IsNotNull: false, IsUnique: false, AutoIncrement: false },
    ],
  });

const imageRepo = () =>
  node("Repository", {
    RepositoryName: "ImageRepository",
    Description: "Gorsel erisimi",
    EntityReference: "GeneratedImages",
    IsCached: false,
    CustomQueries: [],
  });

describe("entity-synthesis", () => {
  it("entityClassNameForTable: tablo adi tekil-pascal'a cevrilir", () => {
    const t = imagesTable();
    expect(entityClassNameForTable(buildCodeGraph([t], []).byId(t.id)!)).toBe("GeneratedImage");
    const users = node("Table", { TableName: "Users", Description: "x", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }] });
    expect(entityClassNameForTable(buildCodeGraph([users], []).byId(users.id)!)).toBe("User");
  });

  it("synthEntityFilePath: <feature>/entities/<kebab-singular>.entity.ts", () => {
    const t = imagesTable();
    const repo = imageRepo();
    const graph = buildCodeGraph([t, repo], [edge("WRITES", repo, t)]);
    expect(synthEntityFilePath(graph.byId(t.id)!, graph)).toBe("image/entities/generated-image.entity.ts");
  });

  it("tablesNeedingSyntheticEntity: yalniz repo-referansli + Model'siz Table'lar", () => {
    const t = imagesTable();
    const repo = imageRepo();
    const graph = buildCodeGraph([t, repo], [edge("WRITES", repo, t)]);
    expect(tablesNeedingSyntheticEntity(graph).map((x) => x.name)).toEqual(["GeneratedImages"]);
  });

  it("Model'i OLAN Table icin sentez YAPILMAZ (Model entity uretilir)", () => {
    const t = imagesTable();
    const model = node("Model", { ClassName: "GeneratedImage", Description: "x", TableRef: "GeneratedImages", Properties: [{ Name: "id", Type: "uuid" }], Methods: [] });
    const repo = imageRepo();
    const graph = buildCodeGraph([t, model, repo], [edge("WRITES", repo, t)]);
    expect(tablesNeedingSyntheticEntity(graph)).toEqual([]);
  });

  it("hicbir repository referans etmeyen Table icin sentez YAPILMAZ", () => {
    const t = imagesTable();
    const graph = buildCodeGraph([t], []);
    expect(tablesNeedingSyntheticEntity(graph)).toEqual([]);
  });

  it("emitSyntheticEntity: @Entity(fiziksel ad) + PK @PrimaryGeneratedColumn + kolonlar", () => {
    const t = imagesTable();
    const repo = imageRepo();
    const ctx = ctxFor([t, repo], [edge("WRITES", repo, t)]);
    const [file] = emitSyntheticEntity(ctx.graph.byId(t.id)!, ctx);
    expect(file.path).toBe("image/entities/generated-image.entity.ts");
    // @Entity adi migration tablo adiyla AYNI (tableSqlName).
    expect(file.content).toContain('@Entity("generated_images")');
    expect(file.content).toContain("export class GeneratedImage {");
    expect(file.content).toContain("@PrimaryGeneratedColumn(\"uuid\")");
    expect(file.content).toContain("id!: string;");
    expect(file.content).toContain("@Column(");
    expect(file.content).toContain("url?: string;");
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.surgicalMarkers).toBe(0);
  });

  it("DETERMINISM: ayni table iki kez -> byte-identical", () => {
    const t = imagesTable();
    const repo = imageRepo();
    const ctx = ctxFor([t, repo], [edge("WRITES", repo, t)]);
    const a = emitSyntheticEntity(ctx.graph.byId(t.id)!, ctx)[0].content;
    const b = emitSyntheticEntity(ctx.graph.byId(t.id)!, ctx)[0].content;
    expect(a).toBe(b);
  });

  it("FK olmayan table -> iliski dekoratoru URETILMEZ (mevcut akis korunur)", () => {
    const t = imagesTable();
    const repo = imageRepo();
    const ctx = ctxFor([t, repo], [edge("WRITES", repo, t)]);
    const [file] = emitSyntheticEntity(ctx.graph.byId(t.id)!, ctx);
    expect(file.content).not.toContain("@ManyToOne");
    expect(file.content).not.toContain("@OneToMany");
    expect(file.content).not.toContain("@JoinColumn");
  });

  describe("ILISKI SENTEZI (M2)", () => {
    // users <- posts.author_id (FK). Ikisi de Model'siz + repo-referansli ->
    // sentetik entity. posts -> @ManyToOne(User), users -> @OneToMany(Post).
    const usersTable = () =>
      node("Table", {
        TableName: "users",
        Description: "Userlar",
        Columns: [
          { Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false },
        ],
      });
    const postsTable = (nullableFk = false) =>
      node("Table", {
        TableName: "posts",
        Description: "Gonderiler",
        Columns: [
          { Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false },
          { Name: "author_id", DataType: "UUID", IsPrimaryKey: false, IsNotNull: !nullableFk, IsUnique: false, AutoIncrement: false },
        ],
        ForeignKeys: [
          { Columns: ["author_id"], ReferencesTable: "users", ReferencesColumns: ["id"], OnDelete: "CASCADE", OnUpdate: "NO_ACTION" },
        ],
      });
    const repoFor = (name: string, entity: string) =>
      node("Repository", { RepositoryName: name, Description: "x", EntityReference: entity, IsCached: false, CustomQueries: [] });

    function relCtx(nullableFk = false): EmitterContext {
      const users = usersTable();
      const posts = postsTable(nullableFk);
      const usersRepo = repoFor("UsersRepository", "users");
      const postsRepo = repoFor("PostsRepository", "posts");
      return ctxFor([users, posts, usersRepo, postsRepo], []);
    }

    it("FK sahip tarafi -> @ManyToOne + @JoinColumn(fiziksel FK kolonu), eager:false", () => {
      const ctx = relCtx();
      const posts = ctx.graph.allOf("Table").find((t) => t.name === "posts")!;
      const [file] = emitSyntheticEntity(posts, ctx);
      expect(file.content).toContain("@ManyToOne(() => User, { eager: false })");
      expect(file.content).toContain('@JoinColumn({ name: "author_id" })');
      expect(file.content).toContain("author!: User;");
      // Sentetik entity import'u + typeorm dekorator import'lari.
      expect(file.content).toContain("import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from \"typeorm\";");
      expect(file.content).toContain("entities/user.entity");
      expect(file.surgicalMarkers).toBe(0);
    });

    it("FK ters tarafi -> @OneToMany(() => Post, (post) => post.author), definite-assignment", () => {
      const ctx = relCtx();
      const users = ctx.graph.allOf("Table").find((t) => t.name === "users")!;
      const [file] = emitSyntheticEntity(users, ctx);
      // author_id FK ON DELETE CASCADE -> aggregate -> @OneToMany cascade: true.
      expect(file.content).toContain("@OneToMany(() => Post, (post) => post.author, { cascade: true })");
      // TypeORM iliski property'lerinde dizi initializer'i (= []) YASAKLAR
      //   (InitializedRelationError -> migration/boot patlar). "!" kullanilir.
      expect(file.content).toContain("posts!: Post[];");
      expect(file.content).not.toContain("posts: Post[] = [];");
      expect(file.content).toContain("import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from \"typeorm\";");
      expect(file.content).toContain("entities/post.entity");
    });

    it("nullable FK -> opsiyonel @ManyToOne (nullable: true, '?' alan)", () => {
      const ctx = relCtx(true);
      const posts = ctx.graph.allOf("Table").find((t) => t.name === "posts")!;
      const [file] = emitSyntheticEntity(posts, ctx);
      expect(file.content).toContain("@ManyToOne(() => User, { eager: false, nullable: true })");
      expect(file.content).toContain("author?: User;");
    });

    it("FK KAPANISI: repo-referanssiz ama core tablonun FK hedefi -> entity sentezlenir + iliski URETILIR", () => {
      // users hicbir repository tarafindan referans EDILMIYOR; ama core (repo-referansli)
      // posts ondan FK ile bagli -> FK kapanisi users'i da sentetik entity'ye ceker
      // (sema<->ORM kapsami tam: FK iliskisi @ManyToOne(User) cozulebilir).
      const users = usersTable();
      const posts = postsTable();
      const postsRepo = repoFor("PostsRepository", "posts");
      const ctx = ctxFor([users, posts, postsRepo], []);
      // users artik sentez kumesinde.
      expect(tablesNeedingSyntheticEntity(ctx.graph).map((t) => t.name).sort()).toEqual(["posts", "users"]);
      const postsNode = ctx.graph.allOf("Table").find((t) => t.name === "posts")!;
      const [file] = emitSyntheticEntity(postsNode, ctx);
      // Karsi taraf (users) artik sentetik entity -> @ManyToOne(User) uretilir.
      expect(file.content).toContain("@ManyToOne(() => User, { eager: false })");
      expect(file.content).toContain('@JoinColumn({ name: "author_id" })');
    });

    it("SAFLIK: hedef tablonun Model'i VAR -> iliski URETILMEZ (Model entity ayri)", () => {
      const users = usersTable();
      const posts = postsTable();
      const userModel = node("Model", { ClassName: "User", Description: "x", TableRef: "users", Properties: [{ Name: "id", Type: "uuid" }], Methods: [] });
      const usersRepo = repoFor("UsersRepository", "users");
      const postsRepo = repoFor("PostsRepository", "posts");
      const ctx = ctxFor([users, posts, userModel, usersRepo, postsRepo], []);
      const postsNode = ctx.graph.allOf("Table").find((t) => t.name === "posts")!;
      const [file] = emitSyntheticEntity(postsNode, ctx);
      expect(file.content).not.toContain("@ManyToOne");
    });

    it("composite (cok-kolon) FK -> iliski URETILMEZ (tek-kolon esleme yapilamaz)", () => {
      const parent = node("Table", {
        TableName: "parents",
        Description: "x",
        Columns: [
          { Name: "a", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false },
          { Name: "b", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false },
        ],
      });
      const child = node("Table", {
        TableName: "children",
        Description: "x",
        Columns: [
          { Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false },
          { Name: "pa", DataType: "UUID", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
          { Name: "pb", DataType: "UUID", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
        ],
        ForeignKeys: [
          { Columns: ["pa", "pb"], ReferencesTable: "parents", ReferencesColumns: ["a", "b"], OnDelete: "NO_ACTION", OnUpdate: "NO_ACTION" },
        ],
      });
      const parentRepo = repoFor("ParentRepository", "parents");
      const childRepo = repoFor("ChildRepository", "children");
      const ctx = ctxFor([parent, child, parentRepo, childRepo], []);
      const childNode = ctx.graph.allOf("Table").find((t) => t.name === "children")!;
      const [file] = emitSyntheticEntity(childNode, ctx);
      expect(file.content).not.toContain("@ManyToOne");
    });

    it("DETERMINISM: iliskili graph -> byte-identical iki kez", () => {
      const ctx = relCtx();
      const posts = ctx.graph.allOf("Table").find((t) => t.name === "posts")!;
      const a = emitSyntheticEntity(posts, ctx)[0].content;
      const b = emitSyntheticEntity(posts, ctx)[0].content;
      expect(a).toBe(b);
    });
  });

  describe("TIP MAP (#1): ENUM/JSON + skaler tipler STRICT TS uretir", () => {
    const enumNode = () =>
      node("Enum", {
        Name: "OrderStatus",
        Description: "Order lifecycle",
        BackingType: "string",
        Values: [{ Key: "PENDING" }, { Key: "PAID" }],
      });
    // VARCHAR/UUID/INT/BIGINT/DECIMAL/FLOAT/BOOLEAN/DATETIME/DATE/JSON/ENUM hepsi.
    const richTable = () =>
      node("Table", {
        TableName: "orders",
        Description: "Orders",
        Columns: [
          { Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false },
          { Name: "code", DataType: "VARCHAR", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
          { Name: "qty", DataType: "INT", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
          { Name: "big", DataType: "BIGINT", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
          { Name: "total", DataType: "DECIMAL", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
          { Name: "rate", DataType: "FLOAT", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
          { Name: "is_paid", DataType: "BOOLEAN", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
          { Name: "created_at", DataType: "DATETIME", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
          { Name: "due_on", DataType: "DATE", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
          { Name: "metadata", DataType: "JSON", IsPrimaryKey: false, IsNotNull: false, IsUnique: false, AutoIncrement: false },
          { Name: "status", DataType: "ENUM", EnumRef: "OrderStatus", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
        ],
      });
    const repo = () => node("Repository", { RepositoryName: "OrderRepository", Description: "x", EntityReference: "orders", IsCached: false, CustomQueries: [] });

    it("ENUM kolon -> TS tipi generated enum + @Column({ type:'varchar' }) (#56: native enum NOT, migration CHECK ile)", () => {
      const ctx = ctxFor([richTable(), repo(), enumNode()], []);
      const orders = ctx.graph.allOf("Table").find((t) => t.name === "orders")!;
      const [file] = emitSyntheticEntity(orders, ctx);
      // ESKI HATA: `status!: ENUM;` (gecersiz TS).
      expect(file.content).not.toContain("ENUM;");
      // TS tipi yine generated enum sinifi; ama @Column VARCHAR -> entity↔migration
      // tutarli (migration de VARCHAR + CHECK). native Postgres enum URETILMEZ.
      expect(file.content).toMatch(/@Column\(\{ type: "varchar" \}\)\s*\n\s*status!: OrderStatus;/);
      expect(file.content).toContain('import { OrderStatus } from "../../common/enums/order-status.enum";');
      expect(file.content).not.toContain('type: "enum"');
      expect(file.content).not.toContain("enum: OrderStatus");
    });

    it("EnumRef cozulemez -> guvenli string + @Column({ type:'varchar' }) (throw NONE)", () => {
      const ctx = ctxFor([richTable(), repo()], []); // Enum node NONE
      const orders = ctx.graph.allOf("Table").find((t) => t.name === "orders")!;
      const [file] = emitSyntheticEntity(orders, ctx);
      expect(file.content).toContain("status!: string;");
      expect(file.content).toContain('@Column({ type: "varchar" })');
      expect(file.content).not.toContain("OrderStatus");
    });

    it("JSON kolon -> Record<string, unknown> + @Column({ type:'jsonb' }) (ESKI HATA: `JSON;`)", () => {
      const ctx = ctxFor([richTable(), repo(), enumNode()], []);
      const orders = ctx.graph.allOf("Table").find((t) => t.name === "orders")!;
      const [file] = emitSyntheticEntity(orders, ctx);
      expect(file.content).not.toMatch(/:\s*JSON;/);
      expect(file.content).toContain("metadata?: Record<string, unknown>;");
      expect(file.content).toContain('@Column({ type: "jsonb", nullable: true })');
    });

    it("skaler tipler dogru TS + TypeORM tipine eslenir", () => {
      const ctx = ctxFor([richTable(), repo(), enumNode()], []);
      const orders = ctx.graph.allOf("Table").find((t) => t.name === "orders")!;
      const [file] = emitSyntheticEntity(orders, ctx);
      expect(file.content).toContain("id!: string;"); // UUID -> string
      expect(file.content).toContain('@Column({ type: "varchar" })');
      expect(file.content).toContain("code!: string;");
      expect(file.content).toContain('@Column({ type: "int" })');
      expect(file.content).toContain("qty!: number;");
      expect(file.content).toContain('@Column({ type: "bigint" })');
      expect(file.content).toContain("big!: number;");
      expect(file.content).toContain('@Column({ type: "decimal" })');
      expect(file.content).toContain("total!: number;");
      expect(file.content).toContain('@Column({ type: "double precision" })');
      expect(file.content).toContain("rate!: number;");
      expect(file.content).toContain('@Column({ type: "boolean" })');
      // TS uye adi idiomatik camelCase (is_paid→isPaid); DB kolonu snake_case kalir (SnakeNamingStrategy).
      expect(file.content).toContain("isPaid!: boolean;");
      expect(file.content).toContain('@Column({ type: "timestamp" })');
      expect(file.content).toContain("createdAt!: Date;");
      expect(file.content).toContain('@Column({ type: "date" })');
      expect(file.content).toContain("dueOn!: Date;");
    });
  });

  describe("SEMA<->ORM KAPSAMI (#9): join/ara tablolar da sentezlenir", () => {
    // orders <- order_items -> products. order_items NE bir repo gosterir NE de
    // Model'i var; ama core tablolara (orders/products) FK verir -> FK kapanisi
    // onu da sentetik entity'ye ceker (migration var, entity de olur).
    const tbl = (name: string, cols: Record<string, unknown>[], fks: Record<string, unknown>[] = []) =>
      node("Table", { TableName: name, Description: name, Columns: cols, ForeignKeys: fks });
    const pkCol = { Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false };
    const fkCol = (n: string) => ({ Name: n, DataType: "UUID", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false });
    const repo = (name: string, entity: string) => node("Repository", { RepositoryName: name, Description: "x", EntityReference: entity, IsCached: false, CustomQueries: [] });

    function joinCtx(): EmitterContext {
      const orders = tbl("orders", [pkCol]);
      const products = tbl("products", [pkCol]);
      const orderItems = tbl(
        "order_items",
        [pkCol, fkCol("order_id"), fkCol("product_id")],
        [
          { Columns: ["order_id"], ReferencesTable: "orders", ReferencesColumns: ["id"], OnDelete: "CASCADE", OnUpdate: "NO_ACTION" },
          { Columns: ["product_id"], ReferencesTable: "products", ReferencesColumns: ["id"], OnDelete: "RESTRICT", OnUpdate: "NO_ACTION" },
        ],
      );
      // Yalniz orders + products bir repo gosterir; order_items GOSTERMEZ.
      return ctxFor([orders, products, orderItems, repo("OrderRepository", "orders"), repo("ProductRepository", "products")], []);
    }

    it("order_items (join, repo-referanssiz) entity SENTEZLENIR", () => {
      const names = tablesNeedingSyntheticEntity(joinCtx().graph).map((t) => t.name).sort();
      expect(names).toEqual(["order_items", "orders", "products"]);
    });

    it("order_items entity -> her FK icin @ManyToOne(core entity) + @JoinColumn", () => {
      const ctx = joinCtx();
      const oi = ctx.graph.allOf("Table").find((t) => t.name === "order_items")!;
      const [file] = emitSyntheticEntity(oi, ctx);
      expect(file.content).toContain("export class OrderItem {");
      expect(file.content).toContain("@ManyToOne(() => Order, { eager: false })");
      expect(file.content).toContain('@JoinColumn({ name: "order_id" })');
      expect(file.content).toContain("@ManyToOne(() => Product, { eager: false })");
      expect(file.content).toContain('@JoinColumn({ name: "product_id" })');
    });

    it("orders entity -> @OneToMany(OrderItem) + cascade (order_items->orders FK CASCADE)", () => {
      const ctx = joinCtx();
      const orders = ctx.graph.allOf("Table").find((t) => t.name === "orders")!;
      const [file] = emitSyntheticEntity(orders, ctx);
      // order_items->orders FK ON DELETE CASCADE -> aggregate -> cascade: true.
      expect(file.content).toContain("@OneToMany(() => OrderItem, (orderItem) => orderItem.order, { cascade: true })");
      expect(file.content).toContain("orderItems!: OrderItem[];");
      expect(file.content).not.toContain("orderItems: OrderItem[] = [];");
    });

    it("products entity -> @OneToMany(OrderItem) cascade NONE (order_items->products FK RESTRICT)", () => {
      const ctx = joinCtx();
      const products = ctx.graph.allOf("Table").find((t) => t.name === "products")!;
      const [file] = emitSyntheticEntity(products, ctx);
      // order_items->products FK RESTRICT -> bagimsiz iliski -> cascade NONE.
      expect(file.content).toContain("@OneToMany(() => OrderItem, (orderItem) => orderItem.product)");
      expect(file.content).not.toContain("orderItem.product, { cascade");
    });
  });
});
