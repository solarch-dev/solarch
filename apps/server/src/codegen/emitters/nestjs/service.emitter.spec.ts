import { describe, it, expect } from "vitest";
import { emitService } from "./service.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ── Fixture helpers ──────────────────────────────────────────────── */
const PROJECT = "00000000-0000-4000-8000-000000000000";
const TAB = "22222222-2222-4222-8222-222222222222";

function node(type: StoredNode["type"], id: string, properties: Record<string, unknown>): StoredNode {
  return {
    id,
    type,
    projectId: PROJECT,
    positionX: 0,
    positionY: 0,
    homeTabId: TAB,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function edge(id: string, kind: EdgeKind, sourceNodeId: string, targetNodeId: string): StoredEdge {
  return {
    id,
    projectId: PROJECT,
    sourceNodeId,
    targetNodeId,
    kind,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: false },
  };
}

function ctxFrom(nodes: StoredNode[], edges: StoredEdge[]): EmitterContext {
  return { graph: buildCodeGraph(nodes, edges), target: "nestjs" };
}

/* ── ID'ler ─────────────────────────────────────────────────────────────── */
const SVC = "10000000-0000-4000-8000-000000000001";
const REPO = "10000000-0000-4000-8000-000000000002";
const DTO_CREATE = "10000000-0000-4000-8000-000000000003";
const DTO_USER = "10000000-0000-4000-8000-000000000004";
const EXC = "10000000-0000-4000-8000-000000000005";
const CACHE = "10000000-0000-4000-8000-000000000006";

/* ── Node fixtures ──────────────────────────────────────────────────── */
const usersRepository = node("Repository", REPO, {
  RepositoryName: "UsersRepository",
  EntityReference: "User",
  CustomQueries: [],
});

const createUserDto = node("DTO", DTO_CREATE, {
  Name: "CreateUserDto",
  Description: "User olusturma girdisi",
  Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false }],
});

const userDto = node("DTO", DTO_USER, {
  Name: "UserDto",
  Description: "User ciktisi",
  Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
});

const notFoundException = node("Exception", EXC, {
  ExceptionName: "UserNotFoundException",
  Description: "User bulunamadi",
  HttpStatusCode: 404,
  LogSeverity: "Warning",
});

const usersCache = node("Cache", CACHE, {
  CacheName: "UsersCache",
  // Cache semasi v1'de stub; emitter sadece adi/yolu kullanir.
});

const usersService = node("Service", SVC, {
  ServiceName: "UsersService",
  Description: "User is mantigi",
  IsTransactionScoped: true,
  Dependencies: [{ Kind: "Repository", Ref: "UsersRepository" }],
  Methods: [
    {
      MethodName: "createUser",
      Visibility: "public",
      Parameters: [{ Name: "input", Type: "unknown", Optional: false, DtoRef: "CreateUserDto" }],
      ReturnType: "User",
      ReturnDtoRef: "UserDto",
      IsAsync: true,
      Throws: ["UserNotFoundException"],
      Description: "Yeni kullanici olusturur ve UserDto doner.",
    },
    {
      MethodName: "countActive",
      Visibility: "private",
      Parameters: [{ Name: "since", Type: "Date", Optional: true, Default: "new Date()" }],
      ReturnType: "number",
      IsAsync: false,
      Throws: [],
    },
  ],
});

