import { describe, it, expect } from "vitest";
import { emitController } from "./controller.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";

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

function edge(kind: StoredEdge["kind"], source: string, target: string, id: string): StoredEdge {
  return {
    id,
    projectId: PROJECT,
    sourceNodeId: source,
    targetNodeId: target,
    kind,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    properties: { IsAsync: false },
  };
}

function ctxFor(nodes: StoredNode[], edges: StoredEdge[]): EmitterContext {
  return { graph: buildCodeGraph(nodes, edges), target: "nestjs" };
}

const CTRL_ID = "c1111111-1111-4111-8111-111111111111";
const SVC_ID = "53333333-3333-4333-8333-333333333333";
const CREATE_DTO_ID = "d4444444-4444-4444-8444-444444444444";
const USER_DTO_ID = "d5555555-5555-4555-8555-555555555555";

const USERS_SERVICE = node("Service", SVC_ID, {
  ServiceName: "UsersService",
  Description: "Kullanıcı iş mantığı",
  IsTransactionScoped: false,
  Methods: [{ MethodName: "create", Visibility: "public", Parameters: [], ReturnType: "User", IsAsync: true, Throws: [] }],
  Dependencies: [],
});

const CREATE_USER_DTO = node("DTO", CREATE_DTO_ID, {
  Name: "CreateUserDto",
  Description: "Yeni kullanıcı girdisi",
  Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false }],
});

const USER_DTO = node("DTO", USER_DTO_ID, {
  Name: "UserDto",
  Description: "Kullanıcı çıktısı",
  Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
});

const USERS_CONTROLLER = node("Controller", CTRL_ID, {
  ControllerName: "UsersController",
  Description: "Kullanıcı HTTP yüzeyi",
  BaseRoute: "users",
  Version: "v1",
  Endpoints: [
    {
      HttpMethod: "GET",
      Route: ":id",
      RequiresAuth: true,
      RequiredRoles: ["admin"],
      PathParams: [{ Name: "id", Type: "string" }],
      QueryParams: [{ Name: "expand", Type: "string", Required: false }],
      StatusCodes: [{ Code: 200 }],
      ResponseDTORef: "UserDto",
      MiddlewareRefs: [],
    },
    {
      HttpMethod: "POST",
      Route: "/",
      RequiresAuth: false,
      RequiredRoles: [],
      PathParams: [],
      QueryParams: [],
      StatusCodes: [{ Code: 201 }],
      RequestDTORef: "CreateUserDto",
      ResponseDTORef: "UserDto",
      MiddlewareRefs: [],
    },
  ],
});

