import { describe, it, expect } from "vitest";
import { emitRepository } from "./repository.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { NodeKind } from "../../../nodes/schemas";

/* ── Fixture helpers (enum.emitter.spec deseni) ───────────────────── */
function storedNode(
  type: NodeKind,
  properties: Record<string, unknown>,
  id: string,
): StoredNode {
  return {
    id,
    type,
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

const REPO_ID = "33333333-3333-4333-8333-333333333333";
const MODEL_ID = "44444444-4444-4444-8444-444444444444";

const USER_MODEL = storedNode(
  "Model",
  {
    ClassName: "User",
    Description: "User entity",
    Properties: [{ Name: "id", Type: "string" }],
    Methods: [],
  },
  MODEL_ID,
);

const USER_REPO = storedNode(
  "Repository",
  {
    RepositoryName: "UserRepository",
    Description: "User veri erisimi",
    EntityReference: "User",
    IsCached: false,
    CustomQueries: [
      {
        QueryName: "findByEmail",
        QueryType: "findOne",
        Parameters: [{ Name: "email", Type: "string" }],
        ReturnType: "User | null",
        Description: "E-postaya gore kullanici bul",
      },
      {
        QueryName: "countActive",
        QueryType: "aggregate",
        Parameters: [],
        ReturnType: "number",
      },
    ],
  },
  REPO_ID,
);

describe("emitRepository", () => {
  it("Model entity ile tam uretim — snapshot", () => {
    const { ctx } = ctxFor(USER_REPO, USER_MODEL);
    const [file] = emitRepository(ctx.graph.byId(REPO_ID)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { Injectable } from "@nestjs/common";
      import { InjectRepository } from "@nestjs/typeorm";
      import { FindOptionsWhere, Repository } from "typeorm";
      import { User } from "./entities/user.entity";

      /** User veri erisimi */
      @Injectable()
      export class UserRepository {
        constructor(
          @InjectRepository(User)
          private readonly repo: Repository<User>,
        ) {}

        async findById(id: string): Promise<User | null> {
          return this.repo.findOne({
            where: { id: id } as FindOptionsWhere<User>,
            relations: this.repo.metadata.relations.map((r) => r.propertyName),
          });
        }

        async findAll(): Promise<User[]> {
          return this.repo.find();
        }

        async save(entity: User): Promise<User> {
          return this.repo.save(entity);
        }

        async remove(id: string): Promise<void> {
          await this.repo.delete(id);
        }

        async countActive(): Promise<number> {
          // @solarch:surgical id=33333333-3333-4333-8333-333333333333#countActive
          // GUIDANCE: fetch related data in a SINGLE query via join/relations (leftJoinAndSelect or find({ relations })); avoid N+1 by not relying on lazy access inside a loop.
          // deps: repo
          throw new Error("NOT_IMPLEMENTED: UserRepository.countActive");
        }

        async findByEmail(email: string): Promise<User | null> {
          // @solarch:surgical id=33333333-3333-4333-8333-333333333333#findByEmail
          // E-postaya gore kullanici bul
          // GUIDANCE: fetch related data in a SINGLE query via join/relations (leftJoinAndSelect or find({ relations })); avoid N+1 by not relying on lazy access inside a loop.
          // deps: repo
          throw new Error("NOT_IMPLEMENTED: UserRepository.findByEmail");
        }
      }
      ",
        "language": "typescript",
        "path": "user/user.repository.ts",
        "surgicalMarkers": 2,
      }
    `);
  });

  it("dogru import'lar, dekorator, DI ve entity tipi", () => {
    const { ctx } = ctxFor(USER_REPO, USER_MODEL);
    const [file] = emitRepository(ctx.graph.byId(REPO_ID)!, ctx);
    expect(file.content).toContain(`import { Injectable } from "@nestjs/common";`);
    expect(file.content).toContain(`import { InjectRepository } from "@nestjs/typeorm";`);
    // Repository + FindOptionsWhere (standart CRUD findById where-cast'i icin).
    expect(file.content).toContain(`import { FindOptionsWhere, Repository } from "typeorm";`);
    expect(file.content).toContain(`import { User } from "./entities/user.entity";`);
    expect(file.content).toContain("@Injectable()");
    expect(file.content).toContain("export class UserRepository {");
    expect(file.content).toContain("@InjectRepository(User)");
    expect(file.content).toContain("private readonly repo: Repository<User>,");
  });

  it("CustomQuery -> async imza + surgical marker + NOT_IMPLEMENTED", () => {
    const { ctx } = ctxFor(USER_REPO, USER_MODEL);
    const [file] = emitRepository(ctx.graph.byId(REPO_ID)!, ctx);
    expect(file.content).toContain("async findByEmail(email: string): Promise<User | null> {");
    expect(file.content).toContain(`id=${REPO_ID}#findByEmail`);
    expect(file.content).toContain(`throw new Error("NOT_IMPLEMENTED: UserRepository.findByEmail");`);
    expect(file.surgicalMarkers).toBe(2);
  });

  it("CustomQuery'ler isme gore sirali (countActive < findByEmail)", () => {
    const { ctx } = ctxFor(USER_REPO, USER_MODEL);
    const [file] = emitRepository(ctx.graph.byId(REPO_ID)!, ctx);
    const idxCount = file.content.indexOf("async countActive");
    const idxFind = file.content.indexOf("async findByEmail");
    expect(idxCount).toBeGreaterThan(-1);
    expect(idxFind).toBeGreaterThan(idxCount);
  });

  it("BaseClass cozulemez serbest ad -> extends URETILMEZ (TS2304 onlenir), TODO birakilir", () => {
    const repo = storedNode(
      "Repository",
      {
        RepositoryName: "OrderRepository",
        Description: "Order erisimi",
        EntityReference: "Order",
        BaseClass: "BaseRepository",
        IsCached: false,
        CustomQueries: [],
      },
      "55555555-5555-4555-8555-555555555555",
    );
    const model = storedNode(
      "Model",
      {
        ClassName: "Order",
        Description: "Order",
        Properties: [{ Name: "id", Type: "string" }],
        Methods: [],
      },
      "66666666-6666-4666-8666-666666666666",
    );
    const { ctx } = ctxFor(repo, model);
    const [file] = emitRepository(ctx.graph.byId(repo.id)!, ctx);
    // BaseClass cozulebilir bir node NOT (import edilemez) -> `extends` uretmek
    // TS2304 'Cannot find name BaseRepository' verirdi. Bunun yerine duz sinif +
    // TODO yorumu (gelistirici elle ekler).
    expect(file.content).toContain("export class OrderRepository {");
    expect(file.content).not.toContain("extends BaseRepository");
    expect(file.content).not.toContain("super();");
    expect(file.content).toContain('// TODO: BaseClass "BaseRepository"');
  });

  it("dosya yolu feature klasoru + .repository.ts", () => {
    const { ctx } = ctxFor(USER_REPO, USER_MODEL);
    const [file] = emitRepository(ctx.graph.byId(REPO_ID)!, ctx);
    expect(file.path).toBe("user/user.repository.ts");
    expect(file.language).toBe("typescript");
  });

  it("content ends with single newline", () => {
    const { ctx } = ctxFor(USER_REPO, USER_MODEL);
    const [file] = emitRepository(ctx.graph.byId(REPO_ID)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMINISM: same node twice -> byte-identical", () => {
    const { ctx } = ctxFor(USER_REPO, USER_MODEL);
    const a = emitRepository(ctx.graph.byId(REPO_ID)!, ctx)[0].content;
    const b = emitRepository(ctx.graph.byId(REPO_ID)!, ctx)[0].content;
    expect(a).toBe(b);
  });

  it("EDGE-CASE: kayip EntityReference -> TODO + entity import NONE, throw NONE", () => {
    const orphan = storedNode(
      "Repository",
      {
        RepositoryName: "GhostRepository",
        Description: "Baglantisiz repo",
        EntityReference: "Phantom",
        IsCached: false,
        CustomQueries: [],
      },
      "77777777-7777-4777-8777-777777777777",
    );
    // Model/Table eklenmedi -> resolveRef null.
    const { ctx } = ctxFor(orphan);
    const result = emitRepository(ctx.graph.byId(orphan.id)!, ctx);
    expect(result).toHaveLength(1);
    const [file] = result;
    expect(file.content).toContain(`// TODO: EntityReference "Phantom" could not be resolved`);
    // Cozulemeyen ref -> import edilebilir sembol yok. DERLENEBILIR kalmak icin
    // string token + Repository<any> (TS2304 'Cannot find name Phantom' onlenir).
    expect(file.content).toContain('@InjectRepository("Phantom")');
    expect(file.content).toContain("private readonly repo: Repository<any>,");
    expect(file.content).not.toContain("Repository<Phantom>");
    expect(file.content).not.toContain(".entity");
    expect(file.surgicalMarkers).toBe(0);
  });

  it("CustomQuery tip normalizasyonu: UUID -> string, Date korunur (TS2304 onlenir)", () => {
    const repo = storedNode(
      "Repository",
      {
        RepositoryName: "EventRepository",
        Description: "Olay erisimi",
        EntityReference: "User",
        IsCached: false,
        CustomQueries: [
          {
            QueryName: "findSince",
            QueryType: "find",
            Parameters: [{ Name: "id", Type: "UUID" }, { Name: "since", Type: "datetime" }],
            ReturnType: "number",
          },
        ],
      },
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    const { ctx } = ctxFor(repo, USER_MODEL);
    const [file] = emitRepository(ctx.graph.byId(repo.id)!, ctx);
    // UUID -> string, datetime -> Date (scalarTsType); ham 'UUID'/'datetime'
    // tanimsiz semboller olurdu -> nest build TS2304 ile kirilirdi.
    expect(file.content).toContain("async findSince(id: string, since: Date): Promise<number>");
    expect(file.content).not.toContain("UUID");
    expect(file.content).not.toContain("datetime");
  });

  it("CustomQuery ReturnType entity adi -> import + sinif (User Model cozulur)", () => {
    const { ctx } = ctxFor(USER_REPO, USER_MODEL);
    const [file] = emitRepository(ctx.graph.byId(REPO_ID)!, ctx);
    // ReturnType "User | null" -> User Model'i cozulur + entity import edilir.
    expect(file.content).toContain('import { User } from "./entities/user.entity";');
    expect(file.content).toContain("Promise<User | null>");
  });

  it("CustomQuery ReturnType View adi -> VALUE import (import type NOT — TS1361 onler)", () => {
    // @ViewEntity bir SINIFTIR; govde onu DEGER olarak kullanabilir (repository token,
    // QueryBuilder). `import type { ActiveUsersView }` -> TS1361. Value import olmali.
    const viewRepo = storedNode(
      "Repository",
      {
        RepositoryName: "ReportRepository",
        Description: "View okur",
        EntityReference: "User",
        IsCached: false,
        CustomQueries: [
          {
            QueryName: "activeSummary",
            QueryType: "findMany",
            Parameters: [],
            ReturnType: "ActiveUsersView",
            Description: "Active user summary",
          },
        ],
      },
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    const viewNode = storedNode(
      "View",
      {
        ViewName: "ActiveUsersView",
        Description: "Active user summary",
        Definition: "SELECT id FROM users WHERE is_active = true",
        SourceTables: ["users"],
        Materialized: false,
        Columns: [{ Name: "id", DataType: "INT" }],
      },
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );
    const { ctx } = ctxFor(viewRepo, USER_MODEL, viewNode);
    const [file] = emitRepository(ctx.graph.byId(viewRepo.id)!, ctx);
    expect(file.content).toContain("ActiveUsersView");
    // value import (import { ... }) — import type OLMAMALI.
    expect(file.content).not.toMatch(/import type\s*\{\s*ActiveUsersView/);
    expect(file.content).toMatch(/import\s*\{\s*ActiveUsersView\s*\}/);
  });

  it("EDGE-CASE: bos CustomQueries -> constructor + standart CRUD (surgical NONE)", () => {
    // #3: CustomQuery olmasa BILE her repository TAM CRUD tasir (findById/findAll/
    //   save/remove) — bunlar GERCEK (deterministik) govdelerdir, surgical NOT.
    const bare = storedNode(
      "Repository",
      {
        RepositoryName: "BareRepository",
        Description: "Sadece DI",
        EntityReference: "User",
        IsCached: false,
        CustomQueries: [],
      },
      "88888888-8888-4888-8888-888888888888",
    );
    const { ctx } = ctxFor(bare, USER_MODEL);
    const [file] = emitRepository(ctx.graph.byId(bare.id)!, ctx);
    expect(file.content).toContain("private readonly repo: Repository<User>,");
    // Standart CRUD daima uretilir (GERCEK govde, NOT_IMPLEMENTED yok).
    expect(file.content).toContain("async findById(id: string): Promise<User | null> {");
    // findById artik findOne + relations (iliskileri tek sorguda yukler).
    expect(file.content).toContain("where: { id: id } as FindOptionsWhere<User>,");
    expect(file.content).toContain("relations: this.repo.metadata.relations.map((r) => r.propertyName),");
    expect(file.content).toContain("async findAll(): Promise<User[]> {");
    expect(file.content).toContain("return this.repo.find();");
    expect(file.content).toContain("async save(entity: User): Promise<User> {");
    expect(file.content).toContain("return this.repo.save(entity);");
    expect(file.content).toContain("async remove(id: string): Promise<void> {");
    expect(file.content).toContain("await this.repo.delete(id);");
    // CRUD gercek govde -> surgical marker / NOT_IMPLEMENTED NONE (CustomQuery yok).
    expect(file.content).not.toContain("NOT_IMPLEMENTED");
    expect(file.surgicalMarkers).toBe(0);
  });

  it("#3 CRUD: kayip EntityReference -> CRUD yine uretilir (any tip + FindOptionsWhere<any>), derlenebilir", () => {
    // Kayip entity -> Repository<any>; CRUD GERCEK govdelerle yine uretilir
    //   (any tip altinda da derlenir). GenericRepository diye cozulmemis ref kalmaz.
    const orphan = storedNode(
      "Repository",
      {
        RepositoryName: "GhostRepository",
        Description: "Baglantisiz repo",
        EntityReference: "Phantom",
        IsCached: false,
        CustomQueries: [],
      },
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
    const { ctx } = ctxFor(orphan);
    const [file] = emitRepository(ctx.graph.byId(orphan.id)!, ctx);
    expect(file.content).toContain("async findById(id: string): Promise<any | null> {");
    expect(file.content).toContain("where: { id: id } as FindOptionsWhere<any>,");
    expect(file.content).toContain("async findAll(): Promise<any[]> {");
    expect(file.content).toContain("async save(entity: any): Promise<any> {");
    expect(file.content).toContain("async remove(id: string): Promise<void> {");
    expect(file.content).toContain("import { FindOptionsWhere, Repository } from \"typeorm\";");
    expect(file.content).not.toContain("GenericRepository");
    expect(file.surgicalMarkers).toBe(0);
  });

  it("#3 CRUD: CustomQuery ayni isimde ise o CRUD metodu ATLANIR (cift metot yok)", () => {
    // User kendi findById/save'ini CustomQuery olarak tanimlarsa CRUD metodu
    //   ATLANIR (kullanici niyeti kazanir; cift metot derlemeyi kirardi).
    const repo = storedNode(
      "Repository",
      {
        RepositoryName: "OverrideRepository",
        Description: "CRUD override",
        EntityReference: "User",
        IsCached: false,
        CustomQueries: [
          { QueryName: "findById", QueryType: "findOne", Parameters: [{ Name: "id", Type: "string" }], ReturnType: "User" },
          { QueryName: "save", QueryType: "custom", Parameters: [{ Name: "entity", Type: "User" }], ReturnType: "User" },
        ],
      },
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    const { ctx } = ctxFor(repo, USER_MODEL);
    const [file] = emitRepository(ctx.graph.byId(repo.id)!, ctx);
    // findById ve save CustomQuery (surgical) olarak gelir, CRUD versiyonu atlanir.
    expect(file.content).not.toContain("return this.repo.findOneBy({ id: id }");
    expect(file.content).not.toContain("return this.repo.save(entity);");
    expect(file.content).toContain(`throw new Error("NOT_IMPLEMENTED: OverrideRepository.findById");`);
    expect(file.content).toContain(`throw new Error("NOT_IMPLEMENTED: OverrideRepository.save");`);
    // Atlanmayan CRUD (findAll/remove) GERCEK govdeyle kalir.
    expect(file.content).toContain("return this.repo.find();");
    expect(file.content).toContain("await this.repo.delete(id);");
    // findById/save icin tek tanim (cakisma yok).
    expect(file.content.match(/async findById/g)?.length).toBe(1);
    expect(file.content.match(/async save/g)?.length).toBe(1);
  });

  it("#3 CRUD: Table entity (Model NONE) -> PK tipi kolon DataType'indan cozulur (INT id -> number)", () => {
    // PK alani/tipi entity'den cozulur: id INT -> number (findById/remove param tipi).
    const table = storedNode(
      "Table",
      {
        TableName: "counters",
        Description: "Sayaclar",
        Columns: [
          { Name: "id", DataType: "INT", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: true },
          { Name: "value", DataType: "INT", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
        ],
      },
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );
    const repo = storedNode(
      "Repository",
      {
        RepositoryName: "CounterRepository",
        Description: "Sayac erisimi",
        EntityReference: "counters",
        IsCached: false,
        CustomQueries: [],
      },
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    );
    const { ctx } = ctxFor(repo, table);
    const [file] = emitRepository(ctx.graph.byId(repo.id)!, ctx);
    // INT id -> number (UUID olsaydi string'di).
    expect(file.content).toContain("async findById(id: number): Promise<Counter | null> {");
    expect(file.content).toContain("async remove(id: number): Promise<void> {");
  });

  it("PK kolon adi 'Id' (buyuk) -> findById entity property'siyle HIZALI 'id' kullanir (tek-kaynak)", () => {
    // GERCEK BUG: graf PK'yi 'Id' (buyuk I) ile verir (to-be.json'daki tum Table'lar
    // boyle). entity-synthesis property'yi tsPropName ile 'id'ye normalize eder, ama
    // repository.resolvePrimaryKey ham 'Id'yi kullanirsa -> findById entity'de WITHOUT
    // kolona sorgu atar (runtime EntityPropertyNotFoundError; `as FindOptionsWhere` cast
    // bunu DERLEMEDE gizler). findById, entity'nin gercek property adiyla (tsPropName)
    // HIZALI olmali: { id: id }, { Id: id } NOT.
    const table = storedNode(
      "Table",
      {
        TableName: "widgets",
        Description: "Widget'lar",
        Columns: [
          { Name: "Id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false },
        ],
      },
      "a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1",
    );
    const repo = storedNode(
      "Repository",
      {
        RepositoryName: "WidgetRepository",
        Description: "Widget erisimi",
        EntityReference: "widgets",
        IsCached: false,
        CustomQueries: [],
      },
      "b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2",
    );
    const { ctx } = ctxFor(repo, table);
    const [file] = emitRepository(ctx.graph.byId(repo.id)!, ctx);
    expect(file.content).toContain("where: { id: id } as FindOptionsWhere<Widget>,");
    expect(file.content).not.toContain("{ Id: id }");
  });

  it("PK property adi 'Id' (Model) -> findById 'id' kullanir (tek-kaynak, Model yolu)", () => {
    const model = storedNode(
      "Model",
      {
        ClassName: "Gadget",
        Description: "Gadget entity",
        Properties: [{ Name: "Id", Type: "uuid" }],
        Methods: [],
      },
      "c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3",
    );
    const repo = storedNode(
      "Repository",
      {
        RepositoryName: "GadgetRepository",
        Description: "Gadget erisimi",
        EntityReference: "Gadget",
        IsCached: false,
        CustomQueries: [],
      },
      "d4d4d4d4-4444-4444-8444-d4d4d4d4d4d4",
    );
    const { ctx } = ctxFor(repo, model);
    const [file] = emitRepository(ctx.graph.byId(repo.id)!, ctx);
    expect(file.content).toContain("where: { id: id } as FindOptionsWhere<Gadget>,");
    expect(file.content).not.toContain("{ Id: id }");
  });

  it("EDGE-CASE: EntityReference Table (Model NONE) -> SENTETIK entity import edilir, Repository<Entity> (boot eder)", () => {
    const table = storedNode(
      "Table",
      {
        TableName: "audit_logs",
        Description: "Denetim kayitlari",
        Columns: [
          {
            Name: "id",
            DataType: "UUID",
            IsPrimaryKey: true,
            IsNotNull: true,
            IsUnique: true,
            AutoIncrement: false,
          },
        ],
      },
      "99999999-9999-4999-8999-999999999999",
    );
    const repo = storedNode(
      "Repository",
      {
        RepositoryName: "AuditRepository",
        Description: "Denetim erisimi",
        EntityReference: "audit_logs",
        IsCached: false,
        CustomQueries: [],
      },
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    const { ctx } = ctxFor(repo, table);
    const [file] = emitRepository(ctx.graph.byId(repo.id)!, ctx);
    // Model yok -> Table'dan SENTEZLENEN entity (AuditLog). @InjectRepository(Entity)
    // /Repository<Entity>/forFeature hepsi AYNI sinifa baglanir -> uygulama BOOT BOOTS.
    // (string token + Repository<any> ARTIK URETILMEZ; bootta DI hatasi verirdi.)
    expect(file.content).toContain("@InjectRepository(AuditLog)");
    expect(file.content).toContain("private readonly repo: Repository<AuditLog>,");
    expect(file.content).not.toContain("Repository<any>");
    // Sentetik entity import'u (audit_logs -> tekil "audit-log" entity dosyasi).
    expect(file.content).toContain("entities/audit-log.entity");
    expect(file.content).not.toContain("// TODO: EntityReference");
  });
});
