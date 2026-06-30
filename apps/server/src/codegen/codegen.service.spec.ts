import { describe, it, expect } from "vitest";
import { CodegenService, applySurgicalFills } from "./codegen.service";
import type { GeneratedFile } from "./types";
import { CODEGEN_VERSION } from "./codegen.version";
import { buildCodeGraph } from "./ir";
import { EMITTER_REGISTRY } from "./emitters/nestjs";
import type { StoredNode } from "../nodes/nodes.repository";
import type { StoredEdge } from "../edges/edges.repository";
import type { NodeKind } from "../nodes/schemas";
import type { EdgeKind } from "../edges/schemas/edge.schema";
import type { GeneratedProject } from "./types";

/* ────────────────────────────────────────────────────────────────────────
 * codegen.service.spec.ts — entegrasyon testi.
 *
 * Gercekci 9-node'luk fixture uzerinden TUM montaj zincirini dogrular:
 *   Module(UsersModule) ── ExposedServices: [UsersService]
 *   UsersController ─CALLS─> UsersService ─CALLS─> UserRepository ─WRITES─> users(Table)
 *   + CreateUserDto + UserDto + UserRole(Enum) + UserNotFoundException + User(Model)
 *
 * Assertion'lar:
 *   - dogru dosyalar uretildi (feature klasoru = "users")
 *   - Controller->Service DI'i CALLS edge'inden geldi (Controller semasinda ref NONE)
 *   - Service DI'i = Dependencies UNION CALLS
 *   - surgical marker sayisi > 0
 *   - import'lar cozumlendi (goreli yollar)
 *   - DETERMINISM: same graph twice -> byte-identical JSON
 * ──────────────────────────────────────────────────────────────────────── */

const PROJECT_ID = "00000000-0000-4000-8000-000000000000";
const TAB_ID = "11111111-1111-4111-8111-111111111111";

let seq = 0;
/** Deterministik UUID uretici (test ici). */
function uid(): string {
  seq += 1;
  const h = seq.toString(16).padStart(12, "0");
  return `aaaaaaaa-aaaa-4aaa-8aaa-${h}`;
}

function node(type: NodeKind, properties: Record<string, unknown>): StoredNode {
  return {
    id: uid(),
    type,
    projectId: PROJECT_ID,
    positionX: 0,
    positionY: 0,
    homeTabId: TAB_ID,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function edge(kind: EdgeKind, source: StoredNode, target: StoredNode): StoredEdge {
  return {
    id: uid(),
    projectId: PROJECT_ID,
    sourceNodeId: source.id,
    targetNodeId: target.id,
    kind,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: false },
  };
}

/* ── Fixture insasi ──────────────────────────────────────────────────────── */
function buildFixture(): { nodes: StoredNode[]; edges: StoredEdge[] } {
  const usersTable = node("Table", {
    TableName: "users",
    Description: "User table",
    Columns: [
      { Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false },
      { Name: "email", DataType: "VARCHAR", Length: 255, IsPrimaryKey: false, IsNotNull: true, IsUnique: true, AutoIncrement: false },
      { Name: "role", DataType: "ENUM", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false, EnumRef: "UserRole" },
    ],
    ForeignKeys: [],
    UniqueConstraints: [],
    CheckConstraints: [],
    Indexes: [],
  });

  const userRole = node("Enum", {
    Name: "UserRole",
    Description: "User rolu",
    BackingType: "string",
    Values: [{ Key: "ADMIN" }, { Key: "MEMBER" }],
  });

  const userModel = node("Model", {
    ClassName: "User",
    Description: "User varligi",
    TableRef: "users",
    Properties: [
      { Name: "id", Type: "string", IsNullable: false, IsCollection: false },
      { Name: "email", Type: "string", IsNullable: false, IsCollection: false },
    ],
    Methods: [],
  });

  const createUserDto = node("DTO", {
    Name: "CreateUserDto",
    Description: "User olusturma girdisi",
    Fields: [
      { Name: "email", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "Email" }] },
      { Name: "role", DataType: "UserRole", IsRequired: true, IsArray: false, ValidationRules: [], EnumRef: "UserRole" },
    ],
  });

  const userDto = node("DTO", {
    Name: "UserDto",
    Description: "User yaniti",
    Fields: [
      { Name: "id", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [] },
      { Name: "email", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "Email" }] },
    ],
  });

  const notFoundExc = node("Exception", {
    ExceptionName: "UserNotFoundException",
    Description: "User bulunamadi",
    HttpStatusCode: 404,
    LogSeverity: "Warning",
    ErrorCode: "ERR_USER_NOT_FOUND",
  });

  const userRepository = node("Repository", {
    RepositoryName: "UserRepository",
    Description: "User veri erisimi",
    EntityReference: "User",
    IsCached: false,
    CustomQueries: [
      { QueryName: "findByEmail", QueryType: "findOne", Parameters: [{ Name: "email", Type: "string" }], ReturnType: "User" },
    ],
  });

  const usersService = node("Service", {
    ServiceName: "UsersService",
    Description: "User is mantigi",
    IsTransactionScoped: true,
    Methods: [
      {
        MethodName: "create",
        Visibility: "public",
        Parameters: [{ Name: "dto", Type: "CreateUserDto", Optional: false, DtoRef: "CreateUserDto" }],
        ReturnType: "UserDto",
        ReturnDtoRef: "UserDto",
        IsAsync: true,
        Throws: ["UserNotFoundException"],
      },
    ],
    Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }],
  });

  const usersController = node("Controller", {
    ControllerName: "UsersController",
    Description: "User HTTP arayuzu",
    BaseRoute: "users",
    Version: "v1",
    Endpoints: [
      {
        HttpMethod: "POST",
        Route: "/",
        RequestDTORef: "CreateUserDto",
        ResponseDTORef: "UserDto",
        RequiresAuth: true,
        RequiredRoles: [],
        PathParams: [],
        QueryParams: [],
        StatusCodes: [{ Code: 201 }],
        MiddlewareRefs: [],
      },
      {
        HttpMethod: "GET",
        Route: "/:id",
        ResponseDTORef: "UserDto",
        RequiresAuth: true,
        RequiredRoles: [],
        PathParams: [{ Name: "id", Type: "string" }],
        QueryParams: [],
        StatusCodes: [{ Code: 200 }],
        MiddlewareRefs: [],
      },
    ],
  });

  const usersModule = node("Module", {
    ModuleName: "UsersModule",
    Description: "User modulu",
    StrictBoundaries: true,
    ExposedServices: ["UsersService"],
    Dependencies: [],
  });

  const nodes = [
    usersTable,
    userRole,
    userModel,
    createUserDto,
    userDto,
    notFoundExc,
    userRepository,
    usersService,
    usersController,
    usersModule,
  ];

  const edges = [
    // CRITICAL: Controller->Service yalniz CALLS edge'inden gelir.
    edge("CALLS", usersController, usersService),
    // Service -> Repository (Dependencies + CALLS birlesimi test edilir).
    edge("CALLS", usersService, userRepository),
    // Repository -> Table (WRITES).
    edge("WRITES", userRepository, usersTable),
    // Module -> Service (USES) — moduleOf icin ek bag.
    edge("USES", usersModule, usersService),
    // Service -> Exception (THROWS).
    edge("THROWS", usersService, notFoundExc),
  ];

  return { nodes, edges };
}