describe("emitService", () => {
  it("tam servis — snapshot (DI, dekorator, DTO import, surgical marker)", () => {
    const ctx = ctxFrom(
      [usersService, usersRepository, createUserDto, userDto, notFoundException, usersCache],
      [edge("e-cache", "CALLS", SVC, CACHE)],
    );
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { Injectable } from "@nestjs/common";
      import { UserNotFoundException } from "../common/exceptions/user-not-found.exception";
      import { CreateUserDto } from "./dto/create-user.dto";
      import { UserDto } from "./dto/user.dto";
      import { UsersCache } from "./users.cache";
      import { UsersRepository } from "./users.repository";

      /** User is mantigi */
      @Injectable()
      export class UsersService {
        constructor(
          private readonly usersCache: UsersCache,
          private readonly usersRepository: UsersRepository,
        ) {}

        private countActive(since: Date = new Date()): number {
          // @solarch:surgical id=10000000-0000-4000-8000-000000000001#countActive
          // deps: this.usersCache, this.usersRepository
          throw new Error("NOT_IMPLEMENTED: UsersService.countActive");
        }

        async createUser(input: CreateUserDto): Promise<UserDto> {
          // @solarch:surgical id=10000000-0000-4000-8000-000000000001#createUser
          // Yeni kullanici olusturur ve UserDto doner.
          // throws: UserNotFoundException
          // deps: this.usersCache, this.usersRepository
          throw new Error("NOT_IMPLEMENTED: UsersService.createUser");
        }
      }
      ",
        "language": "typescript",
        "path": "users/users.service.ts",
        "surgicalMarkers": 2,
      }
    `);
  });

  it("public metot IsAsync:false olsa bile async (await-sync TS1308 onle); private sync KALIR", () => {
    // Gercek bug: AuthService.ValidateToken IsAsync:false ama fill await ister -> TS1308.
    // Public metot daima async (NestJS idiom); private graf IsAsync'ini korur.
    const svc = node("Service", SVC, {
      ServiceName: "AuthService",
      Description: "kimlik",
      IsTransactionScoped: false,
      Dependencies: [{ Kind: "Repository", Ref: "UsersRepository" }],
      Methods: [
        { MethodName: "validateToken", Visibility: "public", Parameters: [{ Name: "token", Type: "string", Optional: false }], ReturnType: "UserDto", ReturnDtoRef: "UserDto", IsAsync: false, Throws: [] },
        { MethodName: "hashKey", Visibility: "private", Parameters: [{ Name: "raw", Type: "string", Optional: false }], ReturnType: "string", IsAsync: false, Throws: [] },
      ],
    });
    const ctx = ctxFrom([svc, usersRepository, userDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    // public validateToken -> async + Promise<>
    expect(file.content).toMatch(/async validateToken\([^)]*\): Promise<UserDto>/);
    // private hashKey -> sync KALIR (async NOT)
    expect(file.content).toMatch(/private hashKey\(raw: string\): string \{/);
    expect(file.content).not.toMatch(/async hashKey/);
  });

  it("cozulemeyen DI bagimliligi constructor'a DANGLING tip basmaz (TS2304 + DI boot patlamasini onle)", () => {
    // Bir Service, gercek bir node'a cozulmeyen bagimlilik bildirirse (or. Ref="Environment"
    // ama oyle bir node yok) eskiden `private readonly environment: Environment` uretiliyordu:
    // import yok -> TS2304, ayrica NestJS DI boot'ta "can't resolve" ile patlardi. Cozulemeyen
    // dep DI'dan DUSURULMELI (cozulen repo kalir), yerine TODO. Uyari contract-lint Rule 5'te.
    const svc = node("Service", SVC, {
      ServiceName: "TokenService",
      Description: "JWT uretir/dogrular",
      IsTransactionScoped: false,
      Dependencies: [
        { Kind: "Repository", Ref: "UsersRepository" }, // cozulur
        { Kind: "Service", Ref: "Environment" }, // cozulmez (node yok)
      ],
      Methods: [
        { MethodName: "generateTokens", Visibility: "public", Parameters: [{ Name: "userId", Type: "UUID", Optional: false }], ReturnType: "TokenPair", IsAsync: false, Throws: [] },
      ],
    });
    const ctx = ctxFrom([svc, usersRepository], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    // Dangling tip ve dangling DI alani URETILMEZ.
    expect(file.content).not.toMatch(/:\s*Environment\b/);
    expect(file.content).not.toContain("private readonly environment");
    // Cozulen repo bagimliligi KORUNUR.
    expect(file.content).toContain("private readonly usersRepository: UsersRepository,");
    // Atlanan dep in-file gorunur (TODO).
    expect(file.content).toMatch(/TODO:.*Environment.*(resolve|omitted)/i);
    // Cozulemeyen serbest donus tipi (TokenPair) merkezi degrade ile Record olur (Fix 1).
    expect(file.content).toContain("Record<string, unknown>");
  });

  it("DI = Dependencies ∪ CALLS hedefleri, DEDUP + isme gore sirali", () => {
    // Dependencies'te UsersRepository var; CALLS edge ile de ayni repo → tek alan.
    const ctx = ctxFrom(
      [usersService, usersRepository, createUserDto, userDto, notFoundException],
      [edge("e-dup", "CALLS", SVC, REPO)],
    );
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    const occurrences = file.content.split("private readonly usersRepository").length - 1;
    expect(occurrences).toBe(1);
    expect(file.content).toContain("private readonly usersRepository: UsersRepository,");
  });

  it("DTO import'lari DEGER import ile gelir (surgical AI runtime kullanir), exception deger import'u ile", () => {
    const ctx = ctxFrom(
      [usersService, usersRepository, createUserDto, userDto, notFoundException],
      [],
    );
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    // DTO'lar DEGER import ile: surgical AI govdede DTO'yu runtime deger olarak
    // kullanabilsin (plainToInstance(CreateUserDto, ...)) -> `import type` olsaydi
    // derlenmezdi. (DTO'lar UsersService ile ayni "users" feature'inda -> ./dto.)
    expect(file.content).toContain('import { CreateUserDto } from "./dto/create-user.dto";');
    expect(file.content).toContain('import { UserDto } from "./dto/user.dto";');
    // type-only NOT -> "import type { ...Dto }" URETILMEMELI.
    expect(file.content).not.toContain("import type { CreateUserDto }");
    expect(file.content).not.toContain("import type { UserDto }");
    // Exception deger import'u ile (THROWS kaynagi yok -> common/exceptions).
    expect(file.content).toContain('import { UserNotFoundException } from "../common/exceptions/user-not-found.exception";');
    expect(file.content).toContain('import { Injectable } from "@nestjs/common";');
  });

  it("her govde-gerektiren metot icin surgical marker + NOT_IMPLEMENTED", () => {
    const ctx = ctxFrom([usersService, usersRepository, createUserDto, userDto, notFoundException], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.surgicalMarkers).toBe(2);
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: UsersService.createUser");');
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: UsersService.countActive");');
  });

  it("async metot Promise<> sarar, sync metot sarmaz", () => {
    const ctx = ctxFrom([usersService, usersRepository, createUserDto, userDto, notFoundException], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("async createUser(input: CreateUserDto): Promise<UserDto> {");
    // Default varsa "?" duser (gecerli TS) → "since: Date = new Date()".
    expect(file.content).toContain("private countActive(since: Date = new Date()): number {");
  });

  it("content ends with single newline", () => {
    const ctx = ctxFrom([usersService, usersRepository, createUserDto, userDto, notFoundException], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMINISM: two independent graph builds -> byte-identical", () => {
    const nodes = [usersService, usersRepository, createUserDto, userDto, notFoundException, usersCache];
    const ctxA = ctxFrom(nodes, [edge("e-cache", "CALLS", SVC, CACHE)]);
    const a = emitService(ctxA.graph.byId(SVC)!, ctxA)[0].content;
    const ctxB = ctxFrom(nodes, [edge("e-cache", "CALLS", SVC, CACHE)]);
    const b = emitService(ctxB.graph.byId(SVC)!, ctxB)[0].content;
    expect(a).toBe(b);
  });

  it("DEDUP: cozulemeyen property Dependency, cozulebilen CALLS edge'ini MASKELEMEZ (import korunur)", () => {
    // Property Dependency yanlis Kind ile cozulemez (Service diye arar ama node
    // Repository'dir) -> ham ref "UsersRepository" filePath=null girer. Ayni ada
    // giden CALLS edge gercek Repository'yi cozer. Cozulen KAZANMALI (import kalmali).
    const svc = node("Service", SVC, {
      ServiceName: "OrdersService",
      Description: "Order mantigi",
      IsTransactionScoped: false,
      // Kasitli yanlis Kind -> resolveRef("Service","UsersRepository") = null.
      Dependencies: [{ Kind: "Service", Ref: "UsersRepository" }],
      Methods: [],
    });
    const ctx = ctxFrom([svc, usersRepository], [edge("e-calls", "CALLS", SVC, REPO)]);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    // Tek alan (dedup), tip dogru ve EN ONEMLISI import uretildi (filePath null kalmadi).
    const occurrences = file.content.split("private readonly usersRepository").length - 1;
    expect(occurrences).toBe(1);
    expect(file.content).toContain("private readonly usersRepository: UsersRepository,");
    // EN ONEMLISI: import uretildi (cozulen entry kazandi; filePath null kalmadi).
    expect(file.content).toMatch(/import \{ UsersRepository \} from ".*users\.repository"/);
  });

  /* ── DIZI RETURN KORUMA: ReturnType="XDto[]" + ReturnDtoRef -> "XDto[]" ──── */
  it("dizi donus: ReturnType='XDto[]' + ReturnDtoRef -> Promise<XDto[]> (controller ile hizali)", () => {
    // Graf zaten dizi donusler icin ReturnType="CartItemDto[]" verir AMA DtoRef de
    // doludur. Eskiden DtoRef dolu oldugunda ham Type atilip ciplak "CartItemDto"
    // donerdi -> service tekil, controller dizi -> uyumsuz imza. Artik dizi korunur.
    const cartItemDto = node("DTO", "10000000-0000-4000-8000-0000000000a1", {
      Name: "CartItemDto",
      Description: "Sepet kalemi ciktisi",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const cartService = node("Service", SVC, {
      ServiceName: "CartService",
      Description: "Sepet is mantigi",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "getCart",
          Visibility: "public",
          Parameters: [{ Name: "userId", Type: "UUID", Optional: false }],
          // CRITICAL: ham Type dizi tasir + DtoRef dolu.
          ReturnType: "CartItemDto[]",
          ReturnDtoRef: "CartItemDto",
          IsAsync: true,
          Throws: [],
          Description: "Usernin sepet kalemlerini doner.",
        },
      ],
    });
    const ctx = ctxFrom([cartService, cartItemDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    // Dizi KORUNDU -> Promise<CartItemDto[]> (controller ile ayni imza).
    expect(file.content).toContain("async getCart(userId: string): Promise<CartItemDto[]> {");
    expect(file.content).not.toContain("Promise<CartItemDto> {");
    // DTO yine DEGER import edilir (sinif adi cozuldu).
    expect(file.content).toContain('import { CartItemDto } from "./dto/cart-item.dto";');
  });

  it("dizi donus (DtoRef NONE): ReturnType='XDto[]' zaten korunur (regresyon)", () => {
    // ReturnDtoRef bosken yol resolveTypeRef'ten gecer; dizi zaten korunuyordu.
    // Bu testin amaci: duzeltme bu yolu BOZMADI (mevcut tekil davranis degismedi).
    const productDto = node("DTO", "10000000-0000-4000-8000-0000000000b2", {
      Name: "ProductDto",
      Description: "Urun ciktisi",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const productService = node("Service", SVC, {
      ServiceName: "ProductService",
      Description: "Urun is mantigi",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "list",
          Visibility: "public",
          Parameters: [],
          ReturnType: "ProductDto[]",
          // ReturnDtoRef NONE -> resolveTypeRef yolu.
          IsAsync: true,
          Throws: [],
        },
      ],
    });
    const ctx = ctxFrom([productService, productDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("async list(): Promise<ProductDto[]> {");
  });

  it("dizi parametresi: Type='XDto[]' + DtoRef -> dizi korunur (param tarafi tutarli)", () => {
    // Parametre tipinde de dizi-koruma tutarli olmali (gorev geregi).
    const itemDto = node("DTO", "10000000-0000-4000-8000-0000000000c3", {
      Name: "ItemDto",
      Description: "Kalem girdisi",
      Fields: [{ Name: "sku", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const bulkService = node("Service", SVC, {
      ServiceName: "BulkService",
      Description: "Toplu islem mantigi",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "addMany",
          Visibility: "public",
          Parameters: [{ Name: "items", Type: "ItemDto[]", Optional: false, DtoRef: "ItemDto" }],
          ReturnType: "void",
          IsAsync: true,
          Throws: [],
        },
      ],
    });
    const ctx = ctxFrom([bulkService, itemDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("async addMany(items: ItemDto[]): Promise<void> {");
    expect(file.content).not.toContain("addMany(items: ItemDto)");
  });

  /* ── TEK-SOURCE KARDINALITE: ReturnsCollection bildirilmis alani ──────────
   * Graf SINGLE ReturnType verse bile (or. ListProducts'ta ReturnType='ProductDto',
   * ReturnDtoRef='ProductDto'), operasyon bir COLLECTION ise service imzasi DTO[]
   * olmali. Aksi halde controller dizi (route sezgisi) ↔ service tekil -> uyumsuz
   * imza + surgical govdedeki `return result` (dizi) DERLEME hatasi verir (gercek
   * bug: ListProducts/ListOrders, surgical-output 18 tsc hatasi). ReturnsCollection
   * kardinalitenin TEK KAYNAGIDIR; emitter onu okur ve tipi DTO[]'e zorlar. */
  it("ReturnsCollection=true: tekil ReturnDtoRef'i Promise<XDto[]>'e zorlar (tek-kaynak)", () => {
    const productDto = node("DTO", "10000000-0000-4000-8000-0000000000d4", {
      Name: "ProductDto",
      Description: "Urun ciktisi",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const catalogService = node("Service", SVC, {
      ServiceName: "CatalogService",
      Description: "Katalog is mantigi",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "listProducts",
          Visibility: "public",
          Parameters: [],
          ReturnType: "ProductDto", // SINGLE ham tip
          ReturnDtoRef: "ProductDto",
          ReturnsCollection: true, // bildirilmis tek-kaynak
          IsAsync: true,
          Throws: [],
          Description: "Urunleri listeler.",
        },
      ],
    });
    const ctx = ctxFrom([catalogService, productDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("async listProducts(): Promise<ProductDto[]> {");
    expect(file.content).not.toContain("Promise<ProductDto> {");
  });

  /* ── FALLBACK: metot-adi liste-semantigi (bildirilmis alan NONEKEN) ────────
   * Gercek bug: ListProducts/ListOrders graf'ta ReturnsCollection alani WITHOUT +
   * tekil ReturnType ile geldi. Bildirilmis alan yoksa emitter, metot adinin liste-
   * semantigine (list/all/search/findAll/findMany) bakip koleksiyon cikarir -> DTO[].
   * EXACT-kelime eslesmesi: "listen"/"getAllowance" gibi adlar YANLIS pozitif vermez. */
  it("fallback: liste-semantikli ad (listProducts) tekil ReturnType'i Promise<XDto[]> yapar", () => {
    const productDto = node("DTO", "10000000-0000-4000-8000-0000000000e5", {
      Name: "ProductDto",
      Description: "Urun ciktisi",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const catalogService = node("Service", SVC, {
      ServiceName: "CatalogService",
      Description: "Katalog is mantigi",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "listProducts",
          Visibility: "public",
          Parameters: [],
          ReturnType: "ProductDto", // SINGLE + ReturnsCollection NONE
          ReturnDtoRef: "ProductDto",
          IsAsync: true,
          Throws: [],
          Description: "Urunleri listeler.",
        },
      ],
    });
    const ctx = ctxFrom([catalogService, productDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("async listProducts(): Promise<ProductDto[]> {");
  });

  /* ── PRECEDENCE: bildirilmis ReturnsCollection=false, ad-sezgisini OVERRIDES ───
   * 'getAllSettings' adi 'all' icerir -> fallback koleksiyon derdi; ama alan acikca
   * false. Bildirilmis alan KAZANIR (tekil kalir). Bu, `??` semantigini kilitler:
   * `||` kullanilsaydi false dusup ada kayardi (ince regresyon) -> bu test yakalar. */
  it("ReturnsCollection=false ad-sezgisini ezer (bildirilen > tahmin)", () => {
    const settingsDto = node("DTO", "10000000-0000-4000-8000-0000000000f6", {
      Name: "SettingsDto",
      Description: "Ayar ciktisi",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const settingsService = node("Service", SVC, {
      ServiceName: "SettingsService",
      Description: "Ayar is mantigi",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "getAllSettings", // 'all' -> ad-sezgisi koleksiyon derdi
          Visibility: "public",
          Parameters: [],
          ReturnType: "SettingsDto",
          ReturnDtoRef: "SettingsDto",
          ReturnsCollection: false, // ama bildirilmis alan tekil diyor -> kazanir
          IsAsync: true,
          Throws: [],
          Description: "Tum ayarlari tek nesnede doner.",
        },
      ],
    });
    const ctx = ctxFrom([settingsService, settingsDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("async getAllSettings(): Promise<SettingsDto> {");
    expect(file.content).not.toContain("Promise<SettingsDto[]>");
  });

  /* ── AUTH GROUNDING: login/register metodlu servis -> auth helper import ─
   * Login/Register fill'i comparePassword/hashPassword/signAccessToken'i KULLANSIN
   * diye (duz-metin sifre / sahte token yerine), bu helper'lar servise import edilir
   * -> readDeclaredSurface AI'in apiSurface'ine koyar. noUnusedLocals kapali: kullanmazsa
   * zararsiz. Auth-metot adi: login/register/signin/signup/authenticate/... */
  it("auth servisi (Login metodu) -> auth helper'larini import eder (grounding)", () => {
    const authSvc = node("Service", SVC, {
      ServiceName: "AuthService",
      Description: "kimlik dogrulama",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        { MethodName: "Login", Visibility: "public", Parameters: [], ReturnType: "UserResponse", IsAsync: true, Throws: [] },
      ],
    });
    const ctx = ctxFrom([authSvc], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("comparePassword");
    expect(file.content).toContain("hashPassword");
    expect(file.content).toContain("signAccessToken");
    expect(file.content).toMatch(/from "\.\.\/shared\/auth\/password"/);
    expect(file.content).toMatch(/from "\.\.\/shared\/auth\/auth-token"/);
  });

  it("auth WITHOUT servis -> auth helper import ETMEZ", () => {
    const ctx = ctxFrom([usersService, usersRepository, createUserDto, userDto, notFoundException], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).not.toContain("shared/auth");
  });

  /* ── STATE-MACHINE GROUNDING (L2): status-guncelleyen servis -> assert guard ─
   * Update*Status metodu olan servise, gecis kurali TANIMLI enum'larin
   * assert<Enum>Transition guard'i import edilir -> AI fill'i illegal gecisi
   * (pending->delivered atlamasi) reddeder. Gecis kurali NONE enum -> import yok. */
  it("status-guncelleyen servis -> gecisli enum'un assert<Enum>Transition'ini import eder", () => {
    const orderStatus = node("Enum", "e2e2e2e2-2222-4222-8222-e2e2e2e2e2e2", {
      Name: "OrderStatus",
      Description: "Order status",
      BackingType: "string",
      Values: [{ Key: "PENDING" }, { Key: "CONFIRMED" }],
      Transitions: [{ From: "PENDING", To: ["CONFIRMED"] }],
    });
    const orderSvc = node("Service", SVC, {
      ServiceName: "OrderService",
      Description: "siparis is mantigi",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        { MethodName: "UpdateStatus", Visibility: "public", Parameters: [{ Name: "id", Type: "string" }, { Name: "status", Type: "string" }], ReturnType: "OrderResponse", IsAsync: true, Throws: [] },
      ],
    });
    const ctx = ctxFrom([orderSvc, orderStatus], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("assertOrderStatusTransition");
    expect(file.content).toMatch(/from ".*order-status\.enum"/);
  });

  it("gecis kurali NONE enum -> status servisi guard import ETMEZ", () => {
    const plainStatus = node("Enum", "e3e3e3e3-3333-4333-8333-e3e3e3e3e3e3", {
      Name: "OrderStatus",
      Description: "durum",
      BackingType: "string",
      Values: [{ Key: "PENDING" }, { Key: "CONFIRMED" }],
      // Transitions NONE.
    });
    const orderSvc = node("Service", SVC, {
      ServiceName: "OrderService",
      Description: "order",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [{ MethodName: "UpdateStatus", Visibility: "public", Parameters: [], ReturnType: "OrderResponse", IsAsync: true, Throws: [] }],
    });
    const ctx = ctxFrom([orderSvc, plainStatus], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).not.toContain("assertOrderStatusTransition");
  });

  /* ── EDGE-CASE: kayip ref + bos koleksiyon — ASLA throw etmez ──────────── */
  it("edge-case: kayip DTO/Exception ref + bos Dependencies — throw etmez, ham tip kullanir", () => {
    const lonelyService = node("Service", SVC, {
      ServiceName: "LonelyService",
      Description: "Bagimliliksiz servis",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "ping",
          Visibility: "public",
          Parameters: [{ Name: "raw", Type: "string", Optional: false, DtoRef: "MissingDto" }],
          ReturnType: "boolean",
          ReturnDtoRef: "AlsoMissingDto",
          IsAsync: false,
          Throws: ["GhostException"],
          Description: "Kayip ref'ler ham tipe dusmeli.",
        },
      ],
    });
    // Hicbir ref'i cozen node yok; yalniz servisin kendisi graph'ta.
    const ctx = ctxFrom([lonelyService], []);
    let file: { content: string; surgicalMarkers: number; path: string } | undefined;
    expect(() => {
      file = emitService(ctx.graph.byId(SVC)!, ctx)[0];
    }).not.toThrow();
    // Controller yok → Service kendi adindan feature turer ("lonely"); dosya adi
    // rol son-ekini ("Service") TEKRARLAMAZ.
    expect(file!.path).toBe("lonely/lonely.service.ts");
    // Constructor yok (bos DI), parametre tipi ham "string"e dusmus.
    expect(file!.content).not.toContain("constructor(");
    // public metot -> async (NestJS idiom + await-sync guvenlik agi); ham ReturnType Promise'le sarilir.
    expect(file!.content).toContain("async ping(raw: string): Promise<boolean> {");
    // Kayip ReturnDtoRef -> ham ReturnType (Promise<> icinde).
    expect(file!.content).toContain("): Promise<boolean> {");
    // Cozulemeyen exception artik SENTETIK dosyadan import edilir (exception-synthesis
    // bildirilmis-ama-tanimsiz Throws'u uretir → fill `throw new Ghost...` derlenir, TS2304 yok).
    expect(file!.content).toContain('import { GhostException } from "../common/exceptions/ghost.exception";');
    expect(file!.content).toContain("// throws: GhostException");
    expect(file!.surgicalMarkers).toBe(1);
  });
});