describe("emitController", () => {
  it("tam controller — snapshot", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE, CREATE_USER_DTO, USER_DTO], [
      edge("CALLS", CTRL_ID, SVC_ID, "e1111111-1111-4111-8111-111111111111"),
    ]);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
      import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
      import { type AuthUser, CurrentUser } from "../shared/decorators/current-user.decorator";
      import { Roles } from "../shared/decorators/roles.decorator";
      import { AuthGuard } from "../shared/guards/auth.guard";
      import { RolesGuard } from "../shared/guards/roles.guard";
      import { CreateUserDto } from "./dto/create-user.dto";
      import { UserDto } from "./dto/user.dto";
      import { UsersService } from "./users.service";

      /** Kullanıcı HTTP yüzeyi */
      @ApiTags("UsersController")
      @Controller("v1/users")
      export class UsersController {
        constructor(
          private readonly usersService: UsersService
        ) {}

        @Post()
        @HttpCode(201)
        @ApiOperation({ summary: "POST /" })
        @ApiResponse({ status: 201, type: UserDto })
        async post(
          @Body() dto: CreateUserDto,
        ): Promise<UserDto> {
          // @solarch:surgical id=c1111111-1111-4111-8111-111111111111#post
          // Handles the POST / endpoint.
          // Delegation hint: this.usersService.<?>(...).
          // Input DTO: CreateUserDto.
          // deps: usersService
          throw new Error("NOT_IMPLEMENTED: UsersController.post");
        }

        @Get(":id")
        @HttpCode(200)
        @UseGuards(AuthGuard, RolesGuard)
        @Roles("admin")
        @ApiBearerAuth()
        @ApiOperation({ summary: "GET :id" })
        @ApiResponse({ status: 200, type: UserDto })
        async getById(
          @Param("id") id: string,
          @CurrentUser() user: AuthUser,
          @Query("expand") expand?: string,
        ): Promise<UserDto> {
          // @solarch:surgical id=c1111111-1111-4111-8111-111111111111#getById
          // Handles the GET :id endpoint.
          // Delegation hint: this.usersService.<?>(...).
          // Authenticated user available as 'user' (e.g. user.id).
          // deps: usersService
          throw new Error("NOT_IMPLEMENTED: UsersController.getById");
        }
      }
      ",
        "language": "typescript",
        "path": "users/users.controller.ts",
        "surgicalMarkers": 2,
      }
    `);
  });

  it("gövde-alan write endpoint'i RequestDTORef'siz -> genel @Body() body bağlanır (fill serbest değişken UYDURMAZ)", () => {
    // POST RequestDTORef OLMADAN: eskiden hiç body param bağlanmaz, surgical fill
    // body alanlarını (productId/quantity) serbest değişken sanıp TS2304 üretirdi.
    // Genel `@Body() body: Record<string, unknown>` bağla -> fill body.<name>'den okur.
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "CartController",
      Description: "Sepet",
      BaseRoute: "cart",
      Endpoints: [
        {
          HttpMethod: "POST",
          Route: "items",
          RequiresAuth: true,
          RequiredRoles: [],
          PathParams: [],
          QueryParams: [],
          StatusCodes: [{ Code: 200 }],
          // RequestDTORef YOK
          ResponseDTORef: "UserDto",
          MiddlewareRefs: [],
        },
      ],
    });
    const ctx = ctxFor([ctrl, USERS_SERVICE, USER_DTO], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("@Body() body: Record<string, unknown>");
    expect(file.content).toContain('import { Body, Controller');
    // Fill hint body'nin tipsiz erişilebilir olduğunu söyler.
    expect(file.content).toMatch(/body.*untyped|untyped.*body/i);
  });

  it("DI servisini CALLS edge'inden çözer ve import eder", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE, CREATE_USER_DTO, USER_DTO], [
      edge("CALLS", CTRL_ID, SVC_ID, "e1111111-1111-4111-8111-111111111111"),
    ]);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("private readonly usersService: UsersService");
    expect(file.content).toContain('import { UsersService } from "./users.service";');
  });

  it("Version BaseRoute'a önek olur", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain('@Controller("v1/users")');
  });

  it("RequiresAuth -> @UseGuards(AuthGuard) + stub import", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE, USER_DTO], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    // USERS_CONTROLLER :id endpoint'i hem auth hem roles taşır -> @UseGuards(AuthGuard, RolesGuard).
    expect(file.content).toMatch(/@UseGuards\(AuthGuard/);
    expect(file.content).toContain('import { AuthGuard } from "../shared/guards/auth.guard";');
  });

  /* ── RBAC WIRE (#39): @Roles route'una RolesGuard bağlanır ───────────────
   * Eskiden @Roles metadata yazılıyordu ama hiçbir guard okumuyordu (ölü RBAC).
   * Artık RequiredRoles olan endpoint @UseGuards'a RolesGuard ekler — Reflector ile
   * ROLES_KEY metadata'sını okuyup enforce eden gerçek guard (scaffold üretir). */
  it("RequiredRoles -> @UseGuards(AuthGuard, RolesGuard) + RolesGuard import + @Roles", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "AdminController",
      Description: "yönetim",
      BaseRoute: "admin",
      Endpoints: [
        {
          HttpMethod: "POST", Route: "/", RequiresAuth: true, RequiredRoles: ["admin", "owner"],
          PathParams: [], QueryParams: [], StatusCodes: [{ Code: 201 }], MiddlewareRefs: [],
        },
      ],
    });
    const ctx = ctxFor([ctrl], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toMatch(/@UseGuards\(AuthGuard, RolesGuard\)/);
    expect(file.content).toContain('import { RolesGuard } from "../shared/guards/roles.guard";');
    expect(file.content).toContain('@Roles("admin", "owner")');
  });

  it("her gövde-gerektiren metotta surgical marker + NOT_IMPLEMENTED var", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE, CREATE_USER_DTO, USER_DTO], [
      edge("CALLS", CTRL_ID, SVC_ID, "e1111111-1111-4111-8111-111111111111"),
    ]);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.surgicalMarkers).toBe(2);
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: UsersController.getById");');
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: UsersController.post");');
  });

  it("DETERMİNİZM: aynı graph iki kez -> byte-identical", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE, CREATE_USER_DTO, USER_DTO], [
      edge("CALLS", CTRL_ID, SVC_ID, "e1111111-1111-4111-8111-111111111111"),
    ]);
    const a = emitController(ctx.graph.byId(CTRL_ID)!, ctx)[0].content;
    const b = emitController(ctx.graph.byId(CTRL_ID)!, ctx)[0].content;
    expect(a).toBe(b);
  });

  it("içerik tek satır sonu ile biter", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("path/query param tipleri GEÇERLİ TS'e normalize edilir (uuid/int/long -> string/number)", () => {
    const typed = node("Controller", CTRL_ID, {
      ControllerName: "ItemsController",
      Description: "tipli paramlar",
      BaseRoute: "items",
      Endpoints: [
        {
          HttpMethod: "GET",
          Route: ":id",
          RequiresAuth: false,
          RequiredRoles: [],
          PathParams: [{ Name: "id", Type: "uuid" }],
          QueryParams: [
            { Name: "count", Type: "int", Required: false },
            { Name: "since", Type: "datetime", Required: false },
          ],
          StatusCodes: [{ Code: 200 }],
          MiddlewareRefs: [],
        },
      ],
    });
    const ctx = ctxFor([typed], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    // uuid -> string, int -> number, datetime -> Date (ham 'uuid'/'int' GEÇERSİZ TS idi).
    expect(file.content).toContain('@Param("id") id: string');
    expect(file.content).toContain('@Query("count") count?: number');
    expect(file.content).toContain('@Query("since") since?: Date');
    expect(file.content).not.toContain(": uuid");
    expect(file.content).not.toContain(": int");
  });

  /* ── EDGE-CASE: servissiz controller + kayıp DTO ref + boş StatusCodes ── */
  it("CALLS edge yoksa constructor üretilmez; kayıp DTO ref TODO bırakır, throw etmez", () => {
    const lonely = node("Controller", CTRL_ID, {
      ControllerName: "PingController",
      Description: "Sağlık",
      BaseRoute: "ping",
      Endpoints: [
        {
          HttpMethod: "POST",
          Route: "/",
          RequiresAuth: false,
          RequiredRoles: [],
          PathParams: [],
          QueryParams: [],
          StatusCodes: [],
          RequestDTORef: "MissingDto",
          MiddlewareRefs: [],
        },
      ],
    });
    const ctx = ctxFor([lonely], []); // hiç service/DTO yok
    expect(() => emitController(ctx.graph.byId(CTRL_ID)!, ctx)).not.toThrow();
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).not.toContain("constructor(");
    expect(file.content).toContain("@Body() dto: unknown");
    expect(file.content).toContain("MissingDto");
    // boş StatusCodes -> @HttpCode yok
    expect(file.content).not.toContain("@HttpCode");
    // delegasyon ipucu yok (servis yok)
    expect(file.content).not.toContain("Delegation hint");
    expect(file.path).toBe("ping/ping.controller.ts");
  });

  /* ── Finding #6: ROUTE SIRASI — statik rota'lar ":param" rota'lardan ÖNCE ── */
  it("statik rota'lar param rota'lardan ÖNCE deklare edilir (Nest eşleşme tuzağı)", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "ProductsController",
      Description: "ürün API",
      BaseRoute: "products",
      Endpoints: [
        // Graph sırası: önce :id (param), SONRA categories (statik) -> Nest'te
        //   "/categories" asla eşleşmezdi. Emitter bunu düzeltmeli.
        {
          HttpMethod: "GET", Route: ":id", RequiresAuth: false, RequiredRoles: [],
          PathParams: [{ Name: "id", Type: "uuid" }], QueryParams: [], StatusCodes: [{ Code: 200 }],
          ResponseDTORef: "ProductDto", MiddlewareRefs: [],
        },
        {
          HttpMethod: "GET", Route: "categories", RequiresAuth: false, RequiredRoles: [],
          PathParams: [], QueryParams: [], StatusCodes: [{ Code: 200 }], MiddlewareRefs: [],
        },
      ],
    });
    const ctx = ctxFor([ctrl], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    const categoriesIdx = file.content.indexOf('@Get("categories")');
    const byIdIdx = file.content.indexOf('@Get(":id")');
    expect(categoriesIdx).toBeGreaterThanOrEqual(0);
    expect(byIdIdx).toBeGreaterThanOrEqual(0);
    // statik "categories" param ":id"'den ÖNCE çıkmalı.
    expect(categoriesIdx).toBeLessThan(byIdIdx);
  });

  it("statik/param sıralaması STABLE — eşit ranklarda graph sırası korunur", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "ItemsController",
      Description: "stable",
      BaseRoute: "items",
      Endpoints: [
        { HttpMethod: "GET", Route: "featured", RequiresAuth: false, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [], MiddlewareRefs: [] },
        { HttpMethod: "GET", Route: ":id", RequiresAuth: false, RequiredRoles: [], PathParams: [{ Name: "id", Type: "string" }], QueryParams: [], StatusCodes: [], MiddlewareRefs: [] },
        { HttpMethod: "GET", Route: "popular", RequiresAuth: false, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [], MiddlewareRefs: [] },
      ],
    });
    const ctx = ctxFor([ctrl], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    const featured = file.content.indexOf('@Get("featured")');
    const popular = file.content.indexOf('@Get("popular")');
    const byId = file.content.indexOf('@Get(":id")');
    // iki statik graph sırasında (featured < popular), ikisi de param'dan önce.
    expect(featured).toBeLessThan(popular);
    expect(popular).toBeLessThan(byId);
  });

  /* ── Finding #7: LİSTE DÖNÜŞ — koleksiyon endpoint'i DTO[] döner ── */
  it("GET + path-param YOK -> koleksiyon: ResponseDTORef DTO[] döner", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "ProductsController",
      Description: "liste",
      BaseRoute: "products",
      Endpoints: [
        // GET /, no path param -> koleksiyon -> ProductDto[].
        { HttpMethod: "GET", Route: "/", RequiresAuth: false, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [{ Code: 200 }], ResponseDTORef: "ProductDto", MiddlewareRefs: [] },
        // GET /:id -> tekil kayıt -> ProductDto (array DEĞİL).
        { HttpMethod: "GET", Route: ":id", RequiresAuth: false, RequiredRoles: [], PathParams: [{ Name: "id", Type: "string" }], QueryParams: [], StatusCodes: [{ Code: 200 }], ResponseDTORef: "ProductDto", MiddlewareRefs: [] },
      ],
    });
    const productDto = node("DTO", "d6666666-6666-4666-8666-666666666666", {
      Name: "ProductDto", Description: "ürün", Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const ctx = ctxFor([ctrl, productDto], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("async get(): Promise<ProductDto[]>");
    // getById tekil döner (array DEĞİL).
    expect(file.content).toMatch(/async getById\([\s\S]*?\): Promise<ProductDto> \{/);
  });

  it("GET /me (self/tekil semantik) -> path-param olmasa da TEKİL DTO (array DEĞİL)", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "AccountController",
      Description: "self",
      BaseRoute: "account",
      Endpoints: [
        { HttpMethod: "GET", Route: "me", RequiresAuth: true, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [{ Code: 200 }], ResponseDTORef: "UserDto", MiddlewareRefs: [] },
      ],
    });
    const ctx = ctxFor([ctrl, USER_DTO], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("Promise<UserDto>");
    expect(file.content).not.toContain("Promise<UserDto[]>");
  });

  it("route list/findAll semantiği -> path-param olsa bile koleksiyon (DTO[])", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "OrdersController",
      Description: "liste-semantiği",
      BaseRoute: "orders",
      Endpoints: [
        // GET /:userId/list -> path param var ama son segment "list" -> koleksiyon.
        { HttpMethod: "GET", Route: ":userId/list", RequiresAuth: false, RequiredRoles: [], PathParams: [{ Name: "userId", Type: "string" }], QueryParams: [], StatusCodes: [], ResponseDTORef: "OrderDto", MiddlewareRefs: [] },
      ],
    });
    const orderDto = node("DTO", "d7777777-7777-4777-8777-777777777777", {
      Name: "OrderDto", Description: "sipariş", Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const ctx = ctxFor([ctrl, orderDto], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("Promise<OrderDto[]>");
  });

  /* ── TEK-KAYNAK KARDİNALİTE: bildirilmiş ReturnsCollection > route sezgisi ──
   * Endpoint'te ReturnsCollection bildirilmişse, controller route şekline DAYALI
   * tahmini (isCollectionEndpoint) DEĞİL bildirilen alanı kullanır. service.emitter
   * ile AYNI tek-kaynak: kanvas iki uca da aynı kararı set eder -> imzalar garantili
   * hizalı. */
  it("ReturnsCollection=true: route tekil-sezgili (GET /:id) olsa bile DTO[] döner", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "ProductsController",
      Description: "bildirilmiş koleksiyon",
      BaseRoute: "products",
      Endpoints: [
        // GET /:id -> route sezgisi TEKİL der (path param var); ama bildirilen true.
        {
          HttpMethod: "GET", Route: ":id", RequiresAuth: false, RequiredRoles: [],
          PathParams: [{ Name: "id", Type: "string" }], QueryParams: [], StatusCodes: [{ Code: 200 }],
          ResponseDTORef: "ProductDto", ReturnsCollection: true, MiddlewareRefs: [],
        },
      ],
    });
    const productDto = node("DTO", "d9999999-9999-4999-8999-999999999999", {
      Name: "ProductDto", Description: "ürün", Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const ctx = ctxFor([ctrl, productDto], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("Promise<ProductDto[]>");
    expect(file.content).not.toContain("Promise<ProductDto> {");
  });

  it("ReturnsCollection=false: route koleksiyon-sezgili (GET /) olsa bile TEKİL döner", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "SummaryController",
      Description: "bildirilmiş tekil",
      BaseRoute: "summary",
      Endpoints: [
        // GET / (path-param yok) -> route sezgisi KOLEKSİYON der; ama bildirilen false.
        {
          HttpMethod: "GET", Route: "/", RequiresAuth: false, RequiredRoles: [],
          PathParams: [], QueryParams: [], StatusCodes: [{ Code: 200 }],
          ResponseDTORef: "ProductDto", ReturnsCollection: false, MiddlewareRefs: [],
        },
      ],
    });
    const productDto = node("DTO", "da999999-9999-4999-8999-999999999999", {
      Name: "ProductDto", Description: "ürün", Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const ctx = ctxFor([ctrl, productDto], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toMatch(/\): Promise<ProductDto> \{/);
    expect(file.content).not.toContain("Promise<ProductDto[]>");
  });

  /* ── Finding #8: AUTH/userId + login token ── */
  it("RequiresAuth -> @CurrentUser() user: AuthUser parametresi + import", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "MeController",
      Description: "kimlik",
      BaseRoute: "me",
      Endpoints: [
        { HttpMethod: "GET", Route: "/", RequiresAuth: true, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [{ Code: 200 }], ResponseDTORef: "UserDto", MiddlewareRefs: [] },
      ],
    });
    const ctx = ctxFor([ctrl, USER_DTO], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("@CurrentUser() user: AuthUser");
    expect(file.content).toContain('import { type AuthUser, CurrentUser } from "../shared/decorators/current-user.decorator";');
    // userId surgical gövdede erişilebilir olduğu marker'da belirtilir.
    expect(file.content).toContain("Authenticated user available as 'user' (e.g. user.id).");
  });

  it("RequiresAuth=false -> @CurrentUser YOK", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "PublicController",
      Description: "açık",
      BaseRoute: "public",
      Endpoints: [
        { HttpMethod: "GET", Route: "ping", RequiresAuth: false, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [], MiddlewareRefs: [] },
      ],
    });
    const ctx = ctxFor([ctrl], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).not.toContain("@CurrentUser");
    expect(file.content).not.toContain("AuthUser");
  });

  it("login endpoint (ResponseDTORef yok) -> Promise<AuthResponse> (void değil)", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "AuthController",
      Description: "auth",
      BaseRoute: "auth",
      Endpoints: [
        { HttpMethod: "POST", Route: "login", RequestDTORef: "LoginDto", RequiresAuth: false, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [{ Code: 200 }], MiddlewareRefs: [] },
      ],
    });
    const loginDto = node("DTO", "d8888888-8888-4888-8888-888888888888", {
      Name: "LoginDto", Description: "giriş", Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const ctx = ctxFor([ctrl, loginDto], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("Promise<AuthResponse>");
    expect(file.content).toContain('import type { AuthResponse } from "../shared/decorators/current-user.decorator";');
    expect(file.content).not.toContain("): Promise<void>");
  });

  /* ── Task 6: @nestjs/swagger decorators (self-documenting generated app) ──
   * Generated controllers now carry OpenAPI decorators: @ApiTags on the class,
   * @ApiOperation + @ApiResponse per endpoint, @ApiBearerAuth when RequiresAuth.
   * The response DTO is referenced as a RUNTIME value (`type: Dto`) so its import
   * must be a value import (not `import type`). */
  it("emits @nestjs/swagger decorators: @ApiTags on class + @ApiOperation/@ApiResponse per endpoint + @ApiBearerAuth on auth", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE, CREATE_USER_DTO, USER_DTO], [
      edge("CALLS", CTRL_ID, SVC_ID, "e1111111-1111-4111-8111-111111111111"),
    ]);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    // class-level API group tag
    expect(file.content).toContain('@ApiTags("UsersController")');
    // per-endpoint operation + response decorators
    expect(file.content).toContain("@ApiOperation(");
    expect(file.content).toContain("@ApiResponse(");
    // GET :id is RequiresAuth=true -> bearer marker present
    expect(file.content).toContain("@ApiBearerAuth()");
    // swagger symbols imported. ImportCollector sorts symbols alphabetically, so
    // assert membership (order-agnostic) rather than a fixed symbol order.
    const swagger = file.content.match(/import \{([^}]*)\} from "@nestjs\/swagger";/);
    expect(swagger, "expected a @nestjs/swagger import line").toBeTruthy();
    const symbols = swagger![1];
    for (const sym of ["ApiTags", "ApiOperation", "ApiResponse", "ApiBearerAuth"]) {
      expect(symbols).toContain(sym);
    }
    // @ApiResponse references the resolved response DTO as a runtime type reference.
    expect(file.content).toMatch(/@ApiResponse\(\{ status: 201[^}]*type: UserDto/);
    // ...so the response DTO is a VALUE import, not `import type`.
    expect(file.content).toContain('import { UserDto } from "./dto/user.dto";');
  });

  it("public endpoint (RequiresAuth=false) gets @ApiOperation but no @ApiBearerAuth", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "PublicController",
      Description: "public surface",
      BaseRoute: "public",
      Endpoints: [
        { HttpMethod: "GET", Route: "ping", RequiresAuth: false, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [{ Code: 200 }], MiddlewareRefs: [] },
      ],
    });
    const ctx = ctxFor([ctrl], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("@ApiOperation(");
    expect(file.content).not.toContain("@ApiBearerAuth");
  });

  it("DETERMİNİZM: route-sıra + auth + array fix sonrası byte-identical", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "MixController",
      Description: "karışık",
      BaseRoute: "mix",
      Endpoints: [
        { HttpMethod: "GET", Route: ":id", RequiresAuth: true, RequiredRoles: [], PathParams: [{ Name: "id", Type: "string" }], QueryParams: [], StatusCodes: [], ResponseDTORef: "UserDto", MiddlewareRefs: [] },
        { HttpMethod: "GET", Route: "/", RequiresAuth: false, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [], ResponseDTORef: "UserDto", MiddlewareRefs: [] },
      ],
    });
    const ctx = ctxFor([ctrl, USER_DTO], []);
    const a = emitController(ctx.graph.byId(CTRL_ID)!, ctx)[0].content;
    const b = emitController(ctx.graph.byId(CTRL_ID)!, ctx)[0].content;
    expect(a).toBe(b);
  });
});