function generate(): GeneratedProject {
  const { nodes, edges } = buildFixture();
  const graph = buildCodeGraph(nodes, edges);
  const service = new CodegenService(null as never, null as never, null as never, null as never);
  return service.assemble(graph, "nestjs");
}

describe("CodegenService (orchestrator entegrasyon)", () => {
  const project = generate();
  const fileByPath = new Map(project.files.map((f) => [f.path, f]));
  const path = (p: string) => {
    const f = fileByPath.get(p);
    if (!f) throw new Error(`Expected file missing: ${p}\nGenerated:\n${[...fileByPath.keys()].join("\n")}`);
    return f;
  };

  it("dogru cekirdek dosyalari uretildi (users feature klasoru, idiomatik isimler)", () => {
    const paths = [...fileByPath.keys()];
    // Feature/TS dosyalari montajda "src/" altina toplanir (scaffold + tsconfig
    // include ile tek agac). SQL migration'lari KOKTE kalir (derlenmez).
    // ARCHITECTURE-FARKINDA: dosya adlari rol son-ekini TEKRARLAMAZ (users.controller.ts,
    // user.repository.ts), feature basina TEK module (users.module.ts).
    expect(paths).toContain("src/users/users.module.ts");
    expect(paths).toContain("src/users/users.controller.ts");
    expect(paths).toContain("src/users/users.service.ts");
    expect(paths).toContain("src/users/user.repository.ts");
    // Model entity bagli Table ("users") ile ayni feature'da (DI co-location).
    expect(paths).toContain("src/users/entities/user.entity.ts");
    // DTO'lar onlari tuketen Controller/Service'in feature'inda (users/dto).
    expect(paths).toContain("src/users/dto/create-user.dto.ts");
    expect(paths).toContain("src/users/dto/user.dto.ts");
    // Exception THROWS eden UsersService ile ayni feature'da (users/exceptions).
    expect(paths).toContain("src/users/exceptions/user-not-found.exception.ts");
    // Enum (paylasimli kabul edilir) -> common/enums.
    expect(paths).toContain("src/common/enums/user-role.enum.ts");
    // TableName "users" fiziksel ad sayilir (cogullanmaz) -> "001_create_users.sql".
    expect(paths).toContain("migrations/001_create_users.sql");
  });

  it("scaffold (proje-genel) dosyalari uretildi", () => {
    const paths = [...fileByPath.keys()];
    expect(paths).toContain("package.json");
    expect(paths).toContain("tsconfig.json");
    expect(paths).toContain("tsconfig.build.json");
    expect(paths).toContain("nest-cli.json");
    expect(paths).toContain("src/main.ts");
    expect(paths).toContain("src/app.module.ts");
    // H3/H1: cekirdek altyapi + global filter.
    expect(paths).toContain("src/core/core.module.ts");
    expect(paths).toContain("src/shared/filters/all-exceptions.filter.ts");
    // H4: .env.example KOKTE (src/ altinda degil).
    expect(paths).toContain(".env.example");
    expect(paths).not.toContain("src/.env.example");
    // H5: TypeORM CLI data-source.
    expect(paths).toContain("src/data-source.ts");
    // H6: test/CI iskeleti.
    expect(paths).toContain("test/app.e2e-spec.ts");
    expect(paths).toContain(".gitignore");
    expect(paths).toContain("README.md");
  });

  it("H5: SQL migration basina calistirilabilir TypeORM TS migration uretildi", () => {
    const paths = [...fileByPath.keys()];
    // users tablosu -> migrations/001_create_users.sql (ham referans) +
    //   src/migrations/<ts>-CreateUsers.ts (TypeORM gelenegi: <timestamp>-<Name>.ts).
    expect(paths).toContain("migrations/001_create_users.sql");
    const tsMig = paths.find((p) => /^src\/migrations\/\d{13}-Create\w+\.ts$/.test(p));
    expect(tsMig).toBeDefined();
    const mig = path(tsMig!).content;
    expect(mig).toContain("implements MigrationInterface");
    expect(mig).toContain("public async up(queryRunner: QueryRunner)");
    expect(mig).toContain("public async down(queryRunner: QueryRunner)");
    expect(mig).toContain('CREATE TABLE "users"');
    expect(mig).toContain('DROP TABLE IF EXISTS "users" CASCADE');
    // TypeORM, sinif adinin SON 13 hanesini timestamp olarak parseInt eder
    //   (MigrationExecutor: name.substr(-13)); salt "001" soneki NaN -> CLI firlatir.
    //   Sinif adi 13-haneli zaman damgasiyla bitmeli ve parseInt edilebilmeli.
    const className = mig.match(/export class (\w+) implements MigrationInterface/)?.[1];
    expect(className).toBeDefined();
    const last13 = className!.slice(-13);
    expect(last13).toMatch(/^\d{13}$/);
    expect(Number.isNaN(Number.parseInt(last13, 10))).toBe(false);
  });

  it("DTO'lar uretildi (RequestDTORef/ResponseDTORef cozulebilir)", () => {
    const paths = [...fileByPath.keys()];
    expect(paths.some((p) => p.endsWith("create-user.dto.ts"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/user.dto.ts"))).toBe(true);
  });

  it("Controller->Service DI'i CALLS edge'inden geldi (semada ref yok)", () => {
    const controller = path("src/users/users.controller.ts").content;
    // constructor injection UsersService uzerinden
    expect(controller).toContain("constructor(");
    expect(controller).toContain("private readonly usersService: UsersService");
    // UsersService import'u goreli yoldan cozuldu (ayni feature klasoru)
    expect(controller).toMatch(/import \{ UsersService \} from "\.\/users\.service"/);
  });

  it("Controller route Version oneki + endpoint metotlari + auth guard", () => {
    const controller = path("src/users/users.controller.ts").content;
    expect(controller).toContain('@Controller("v1/users")');
    expect(controller).toContain("@Post()");
    expect(controller).toContain('@Get(":id")');
    expect(controller).toContain("@HttpCode(201)");
    expect(controller).toContain("@UseGuards(AuthGuard)");
    // RequestDTORef cozuldu -> @Body() dto: CreateUserDto
    expect(controller).toContain("@Body() dto: CreateUserDto");
  });

  it("Service DI'i = Dependencies UNION CALLS (UserRepository tek kez)", () => {
    const svc = path("src/users/users.service.ts").content;
    expect(svc).toContain("@Injectable()");
    expect(svc).toContain("constructor(");
    // Repository hem Dependencies'te hem CALLS edge'inde -> tek injection (dedup)
    const repoInjections = svc.match(/userRepository: UserRepository/g) ?? [];
    expect(repoInjections.length).toBe(1);
    // import cozuldu (ayni feature)
    expect(svc).toMatch(/from "\.\/user\.repository"/);
  });

  it("Repository @InjectRepository + entity import cozuldu", () => {
    const repo = path("src/users/user.repository.ts").content;
    expect(repo).toContain("@Injectable()");
    // EntityReference -> User Model entity import'u (entity ayni feature'da -> ./entities).
    expect(repo).toMatch(/from "\.\/entities\/user\.entity"/);
    // CustomQuery -> async imza + surgical marker
    expect(repo).toContain("findByEmail");
    expect(repo).toContain("@solarch:surgical");
  });

  it("Table migration Postgres DDL + ENUM kolon", () => {
    const sql = path("migrations/001_create_users.sql");
    expect(sql.language).toBe("sql");
    expect(sql.content).toContain('CREATE TABLE "users"');
    // Entity @Entity adi ile migration tablo adi AYNI (ayrismaz).
    const entity = path("src/users/entities/user.entity.ts").content;
    expect(entity).toContain('@Entity("users")');
    expect(sql.surgicalMarkers).toBe(0);
  });

  it("Feature module SYNTHESIZED: @Module dekoratoru + DI listeleri (repository kayitli)", () => {
    const mod = path("src/users/users.module.ts").content;
    expect(mod).toContain("@Module(");
    expect(mod).toContain("controllers: [UsersController],");
    // providers repository'yi de icerir -> DI tam, uygulama BOOT BOOTS.
    expect(mod).toContain("providers: [UsersService, UserRepository],");
    expect(mod).toContain("TypeOrmModule.forFeature([User])");
    expect(mod).toContain("export class UsersModule {}");
  });

  it("app.module feature modulunu import eder (ham controller/provider NOT)", () => {
    const app = path("src/app.module.ts").content;
    expect(app).toContain('import { UsersModule } from "./users/users.module";');
    expect(app).toContain("    UsersModule,");
    // Ham controller/provider app.module'e GIRMEZ.
    expect(app).not.toContain("controllers:");
    expect(app).not.toContain("providers:");
    expect(app).not.toContain("UsersController");
  });

  it("surgical marker sayisi > 0 (Service/Controller/Repository govdeleri)", () => {
    expect(project.summary.surgicalMarkerCount).toBeGreaterThan(0);
    const total = project.files.reduce((s, f) => s + f.surgicalMarkers, 0);
    expect(total).toBe(project.summary.surgicalMarkerCount);
  });

  it("summary: fileCount/nodeCount dogru, skippedKinds bos (12 tip yok)", () => {
    expect(project.summary.nodeCount).toBe(10);
    expect(project.summary.fileCount).toBe(project.files.length);
    // Fixture'da desteklenmeyen 12 tip NONE -> skippedKinds bos.
    expect(project.summary.skippedKinds).toEqual({});
  });

  it("summary.version = CODEGEN_VERSION = 6 (cikti kendi nesli ile etiketlenir)", () => {
    expect(project.summary.version).toBe(CODEGEN_VERSION);
    expect(CODEGEN_VERSION).toBe(6);
  });

  it("SURGICAL_PLAN.md uretildi (proje KOKUNDE, markdown, Ingilizce prompt)", () => {
    const plan = path("SURGICAL_PLAN.md");
    expect(plan.language).toBe("markdown");
    // Proje KOKUNDE (src/ altinda NOT).
    expect([...fileByPath.keys()]).toContain("SURGICAL_PLAN.md");
    expect([...fileByPath.keys()]).not.toContain("src/SURGICAL_PLAN.md");
    // Iki bolum + kapanis talimati.
    expect(plan.content).toContain("## 1. Codebase introduction");
    expect(plan.content).toContain("## 2. Surgical implementation plan");
    expect(plan.content).toContain("## Instructions");
    // Codebase tanitimi: NestJS + Solarch.
    expect(plan.content).toContain("NestJS");
    expect(plan.content).toContain("Solarch");
    // Feature listesi graph'tan (fixture'da "users" feature'i var).
    expect(plan.content).toContain("`users`");
    // Plan, uretilen marker'lari gorur: UsersService.create govdesi listelenir.
    expect(plan.content).toContain("src/users/users.service.ts");
    expect(plan.content).toContain("Implement:");
    // MD'nin KENDI marker'i NONE (plan metnidir) -> surgicalMarkers 0.
    expect(plan.surgicalMarkers).toBe(0);
  });

  it("dosyalar path'e gore sirali (determinizm)", () => {
    const paths = project.files.map((f) => f.path);
    const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(paths).toEqual(sorted);
  });

  it("her dosya tek '\\n' ile biter", () => {
    for (const f of project.files) {
      expect(f.content.endsWith("\n")).toBe(true);
      expect(f.content.endsWith("\n\n")).toBe(false);
    }
  });

  it("DETERMINISM: same graph twice -> byte-identical JSON", () => {
    const { nodes, edges } = buildFixture();
    const graph = buildCodeGraph(nodes, edges);
    const service = new CodegenService(null as never, null as never, null as never, null as never);
    const a = service.assemble(graph, "nestjs");
    const b = service.assemble(graph, "nestjs");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("SIRA-DEGISMEZLIGI: girdi node/edge sirasi ters cevrilince cikti AYNI", () => {
    // Gercek nondeterminizm kaynagi DB'nin SIRASIZ list()'idir; IR her seyi
    // yeniden siralar. Bu test, siralamanin TAM (stabil tiebreak'li) oldugunu
    // KANITLAR: ayni node'lar ters sirada verildiginde cikti birebir ayni kalmali.
    const { nodes, edges } = buildFixture();
    const service = new CodegenService(null as never, null as never, null as never, null as never);

    const forward = service.assemble(buildCodeGraph(nodes, edges), "nestjs");
    const reversed = service.assemble(
      buildCodeGraph([...nodes].reverse(), [...edges].reverse()),
      "nestjs",
    );
    expect(JSON.stringify(reversed.files)).toBe(JSON.stringify(forward.files));
  });

  it("SIRA-DEGISMEZLIGI: rastgele karistirilmis girdi -> byte-identical cikti", () => {
    const { nodes, edges } = buildFixture();
    const service = new CodegenService(null as never, null as never, null as never, null as never);
    const base = service.assemble(buildCodeGraph(nodes, edges), "nestjs");

    // Deterministik (seed'siz ama sabit) bir permutasyon: index'e gore dondur.
    const rotate = <T>(arr: T[], by: number): T[] => {
      const k = ((by % arr.length) + arr.length) % arr.length;
      return [...arr.slice(k), ...arr.slice(0, k)];
    };
    for (const by of [1, 3, 5, 7]) {
      const shuffled = service.assemble(
        buildCodeGraph(rotate(nodes, by), rotate(edges, by)),
        "nestjs",
      );
      expect(JSON.stringify(shuffled.files)).toBe(JSON.stringify(base.files));
    }
  });

  it("auth guard + roles decorator stub'lari uretildi (controller import'lari cozulur)", () => {
    // Controller RequiresAuth=true + RequiredRoles olan endpoint kullanir;
    // import edilen stub dosyalar montajda gercekten uretilmeli (TS2307 onlenir).
    const paths = [...fileByPath.keys()];
    // shared/ standardizasyonu: guard/decorator artik shared/ altinda (common/ degil).
    expect(paths).toContain("src/shared/guards/auth.guard.ts");
    const guard = path("src/shared/guards/auth.guard.ts").content;
    expect(guard).toContain("export class AuthGuard");
    expect(guard).toContain("implements CanActivate");
  });
});

describe("CodegenService.generate — secret redaksiyonu (defense-in-depth)", () => {
  it("nodes.list redaksiyon yapmasa da codegen sinirinda secret IR'a girmez", async () => {
    // Legacy: write-guard oncesi yazilmis secret EnvironmentVariable (duz-metin
    // DefaultValue). Repository.list redaksiyon yapmaz; generate() sinirda redakte
    // etmeli, boylece koruma yapisaldir (her emitter'in IsSecret kontrolune bagli degil).
    const PROJECT = "00000000-0000-4000-8000-00000000abcd";
    const secretNode: StoredNode = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000abc",
      type: "EnvironmentVariable",
      projectId: PROJECT,
      positionX: 0,
      positionY: 0,
      homeTabId: TAB_ID,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      version: 1,
      properties: {
        Key: "JWT_SECRET",
        Description: "imza anahtari",
        DataType: "String",
        IsSecret: true,
        Environment: ["Prod"],
        DefaultValue: "super-secret-plaintext-value",
        IsRequired: true,
      },
    };

    let observed: StoredNode[] | null = null;
    const projects = { exists: async () => true } as never;
    const nodes = {
      list: async () => [secretNode], // RAW (redaksiyonsuz) — repository davranisi.
    } as never;
    const edges = { list: async () => [] } as never;
    const surgicalFills = { getAllForProject: async () => [] } as never;

    const service = new CodegenService(projects, nodes, edges, surgicalFills);
    // assemble'i sarmalayip generate'in ona verdigi graph'i yakala.
    const origAssemble = service.assemble.bind(service);
    service.assemble = ((graph, target) => {
      observed = graph.nodes.map((n) => ({ ...n }));
      return origAssemble(graph, target);
    }) as typeof service.assemble;

    const project = await service.generate(PROJECT, "nestjs");

    // Duz-metin secret HICBIR uretilen dosyada gorunmemeli.
    for (const f of project.files) {
      expect(f.content).not.toContain("super-secret-plaintext-value");
    }
    // IR'a giren node'un DefaultValue'su redakte edilmis olmali (bos).
    expect(observed).not.toBeNull();
    const envNode = observed!.find((n) => n.type === "EnvironmentVariable");
    expect((envNode!.properties as Record<string, unknown>).DefaultValue).toBe("");
  });
});

describe("CodegenService — mimari altyapi tam uretim (Cache/Worker artik supported)", () => {
  it("Cache + Worker -> GERCEK kod (stub NOT) + skippedKinds bos", () => {
    const cache = node("Cache", {
      CacheName: "SessionCache",
      Description: "Session cache",
      KeyPattern: "session:{id}",
      TTL_Seconds: 3600,
      Engine: "Redis",
      EvictionPolicy: "LRU",
    });
    const worker = node("Worker", {
      WorkerName: "EmailWorker",
      Description: "E-posta kuyrugu iscisi",
      Schedule: "0 * * * *",
      TaskToExecute: "Send pending emails",
    });
    const graph = buildCodeGraph([cache, worker], []);
    const service = new CodegenService(null as never, null as never, null as never, null as never);
    const project = service.assemble(graph, "nestjs");

    // Artik GERCEK kod uretilir; .stub.ts NONE.
    expect(project.files.some((f) => f.path.endsWith(".cache.ts"))).toBe(true);
    expect(project.files.some((f) => f.path.endsWith(".worker.ts"))).toBe(true);
    expect(project.files.some((f) => f.path.endsWith(".stub.ts"))).toBe(false);
    // Cache/Worker artik supported -> skippedKinds bos.
    expect(project.summary.skippedKinds).toEqual({});
    // Worker @Cron handler'i surgical marker tasir.
    expect(project.summary.surgicalMarkerCount).toBeGreaterThan(0);

    // nodeFiles haritasi: her node kendi dosyasina eslenir.
    expect(project.nodeFiles[cache.id]?.some((p) => p.endsWith(".cache.ts"))).toBe(true);
    expect(project.nodeFiles[worker.id]?.some((p) => p.endsWith(".worker.ts"))).toBe(true);

    // H3: root forRoot/register artik CoreModule'de (app.module degil).
    const core = project.files.find((f) => f.path === "src/core/core.module.ts")!.content;
    // Worker -> ScheduleModule.forRoot() (@Cron ateslensin).
    expect(core).toContain("ScheduleModule.forRoot()");
    // Cache -> CacheModule app root'a kaydedilir.
    expect(core).toContain("CacheModule.register({ isGlobal: true })");
    // package.json gerekli deps'i aldi (graph-farkinda).
    const pkg = project.files.find((f) => f.path === "package.json")!.content;
    expect(pkg).toContain("@nestjs/cache-manager");
    expect(pkg).toContain("@nestjs/schedule");
  });

  it("EnvironmentVariable -> .stub.ts URETILMEZ (config; tek temsil .env.example), skippedKinds'e sayilir", () => {
    const env = node("EnvironmentVariable", {
      Key: "DATABASE_URL",
      Description: "DB baglantisi",
      DataType: "String",
      IsSecret: false,
      Environment: ["Prod"],
      IsRequired: true,
    });
    const graph = buildCodeGraph([env], []);
    const service = new CodegenService(null as never, null as never, null as never, null as never);
    const project = service.assemble(graph, "nestjs");

    // Bir ortam degiskeni kod modulu NOT -> anlamsiz `export class XStub {}` uretilmez.
    expect(project.files.some((f) => f.path.includes("environment-variable"))).toBe(false);
    expect(project.files.some((f) => f.path.endsWith(".stub.ts"))).toBe(false);
    // Tek temsili .env.example (H4: KOKTE).
    const envExample = project.files.find((f) => f.path === ".env.example");
    expect(envExample?.content).toContain("DATABASE_URL");
    // Kayitsiz kind -> skippedKinds'e sayilir (sessizce dusmez).
    expect(project.summary.skippedKinds).toEqual({ EnvironmentVariable: 1 });
  });
});

describe("CodegenService — fault-isolation (M5: bozuk node TUM codegen'i dusurmez)", () => {
  it("emitter PATLARSA o node skippedKinds'e sayilir, geri kalan graph uretilir", () => {
    // Cache emitter'i (supported) tek bir node'da patlatilir. Beklenen: Cache
    //   dosyasi URETILMEZ + skippedKinds.Cache=1; ama Worker (saglam) emit edilir
    //   ve scaffold/feature montaji kesilmez. Try/catch yoksa assemble TUMUYLE
    //   throw eder ve hicbir dosya cikmazdi.
    const cache = node("Cache", {
      CacheName: "SessionCache",
      Description: "x",
      KeyPattern: "session:{id}",
      TTL_Seconds: 3600,
      Engine: "Redis",
    });
    const worker = node("Worker", {
      WorkerName: "EmailWorker",
      Description: "x",
      Schedule: "0 * * * *",
      TaskToExecute: "Send pending items",
    });
    const graph = buildCodeGraph([cache, worker], []);
    const service = new CodegenService(null as never, null as never, null as never, null as never);

    // Cache emitter'ini GECICI olarak patlat (gercek "emitter undefined alana
    //   patlar" senaryosunu simule eder), sonra mutlaka geri yukle.
    const entry = EMITTER_REGISTRY.Cache!;
    const original = entry.emit;
    entry.emit = () => {
      throw new TypeError("Cannot read properties of undefined (simulated)");
    };
    let project: GeneratedProject;
    try {
      project = service.assemble(graph, "nestjs");
    } finally {
      entry.emit = original;
    }

    // Bozuk Cache atlandi: dosya NONE + skippedKinds'e sayildi (sessizce dusmedi).
    expect(project.files.some((f) => f.path.endsWith(".cache.ts"))).toBe(false);
    expect(project.summary.skippedKinds).toEqual({ Cache: 1 });

    // Saglam Worker emit edilmeye devam etti (codegen dusmedi).
    expect(project.files.some((f) => f.path.endsWith(".worker.ts"))).toBe(true);
    // Scaffold montaji da kesilmedi.
    expect(project.files.some((f) => f.path === "src/main.ts")).toBe(true);
    expect(project.files.some((f) => f.path === "src/app.module.ts")).toBe(true);
  });

  it("DETERMINISM: ayni bozuk node iki kez -> byte-identical cikti (hangi node patlar sabittir)", () => {
    const cache = node("Cache", { CacheName: "C", Description: "x" });
    const worker = node("Worker", { WorkerName: "W", Description: "x", Schedule: "0 * * * *", TaskToExecute: "t" });
    const service = new CodegenService(null as never, null as never, null as never, null as never);
    const entry = EMITTER_REGISTRY.Cache!;
    const original = entry.emit;
    entry.emit = () => {
      throw new Error("boom");
    };
    try {
      const a = service.assemble(buildCodeGraph([cache, worker], []), "nestjs");
      const b = service.assemble(buildCodeGraph([cache, worker], []), "nestjs");
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    } finally {
      entry.emit = original;
    }
  });

  it("adi WITHOUT (name-property string degil/bos) bozuk node atlanir + sayilir, GARBAGE uretmez", () => {
    // Gercek bozuk girdi: ServiceName bir SAYI, Methods bir DIZI NOT. ir.toCodeNode
    //   name'i ""e zorlar; orchestrator bos-adli node'u atlar. Emitter cagrilmadan
    //   skippedKinds'e sayilir -> gecersiz "export class { }" + "undefined()" GARBAGE
    //   CIKMAZ; saglam node uretilmeye devam eder (feature-inference de patlamaz).
    const broken = node("Service", { ServiceName: 12345, Methods: "not-an-array", Dependencies: null });
    const good = node("Service", {
      ServiceName: "GoodService",
      Description: "ok",
      Methods: [{ MethodName: "ok", Parameters: [], ReturnType: "void", IsAsync: true }],
      Dependencies: [],
    });
    const service = new CodegenService(null as never, null as never, null as never, null as never);
    const project = service.assemble(buildCodeGraph([broken, good], []), "nestjs");

    // Bozuk node skippedKinds'e sayildi; hicbir dosya uretmedi.
    expect(project.summary.skippedKinds).toEqual({ Service: 1 });
    expect(project.nodeFiles[broken.id]).toBeUndefined();
    // GARBAGE yok: bos sinif adi ya da "undefined()" metodu iceren dosya uretilmemeli.
    const tsContent = project.files.filter((f) => f.language === "typescript").map((f) => f.content).join("\n");
    expect(tsContent).not.toMatch(/export class\s+\{/);
    expect(tsContent).not.toContain("undefined(): void");
    // Saglam servis hâlâ uretildi (codegen dusmedi).
    expect(project.files.some((f) => f.path === "src/good/good.service.ts")).toBe(true);
  });
});

describe("CodegenService — warnings ciktiya tasinir (M4: dongusel module import)", () => {
  it("karsilikli feature CALLS (A<->B): dongu kirilir + project.warnings'e uyari yazilir", () => {
    // alpha <-> beta servisleri karsilikli CALLS -> module import dongusu. Orchestrator
    //   bir geri-kenari forwardRef ile kirar (kenar KORUNUR, lazy emit) ve bunu
    //   project.warnings'te BILDIRIR; eskiden uyari yalniz graph icinde kalip kaybolurdu.
    const alphaCtrl = node("Controller", { ControllerName: "AlphaController", Description: "a", BaseRoute: "alpha", Endpoints: [] });
    const alphaSvc = node("Service", { ServiceName: "AlphaService", Description: "a", Dependencies: [], Methods: [] });
    const betaCtrl = node("Controller", { ControllerName: "BetaController", Description: "b", BaseRoute: "beta", Endpoints: [] });
    const betaSvc = node("Service", { ServiceName: "BetaService", Description: "b", Dependencies: [], Methods: [] });
    const edges = [
      edge("CALLS", alphaCtrl, alphaSvc),
      edge("CALLS", betaCtrl, betaSvc),
      edge("CALLS", alphaSvc, betaSvc), // alpha -> beta
      edge("CALLS", betaSvc, alphaSvc), // beta -> alpha (karsilikli)
    ];
    const service = new CodegenService(null as never, null as never, null as never, null as never);
    const project = service.assemble(buildCodeGraph([alphaCtrl, alphaSvc, betaCtrl, betaSvc], edges), "nestjs");

    expect(project.warnings).toHaveLength(1);
    expect(project.warnings[0]).toContain("AlphaModule");
    expect(project.warnings[0]).toContain("BetaModule");
    expect(project.warnings[0]).toContain("forwardRef");
  });

  it("dongu yoksa project.warnings bos dizidir", () => {
    const ctrl = node("Controller", { ControllerName: "SoloController", Description: "x", BaseRoute: "solo", Endpoints: [] });
    const svc = node("Service", { ServiceName: "SoloService", Description: "x", Dependencies: [], Methods: [] });
    const service = new CodegenService(null as never, null as never, null as never, null as never);
    const project = service.assemble(buildCodeGraph([ctrl, svc], [edge("CALLS", ctrl, svc)]), "nestjs");
    expect(project.warnings).toEqual([]);
  });
});

describe("CodegenService — module wiring EMIT dogrulamasi (Bug 1 + Bug 2 uctan-uca)", () => {
  /** Uretilen dosyanin icerigini path-son-eki ile bulur. */
  function fileEndingWith(project: GeneratedProject, suffix: string): GeneratedFile {
    const f = project.files.find((x) => x.path.endsWith(suffix));
    if (!f) throw new Error(`not generated: ${suffix} (existing: ${project.files.map((x) => x.path).join(", ")})`);
    return f;
  }

  it("Bug 1: 3'lu dongude uretilen module forwardRef(() => XModule) EMIT eder", () => {
    const authCtrl = node("Controller", { ControllerName: "AuthController", Description: "x", BaseRoute: "auth", Endpoints: [] });
    const authSvc = node("Service", { ServiceName: "AuthService", Description: "x", Dependencies: [], Methods: [] });
    const chatCtrl = node("Controller", { ControllerName: "ChatController", Description: "x", BaseRoute: "chat", Endpoints: [] });
    const chatSvc = node("Service", { ServiceName: "ChatService", Description: "x", Dependencies: [], Methods: [] });
    const msgCtrl = node("Controller", { ControllerName: "MessagingController", Description: "x", BaseRoute: "messaging", Endpoints: [] });
    const msgSvc = node("Service", { ServiceName: "MessagingService", Description: "x", Dependencies: [], Methods: [] });
    const edges = [
      edge("CALLS", authCtrl, authSvc),
      edge("CALLS", chatCtrl, chatSvc),
      edge("CALLS", msgCtrl, msgSvc),
      edge("CALLS", authSvc, chatSvc),
      edge("CALLS", chatSvc, msgSvc),
      edge("CALLS", msgSvc, authSvc),
    ];
    const service = new CodegenService(null as never, null as never, null as never, null as never);
    const project = service.assemble(buildCodeGraph([authCtrl, authSvc, chatCtrl, chatSvc, msgCtrl, msgSvc], edges), "nestjs");

    // messaging->auth geri-kenari forwardRef olur (to="auth" en kucuk).
    const msgModule = fileEndingWith(project, "messaging/messaging.module.ts");
    expect(msgModule.content).toContain("forwardRef(() => AuthModule)");
    expect(msgModule.content).toContain('import { Module, forwardRef } from "@nestjs/common"');
    // Eager kenarlar duz emit edilir (forwardRef NONE).
    expect(fileEndingWith(project, "auth/auth.module.ts").content).toContain("imports: [ChatModule]");
    expect(fileEndingWith(project, "chat/chat.module.ts").content).toContain("imports: [MessagingModule]");
  });

  it("Bug 2: property-dep'li cross-feature Repository → tuketici module sahibi import eder", () => {
    const userCtrl = node("Controller", { ControllerName: "UserController", Description: "x", BaseRoute: "users", Endpoints: [] });
    const userSvc = node("Service", { ServiceName: "UserService", Description: "x", Dependencies: [], Methods: [] });
    const userRepo = node("Repository", { RepositoryName: "UserRepository", Description: "x", EntityReference: "users", CustomQueries: [] });
    const tokenCtrl = node("Controller", { ControllerName: "TokenController", Description: "x", BaseRoute: "tokens", Endpoints: [] });
    const tokenSvc = node("Service", { ServiceName: "TokenService", Description: "x", Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }], Methods: [] });
    const edges = [
      edge("CALLS", userCtrl, userSvc),
      edge("CALLS", userSvc, userRepo),
      edge("CALLS", tokenCtrl, tokenSvc),
      // tokenSvc -> userRepo CALLS edge'i NONE (yalniz property-dep).
    ];
    const service = new CodegenService(null as never, null as never, null as never, null as never);
    const project = service.assemble(buildCodeGraph([userCtrl, userSvc, userRepo, tokenCtrl, tokenSvc], edges), "nestjs");

    // TokenModule UserModule'u import eder; UserModule UserRepository'yi export eder.
    expect(fileEndingWith(project, "token/token.module.ts").content).toContain("UserModule");
    expect(fileEndingWith(project, "user/user.module.ts").content).toMatch(/exports:\s*\[[^\]]*UserRepository/);
  });
});

describe("CodegenService — Table-only graph BOOT garantisi (mimari-farkinda)", () => {
  it("Model'siz Table + cross-feature Service->Repository: sentetik entity + module export -> boot eder", () => {
    // image feature ImageGenerationService -CALLS-> UserRepository (auth).
    // Tablolar Model'siz (Users/GeneratedImages). Beklenen:
    //   - Repository<any> + string token NONE; sentetik entity import + Repository<Entity>.
    //   - AuthModule UserRepository EXPORT eder; ImageModule AuthModule import eder.
    //   - app.module yalniz feature modullerini import eder (ham provider degil).
    const usersTable = node("Table", { TableName: "Users", Description: "x", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }] });
    const imagesTable = node("Table", { TableName: "GeneratedImages", Description: "x", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }] });
    const userRepo = node("Repository", { RepositoryName: "UserRepository", Description: "x", EntityReference: "Users", BaseClass: "BaseRepository", CustomQueries: [{ QueryName: "FindById", QueryType: "findOne", Parameters: [{ Name: "id", Type: "UUID" }], ReturnType: "Users" }] });
    const imageRepo = node("Repository", { RepositoryName: "ImageRepository", Description: "x", EntityReference: "GeneratedImages", CustomQueries: [] });
    const authSvc = node("Service", { ServiceName: "AuthService", Description: "x", Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }], Methods: [] });
    const imageSvc = node("Service", { ServiceName: "ImageGenerationService", Description: "x", Dependencies: [{ Kind: "Repository", Ref: "ImageRepository" }, { Kind: "Repository", Ref: "UserRepository" }, { Kind: "Cache", Ref: "ImageCache" }], Methods: [] });
    const imageCache = node("Cache", { CacheName: "ImageCache", Description: "x" });
    const authCtrl = node("Controller", { ControllerName: "AuthController", Description: "x", BaseRoute: "auth", Endpoints: [] });
    const imageCtrl = node("Controller", { ControllerName: "ImageController", Description: "x", BaseRoute: "image", Endpoints: [] });

    const nodes = [usersTable, imagesTable, userRepo, imageRepo, authSvc, imageSvc, imageCache, authCtrl, imageCtrl];
    const edges = [
      edge("CALLS", authCtrl, authSvc),
      edge("CALLS", imageCtrl, imageSvc),
      edge("CALLS", authSvc, userRepo),
      edge("CALLS", imageSvc, imageRepo),
      edge("CALLS", imageSvc, userRepo), // cross-feature
      edge("CALLS", imageSvc, imageCache),
      edge("WRITES", userRepo, usersTable),
      edge("WRITES", imageRepo, imagesTable),
    ];
    const graph = buildCodeGraph(nodes, edges);
    const service = new CodegenService(null as never, null as never, null as never, null as never);
    const project = service.assemble(graph, "nestjs");
    const byPath = new Map(project.files.map((f) => [f.path, f]));

    // Sentetik entity'ler uretildi.
    expect(byPath.has("src/auth/entities/user.entity.ts")).toBe(true);
    expect(byPath.has("src/image/entities/generated-image.entity.ts")).toBe(true);

    // UserRepository sentetik entity'ye baglandi (Repository<any> NONE).
    const userRepoFile = byPath.get("src/auth/user.repository.ts")!.content;
    expect(userRepoFile).toContain("Repository<User>");
    expect(userRepoFile).not.toContain("Repository<any>");
    expect(userRepoFile).not.toContain("extends BaseRepository");
    expect(userRepoFile).toContain("FindById(id: string)"); // UUID -> string

    // AuthModule UserRepository EXPORT eder (cross-feature DI boot eder).
    const authMod = byPath.get("src/auth/auth.module.ts")!.content;
    expect(authMod).toContain("exports: [UserRepository],");
    expect(authMod).toContain("TypeOrmModule.forFeature([User])");

    // ImageModule: AuthModule import + sentetik entity forFeature + Cache provider.
    const imageMod = byPath.get("src/image/image.module.ts")!.content;
    expect(imageMod).toContain("AuthModule");
    expect(imageMod).toContain("TypeOrmModule.forFeature([GeneratedImage])");
    // Cache artik TAM emitter -> gercek provider sinifi (Stub eki NONE).
    expect(imageMod).toContain("ImageCache");
    expect(imageMod).not.toContain("ImageCacheStub");
    // CacheModule.register() feature module imports'a girer (CACHE_MANAGER token).
    expect(imageMod).toContain("CacheModule.register()");

    // app.module yalniz feature modullerini import eder.
    const app = byPath.get("src/app.module.ts")!.content;
    expect(app).toContain("AuthModule,");
    expect(app).toContain("ImageModule,");
    expect(app).not.toContain("providers:");
  });
});

