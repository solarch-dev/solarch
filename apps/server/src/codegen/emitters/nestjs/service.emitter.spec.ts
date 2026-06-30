import { describe, it, expect } from "vitest";
import { emitService } from "./service.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ── Fixture yardımcıları ──────────────────────────────────────────────── */
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

/* ── Node fixture'ları ──────────────────────────────────────────────────── */
const usersRepository = node("Repository", REPO, {
  RepositoryName: "UsersRepository",
  EntityReference: "User",
  CustomQueries: [],
});

const createUserDto = node("DTO", DTO_CREATE, {
  Name: "CreateUserDto",
  Description: "Kullanıcı oluşturma girdisi",
  Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false }],
});

const userDto = node("DTO", DTO_USER, {
  Name: "UserDto",
  Description: "Kullanıcı çıktısı",
  Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
});

const notFoundException = node("Exception", EXC, {
  ExceptionName: "UserNotFoundException",
  Description: "Kullanıcı bulunamadı",
  HttpStatusCode: 404,
  LogSeverity: "Warning",
});

const usersCache = node("Cache", CACHE, {
  CacheName: "UsersCache",
  // Cache şeması v1'de stub; emitter sadece adı/yolu kullanır.
});

const usersService = node("Service", SVC, {
  ServiceName: "UsersService",
  Description: "Kullanıcı iş mantığı",
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
      Description: "Yeni kullanıcı oluşturur ve UserDto döner.",
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
  it("tam servis — snapshot (DI, dekoratör, DTO import, surgical marker)", () => {
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

      /** Kullanıcı iş mantığı */
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
          // Yeni kullanıcı oluşturur ve UserDto döner.
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

  it("public metot IsAsync:false olsa bile async (await-sync TS1308 önle); private sync KALIR", () => {
    // Gerçek bug: AuthService.ValidateToken IsAsync:false ama fill await ister -> TS1308.
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
    // private hashKey -> sync KALIR (async DEĞİL)
    expect(file.content).toMatch(/private hashKey\(raw: string\): string \{/);
    expect(file.content).not.toMatch(/async hashKey/);
  });

  it("çözülemeyen DI bağımlılığı constructor'a DANGLING tip basmaz (TS2304 + DI boot patlamasını önle)", () => {
    // Bir Service, gerçek bir node'a çözülmeyen bağımlılık bildirirse (ör. Ref="Environment"
    // ama öyle bir node yok) eskiden `private readonly environment: Environment` üretiliyordu:
    // import yok -> TS2304, ayrıca NestJS DI boot'ta "can't resolve" ile patlardı. Çözülemeyen
    // dep DI'dan DÜŞÜRÜLMELİ (çözülen repo kalır), yerine TODO. Uyarı contract-lint Rule 5'te.
    const svc = node("Service", SVC, {
      ServiceName: "TokenService",
      Description: "JWT üretir/doğrular",
      IsTransactionScoped: false,
      Dependencies: [
        { Kind: "Repository", Ref: "UsersRepository" }, // çözülür
        { Kind: "Service", Ref: "Environment" }, // çözülmez (node yok)
      ],
      Methods: [
        { MethodName: "generateTokens", Visibility: "public", Parameters: [{ Name: "userId", Type: "UUID", Optional: false }], ReturnType: "TokenPair", IsAsync: false, Throws: [] },
      ],
    });
    const ctx = ctxFrom([svc, usersRepository], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    // Dangling tip ve dangling DI alanı ÜRETİLMEZ.
    expect(file.content).not.toMatch(/:\s*Environment\b/);
    expect(file.content).not.toContain("private readonly environment");
    // Çözülen repo bağımlılığı KORUNUR.
    expect(file.content).toContain("private readonly usersRepository: UsersRepository,");
    // Atlanan dep in-file görünür (TODO).
    expect(file.content).toMatch(/TODO:.*Environment.*(resolve|omitted)/i);
    // Çözülemeyen serbest dönüş tipi (TokenPair) merkezi degrade ile Record olur (Fix 1).
    expect(file.content).toContain("Record<string, unknown>");
  });

  it("DI = Dependencies ∪ CALLS hedefleri, DEDUP + isme göre sıralı", () => {
    // Dependencies'te UsersRepository var; CALLS edge ile de aynı repo → tek alan.
    const ctx = ctxFrom(
      [usersService, usersRepository, createUserDto, userDto, notFoundException],
      [edge("e-dup", "CALLS", SVC, REPO)],
    );
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    const occurrences = file.content.split("private readonly usersRepository").length - 1;
    expect(occurrences).toBe(1);
    expect(file.content).toContain("private readonly usersRepository: UsersRepository,");
  });

  it("DTO import'ları DEĞER import ile gelir (surgical AI runtime kullanır), exception değer import'u ile", () => {
    const ctx = ctxFrom(
      [usersService, usersRepository, createUserDto, userDto, notFoundException],
      [],
    );
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    // DTO'lar DEĞER import ile: surgical AI gövdede DTO'yu runtime değer olarak
    // kullanabilsin (plainToInstance(CreateUserDto, ...)) -> `import type` olsaydı
    // derlenmezdi. (DTO'lar UsersService ile aynı "users" feature'ında -> ./dto.)
    expect(file.content).toContain('import { CreateUserDto } from "./dto/create-user.dto";');
    expect(file.content).toContain('import { UserDto } from "./dto/user.dto";');
    // type-only DEĞİL -> "import type { ...Dto }" ÜRETİLMEMELİ.
    expect(file.content).not.toContain("import type { CreateUserDto }");
    expect(file.content).not.toContain("import type { UserDto }");
    // Exception değer import'u ile (THROWS kaynağı yok -> common/exceptions).
    expect(file.content).toContain('import { UserNotFoundException } from "../common/exceptions/user-not-found.exception";');
    expect(file.content).toContain('import { Injectable } from "@nestjs/common";');
  });

  it("her gövde-gerektiren metot için surgical marker + NOT_IMPLEMENTED", () => {
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
    // Default varsa "?" düşer (geçerli TS) → "since: Date = new Date()".
    expect(file.content).toContain("private countActive(since: Date = new Date()): number {");
  });

  it("içerik tek satır sonu ile biter", () => {
    const ctx = ctxFrom([usersService, usersRepository, createUserDto, userDto, notFoundException], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMİNİZM: iki bağımsız graph kuruluşu -> byte-identical", () => {
    const nodes = [usersService, usersRepository, createUserDto, userDto, notFoundException, usersCache];
    const ctxA = ctxFrom(nodes, [edge("e-cache", "CALLS", SVC, CACHE)]);
    const a = emitService(ctxA.graph.byId(SVC)!, ctxA)[0].content;
    const ctxB = ctxFrom(nodes, [edge("e-cache", "CALLS", SVC, CACHE)]);
    const b = emitService(ctxB.graph.byId(SVC)!, ctxB)[0].content;
    expect(a).toBe(b);
  });

  it("DEDUP: çözülemeyen property Dependency, çözülebilen CALLS edge'ini MASKELEMEZ (import korunur)", () => {
    // Property Dependency yanlış Kind ile çözülemez (Service diye arar ama node
    // Repository'dir) -> ham ref "UsersRepository" filePath=null girer. Aynı ada
    // giden CALLS edge gerçek Repository'yi çözer. Çözülen KAZANMALI (import kalmalı).
    const svc = node("Service", SVC, {
      ServiceName: "OrdersService",
      Description: "Sipariş mantığı",
      IsTransactionScoped: false,
      // Kasıtlı yanlış Kind -> resolveRef("Service","UsersRepository") = null.
      Dependencies: [{ Kind: "Service", Ref: "UsersRepository" }],
      Methods: [],
    });
    const ctx = ctxFrom([svc, usersRepository], [edge("e-calls", "CALLS", SVC, REPO)]);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    // Tek alan (dedup), tip doğru ve EN ÖNEMLİSİ import üretildi (filePath null kalmadı).
    const occurrences = file.content.split("private readonly usersRepository").length - 1;
    expect(occurrences).toBe(1);
    expect(file.content).toContain("private readonly usersRepository: UsersRepository,");
    // EN ÖNEMLİSİ: import üretildi (çözülen entry kazandı; filePath null kalmadı).
    expect(file.content).toMatch(/import \{ UsersRepository \} from ".*users\.repository"/);
  });

  /* ── DİZİ DÖNÜŞ KORUMA: ReturnType="XDto[]" + ReturnDtoRef -> "XDto[]" ──── */
  it("dizi dönüş: ReturnType='XDto[]' + ReturnDtoRef -> Promise<XDto[]> (controller ile hizalı)", () => {
    // Graf zaten dizi dönüşler için ReturnType="CartItemDto[]" verir AMA DtoRef de
    // doludur. Eskiden DtoRef dolu olduğunda ham Type atılıp çıplak "CartItemDto"
    // dönerdi -> service tekil, controller dizi -> uyumsuz imza. Artık dizi korunur.
    const cartItemDto = node("DTO", "10000000-0000-4000-8000-0000000000a1", {
      Name: "CartItemDto",
      Description: "Sepet kalemi çıktısı",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const cartService = node("Service", SVC, {
      ServiceName: "CartService",
      Description: "Sepet iş mantığı",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "getCart",
          Visibility: "public",
          Parameters: [{ Name: "userId", Type: "UUID", Optional: false }],
          // KRİTİK: ham Type dizi taşır + DtoRef dolu.
          ReturnType: "CartItemDto[]",
          ReturnDtoRef: "CartItemDto",
          IsAsync: true,
          Throws: [],
          Description: "Kullanıcının sepet kalemlerini döner.",
        },
      ],
    });
    const ctx = ctxFrom([cartService, cartItemDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    // Dizi KORUNDU -> Promise<CartItemDto[]> (controller ile aynı imza).
    expect(file.content).toContain("async getCart(userId: string): Promise<CartItemDto[]> {");
    expect(file.content).not.toContain("Promise<CartItemDto> {");
    // DTO yine DEĞER import edilir (sınıf adı çözüldü).
    expect(file.content).toContain('import { CartItemDto } from "./dto/cart-item.dto";');
  });

  it("dizi dönüş (DtoRef YOK): ReturnType='XDto[]' zaten korunur (regresyon)", () => {
    // ReturnDtoRef boşken yol resolveTypeRef'ten geçer; dizi zaten korunuyordu.
    // Bu testin amacı: düzeltme bu yolu BOZMADI (mevcut tekil davranış değişmedi).
    const productDto = node("DTO", "10000000-0000-4000-8000-0000000000b2", {
      Name: "ProductDto",
      Description: "Ürün çıktısı",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const productService = node("Service", SVC, {
      ServiceName: "ProductService",
      Description: "Ürün iş mantığı",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "list",
          Visibility: "public",
          Parameters: [],
          ReturnType: "ProductDto[]",
          // ReturnDtoRef YOK -> resolveTypeRef yolu.
          IsAsync: true,
          Throws: [],
        },
      ],
    });
    const ctx = ctxFrom([productService, productDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("async list(): Promise<ProductDto[]> {");
  });

  it("dizi parametresi: Type='XDto[]' + DtoRef -> dizi korunur (param tarafı tutarlı)", () => {
    // Parametre tipinde de dizi-koruma tutarlı olmalı (görev gereği).
    const itemDto = node("DTO", "10000000-0000-4000-8000-0000000000c3", {
      Name: "ItemDto",
      Description: "Kalem girdisi",
      Fields: [{ Name: "sku", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const bulkService = node("Service", SVC, {
      ServiceName: "BulkService",
      Description: "Toplu işlem mantığı",
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

  /* ── TEK-KAYNAK KARDİNALİTE: ReturnsCollection bildirilmiş alanı ──────────
   * Graf TEKİL ReturnType verse bile (ör. ListProducts'ta ReturnType='ProductDto',
   * ReturnDtoRef='ProductDto'), operasyon bir KOLEKSİYON ise service imzası DTO[]
   * olmalı. Aksi halde controller dizi (route sezgisi) ↔ service tekil -> uyumsuz
   * imza + surgical gövdedeki `return result` (dizi) DERLEME hatası verir (gerçek
   * bug: ListProducts/ListOrders, surgical-output 18 tsc hatası). ReturnsCollection
   * kardinalitenin TEK KAYNAĞIDIR; emitter onu okur ve tipi DTO[]'e zorlar. */
  it("ReturnsCollection=true: tekil ReturnDtoRef'i Promise<XDto[]>'e zorlar (tek-kaynak)", () => {
    const productDto = node("DTO", "10000000-0000-4000-8000-0000000000d4", {
      Name: "ProductDto",
      Description: "Ürün çıktısı",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const catalogService = node("Service", SVC, {
      ServiceName: "CatalogService",
      Description: "Katalog iş mantığı",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "listProducts",
          Visibility: "public",
          Parameters: [],
          ReturnType: "ProductDto", // TEKİL ham tip
          ReturnDtoRef: "ProductDto",
          ReturnsCollection: true, // bildirilmiş tek-kaynak
          IsAsync: true,
          Throws: [],
          Description: "Ürünleri listeler.",
        },
      ],
    });
    const ctx = ctxFrom([catalogService, productDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("async listProducts(): Promise<ProductDto[]> {");
    expect(file.content).not.toContain("Promise<ProductDto> {");
  });

  /* ── FALLBACK: metot-adı liste-semantiği (bildirilmiş alan YOKKEN) ────────
   * Gerçek bug: ListProducts/ListOrders graf'ta ReturnsCollection alanı OLMADAN +
   * tekil ReturnType ile geldi. Bildirilmiş alan yoksa emitter, metot adının liste-
   * semantiğine (list/all/search/findAll/findMany) bakıp koleksiyon çıkarır -> DTO[].
   * EXACT-kelime eşleşmesi: "listen"/"getAllowance" gibi adlar YANLIŞ pozitif vermez. */
  it("fallback: liste-semantikli ad (listProducts) tekil ReturnType'ı Promise<XDto[]> yapar", () => {
    const productDto = node("DTO", "10000000-0000-4000-8000-0000000000e5", {
      Name: "ProductDto",
      Description: "Ürün çıktısı",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const catalogService = node("Service", SVC, {
      ServiceName: "CatalogService",
      Description: "Katalog iş mantığı",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "listProducts",
          Visibility: "public",
          Parameters: [],
          ReturnType: "ProductDto", // TEKİL + ReturnsCollection YOK
          ReturnDtoRef: "ProductDto",
          IsAsync: true,
          Throws: [],
          Description: "Ürünleri listeler.",
        },
      ],
    });
    const ctx = ctxFrom([catalogService, productDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("async listProducts(): Promise<ProductDto[]> {");
  });

  /* ── PRECEDENCE: bildirilmiş ReturnsCollection=false, ad-sezgisini EZER ───
   * 'getAllSettings' adı 'all' içerir -> fallback koleksiyon derdi; ama alan açıkça
   * false. Bildirilmiş alan KAZANIR (tekil kalır). Bu, `??` semantiğini kilitler:
   * `||` kullanılsaydı false düşüp ada kayardı (ince regresyon) -> bu test yakalar. */
  it("ReturnsCollection=false ad-sezgisini ezer (bildirilen > tahmin)", () => {
    const settingsDto = node("DTO", "10000000-0000-4000-8000-0000000000f6", {
      Name: "SettingsDto",
      Description: "Ayar çıktısı",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const settingsService = node("Service", SVC, {
      ServiceName: "SettingsService",
      Description: "Ayar iş mantığı",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        {
          MethodName: "getAllSettings", // 'all' -> ad-sezgisi koleksiyon derdi
          Visibility: "public",
          Parameters: [],
          ReturnType: "SettingsDto",
          ReturnDtoRef: "SettingsDto",
          ReturnsCollection: false, // ama bildirilmiş alan tekil diyor -> kazanır
          IsAsync: true,
          Throws: [],
          Description: "Tüm ayarları tek nesnede döner.",
        },
      ],
    });
    const ctx = ctxFrom([settingsService, settingsDto], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).toContain("async getAllSettings(): Promise<SettingsDto> {");
    expect(file.content).not.toContain("Promise<SettingsDto[]>");
  });

  /* ── AUTH GROUNDING: login/register metodlu servis -> auth helper import ─
   * Login/Register fill'i comparePassword/hashPassword/signAccessToken'ı KULLANSIN
   * diye (düz-metin şifre / sahte token yerine), bu helper'lar servise import edilir
   * -> readDeclaredSurface AI'ın apiSurface'ine koyar. noUnusedLocals kapalı: kullanmazsa
   * zararsız. Auth-metot adı: login/register/signin/signup/authenticate/... */
  it("auth servisi (Login metodu) -> auth helper'larını import eder (grounding)", () => {
    const authSvc = node("Service", SVC, {
      ServiceName: "AuthService",
      Description: "kimlik doğrulama",
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

  it("auth OLMAYAN servis -> auth helper import ETMEZ", () => {
    const ctx = ctxFrom([usersService, usersRepository, createUserDto, userDto, notFoundException], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).not.toContain("shared/auth");
  });

  /* ── STATE-MACHINE GROUNDING (L2): status-güncelleyen servis -> assert guard ─
   * Update*Status metodu olan servise, geçiş kuralı TANIMLI enum'ların
   * assert<Enum>Transition guard'ı import edilir -> AI fill'i illegal geçişi
   * (pending->delivered atlaması) reddeder. Geçiş kuralı YOK enum -> import yok. */
  it("status-güncelleyen servis -> geçişli enum'un assert<Enum>Transition'ını import eder", () => {
    const orderStatus = node("Enum", "e2e2e2e2-2222-4222-8222-e2e2e2e2e2e2", {
      Name: "OrderStatus",
      Description: "Sipariş durumu",
      BackingType: "string",
      Values: [{ Key: "PENDING" }, { Key: "CONFIRMED" }],
      Transitions: [{ From: "PENDING", To: ["CONFIRMED"] }],
    });
    const orderSvc = node("Service", SVC, {
      ServiceName: "OrderService",
      Description: "sipariş iş mantığı",
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

  it("geçiş kuralı YOK enum -> status servisi guard import ETMEZ", () => {
    const plainStatus = node("Enum", "e3e3e3e3-3333-4333-8333-e3e3e3e3e3e3", {
      Name: "OrderStatus",
      Description: "durum",
      BackingType: "string",
      Values: [{ Key: "PENDING" }, { Key: "CONFIRMED" }],
      // Transitions YOK.
    });
    const orderSvc = node("Service", SVC, {
      ServiceName: "OrderService",
      Description: "sipariş",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [{ MethodName: "UpdateStatus", Visibility: "public", Parameters: [], ReturnType: "OrderResponse", IsAsync: true, Throws: [] }],
    });
    const ctx = ctxFrom([orderSvc, plainStatus], []);
    const [file] = emitService(ctx.graph.byId(SVC)!, ctx);
    expect(file.content).not.toContain("assertOrderStatusTransition");
  });

  /* ── EDGE-CASE: kayıp ref + boş koleksiyon — ASLA throw etmez ──────────── */
  it("edge-case: kayıp DTO/Exception ref + boş Dependencies — throw etmez, ham tip kullanır", () => {
    const lonelyService = node("Service", SVC, {
      ServiceName: "LonelyService",
      Description: "Bağımlılıksız servis",
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
          Description: "Kayıp ref'ler ham tipe düşmeli.",
        },
      ],
    });
    // Hiçbir ref'i çözen node yok; yalnız servisin kendisi graph'ta.
    const ctx = ctxFrom([lonelyService], []);
    let file: { content: string; surgicalMarkers: number; path: string } | undefined;
    expect(() => {
      file = emitService(ctx.graph.byId(SVC)!, ctx)[0];
    }).not.toThrow();
    // Controller yok → Service kendi adından feature türer ("lonely"); dosya adı
    // rol son-ekini ("Service") TEKRARLAMAZ.
    expect(file!.path).toBe("lonely/lonely.service.ts");
    // Constructor yok (boş DI), parametre tipi ham "string"e düşmüş.
    expect(file!.content).not.toContain("constructor(");
    // public metot -> async (NestJS idiom + await-sync güvenlik ağı); ham ReturnType Promise'le sarılır.
    expect(file!.content).toContain("async ping(raw: string): Promise<boolean> {");
    // Kayıp ReturnDtoRef -> ham ReturnType (Promise<> içinde).
    expect(file!.content).toContain("): Promise<boolean> {");
    // Çözülemeyen exception artık SENTETİK dosyadan import edilir (exception-synthesis
    // bildirilmiş-ama-tanımsız Throws'u üretir → fill `throw new Ghost...` derlenir, TS2304 yok).
    expect(file!.content).toContain('import { GhostException } from "../common/exceptions/ghost.exception";');
    expect(file!.content).toContain("// throws: GhostException");
    expect(file!.surgicalMarkers).toBe(1);
  });
});