describe("CodegenService — orphan-prevention (B2 gateway / B3 common / B4 config)", () => {
  it("B2: APIGateway gercek @Controller -> feature module controllers'ina girer (orphan degil)", () => {
    // Gateway -CALLS-> UsersService -> gateway, users feature'ina duser; gercek
    //   @Controller olarak users.module controllers'ina girer (UsersController ile).
    const usersSvc = node("Service", { ServiceName: "UsersService", Description: "x", Methods: [], Dependencies: [] });
    const usersCtrl = node("Controller", { ControllerName: "UsersController", Description: "x", BaseRoute: "users", Endpoints: [] });
    const gateway = node("APIGateway", {
      GatewayName: "PublicApiGateway", Description: "giris", Provider: "Kong",
      Routes: [{ Path: "/public/users", TargetRef: "UsersService", Methods: ["GET"], AuthRequired: false }],
    });
    const nodes = [usersSvc, usersCtrl, gateway];
    const edges = [edge("CALLS", usersCtrl, usersSvc), edge("CALLS", gateway, usersSvc)];
    const graph = buildCodeGraph(nodes, edges);
    const project = new CodegenService(null as never, null as never, null as never, null as never).assemble(graph, "nestjs");
    const byPath = new Map(project.files.map((f) => [f.path, f]));

    // Gateway dosyasi users feature'inda + gercek @Controller (Injectable NOT).
    const gw = byPath.get("src/users/public.gateway.ts");
    expect(gw).toBeDefined();
    expect(gw!.content).toContain("@Controller()");
    expect(gw!.content).not.toContain("@Injectable()");
    // Service enjekte eder (Controller degil -> anti-pattern yok).
    expect(gw!.content).toContain("private readonly usersService: UsersService,");
    expect(gw!.content).not.toContain("UsersController");

    // users.module controllers'ina gateway GIRER (orphan KALMAZ).
    const mod = byPath.get("src/users/users.module.ts")!.content;
    expect(mod).toContain("controllers: [UsersController, PublicApiGateway],");
  });

  it("B3: common/'a dusen MessageQueue+EventHandler+Cache -> CommonModule sentezlenir + AppModule import", () => {
    // Hicbir feature'a baglanamayan altyapi -> common. CommonModule onlari toplar,
    //   BullModule.registerQueue + CacheModule.register() wiring'i yapar; AppModule
    //   import eder -> hicbiri orphan kalmaz.
    const queue = node("MessageQueue", { QueueName: "EventsQueue", Description: "x", Type: "Queue", Provider: "RabbitMQ", MessageFormat: "EventDto" });
    const handler = node("EventHandler", { HandlerName: "EventsHandler", Description: "x", EventName: "evt", IsAsync: true, QueueRef: "EventsQueue" });
    const cache = node("Cache", { CacheName: "SharedCache", Description: "x", KeyPattern: "k:{id}", TTL_Seconds: 60, Engine: "Redis" });
    const nodes = [queue, handler, cache];
    const edges = [edge("SUBSCRIBES", handler, queue)];
    const graph = buildCodeGraph(nodes, edges);
    const project = new CodegenService(null as never, null as never, null as never, null as never).assemble(graph, "nestjs");
    const byPath = new Map(project.files.map((f) => [f.path, f]));

    // CommonModule sentezlendi.
    const common = byPath.get("src/common/common.module.ts");
    expect(common).toBeDefined();
    // BullModule.registerQueue GERCEKTEN cagrilir (sessiz basarisizlik NOT).
    expect(common!.content).toContain("BullModule.registerQueue({ name: EVENTS_QUEUE })");
    expect(common!.content).toContain("CacheModule.register()");
    // Tum common altyapi provider'lari @Module.providers'a girer (orphan degil).
    expect(common!.content).toContain("providers: [EventsHandler, EventsQueue, SharedCache]");

    // AppModule CommonModule'u import eder.
    const app = byPath.get("src/app.module.ts")!.content;
    expect(app).toContain('import { CommonModule } from "./common/common.module";');
    expect(app).toContain("CommonModule,");
  });

  it("B4: CoreModule ConfigModule.forRoot(validationSchema) + TypeORM forRootAsync + env.validation.ts (DATABASE_URL required)", () => {
    const ctrl = node("Controller", { ControllerName: "PingController", Description: "x", BaseRoute: "ping", Endpoints: [] });
    const graph = buildCodeGraph([ctrl], []);
    const project = new CodegenService(null as never, null as never, null as never, null as never).assemble(graph, "nestjs");
    const byPath = new Map(project.files.map((f) => [f.path, f]));

    // H3: root forRoot CoreModule'de; app.module ince (yalniz CoreModule + feature).
    const app = byPath.get("src/app.module.ts")!.content;
    expect(app).toContain("    CoreModule,");
    expect(app).not.toContain("ConfigModule.forRoot");

    const core = byPath.get("src/core/core.module.ts")!.content;
    expect(core).toContain("ConfigModule.forRoot({ isGlobal: true, validationSchema })");
    expect(core).toContain("TypeOrmModule.forRootAsync({");
    expect(core).toContain('config.getOrThrow<string>("DATABASE_URL")');

    // env.validation.ts (Joi) DAIMA uretilir; DATABASE_URL zorunlu (fail-fast).
    const v = byPath.get("src/config/env.validation.ts");
    expect(v).toBeDefined();
    expect(v!.content).toContain('import Joi from "joi";');
    expect(v!.content).toContain("DATABASE_URL: Joi.string().required(),");

    // package.json @nestjs/config + joi icerir.
    const pkg = byPath.get("package.json")!.content;
    expect(pkg).toContain('"@nestjs/config"');
    expect(pkg).toContain('"joi"');

    // main.ts fail-fast + ConfigService + Pino logger (H2).
    const main = byPath.get("src/main.ts")!.content;
    expect(main).toContain("bufferLogs: true");
    expect(main).toContain("app.get(ConfigService)");
    expect(main).toContain("app.useLogger(app.get(Logger))");

    // tsconfig strict:true (B1).
    const tsconfig = byPath.get("tsconfig.json")!.content;
    expect(tsconfig).toContain('"strict": true');
  });
});

describe("applySurgicalFills — sakli govdeyi NOT_IMPLEMENTED yerine enjekte", () => {
  const SKELETON: GeneratedFile = {
    path: "src/users/users.service.ts",
    language: "typescript",
    surgicalMarkers: 1,
    content: `import { Injectable } from "@nestjs/common";
@Injectable()
export class UsersService {
  async getById(id: string): Promise<unknown> {
    // @solarch:surgical id=n1#getById
    // Find a user.
    // throws: NotFoundException
    throw new Error("NOT_IMPLEMENTED: UsersService.getById");
  }
}
`,
  };

  it("sakli govde varsa throw'u govde + @solarch:filled ile degistirir, marker'i korur, girintiyi tutar", () => {
    const [out] = applySurgicalFills(
      [SKELETON],
      [{ nodeId: "n1", member: "getById", body: "const u = await this.repo.findById(id);\nif (!u) throw new NotFoundException();\nreturn u;", filledAt: "2026-06-17T00:00:00Z" }],
    );
    expect(out.content).toContain("// @solarch:surgical id=n1#getById"); // marker korundu
    expect(out.content).toContain("// throws: NotFoundException"); // bilgi yorumu korundu
    expect(out.content).toContain("// @solarch:filled by=ai at=2026-06-17T00:00:00Z");
    expect(out.content).toContain("    const u = await this.repo.findById(id);"); // 4-bosluk girinti
    expect(out.content).not.toContain("NOT_IMPLEMENTED"); // iskelet throw'u gitti
  });

  it("sakli govdesi olmayan bolge iskelet kalir (re-fill secsin) — referans degismez", () => {
    const [out] = applySurgicalFills([SKELETON], [{ nodeId: "other", member: "x", body: "return 1;", filledAt: "t" }]);
    expect(out.content).toContain("NOT_IMPLEMENTED");
    expect(out).toBe(SKELETON);
  });

  it("surgical icermeyen dosyaya dokunmaz", () => {
    const plain: GeneratedFile = { path: "x.ts", language: "typescript", surgicalMarkers: 0, content: "export const x = 1;\n" };
    const [out] = applySurgicalFills([plain], [{ nodeId: "n1", member: "getById", body: "return 1;", filledAt: "t" }]);
    expect(out).toBe(plain);
  });
});
