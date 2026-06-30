import { describe, it, expect } from "vitest";
import { emitController } from "./controller.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";

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
  Description: "User is mantigi",
  IsTransactionScoped: false,
  Methods: [{ MethodName: "create", Visibility: "public", Parameters: [], ReturnType: "User", IsAsync: true, Throws: [] }],
  Dependencies: [],
});

const CREATE_USER_DTO = node("DTO", CREATE_DTO_ID, {
  Name: "CreateUserDto",
  Description: "Yeni kullanici girdisi",
  Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false }],
});

const USER_DTO = node("DTO", USER_DTO_ID, {
  Name: "UserDto",
  Description: "User ciktisi",
  Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
});

const USERS_CONTROLLER = node("Controller", CTRL_ID, {
  ControllerName: "UsersController",
  Description: "User HTTP yuzeyi",
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

      /** User HTTP yuzeyi */
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

  it("govde-alan write endpoint'i RequestDTORef'siz -> genel @Body() body baglanir (fill serbest degisken UYDURMAZ)", () => {
    // POST RequestDTORef WITHOUT: eskiden hic body param baglanmaz, surgical fill
    // body alanlarini (productId/quantity) serbest degisken sanip TS2304 uretirdi.
    // Genel `@Body() body: Record<string, unknown>` bagla -> fill body.<name>'den okur.
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
          // RequestDTORef NONE
          ResponseDTORef: "UserDto",
          MiddlewareRefs: [],
        },
      ],
    });
    const ctx = ctxFor([ctrl, USERS_SERVICE, USER_DTO], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("@Body() body: Record<string, unknown>");
    expect(file.content).toContain('import { Body, Controller');
    // Fill hint body'nin tipsiz erisilebilir oldugunu soyler.
    expect(file.content).toMatch(/body.*untyped|untyped.*body/i);
  });

  it("DI servisini CALLS edge'inden cozer ve import eder", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE, CREATE_USER_DTO, USER_DTO], [
      edge("CALLS", CTRL_ID, SVC_ID, "e1111111-1111-4111-8111-111111111111"),
    ]);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("private readonly usersService: UsersService");
    expect(file.content).toContain('import { UsersService } from "./users.service";');
  });

  it("Version BaseRoute'a onek olur", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain('@Controller("v1/users")');
  });

  it("RequiresAuth -> @UseGuards(AuthGuard) + stub import", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE, USER_DTO], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    // USERS_CONTROLLER :id endpoint'i hem auth hem roles tasir -> @UseGuards(AuthGuard, RolesGuard).
    expect(file.content).toMatch(/@UseGuards\(AuthGuard/);
    expect(file.content).toContain('import { AuthGuard } from "../shared/guards/auth.guard";');
  });

  /* ── RBAC WIRE (#39): @Roles route'una RolesGuard baglanir ───────────────
   * Eskiden @Roles metadata yaziliyordu ama hicbir guard okumuyordu (olu RBAC).
   * Artik RequiredRoles olan endpoint @UseGuards'a RolesGuard ekler — Reflector ile
   * ROLES_KEY metadata'sini okuyup enforce eden gercek guard (scaffold uretir). */
  it("RequiredRoles -> @UseGuards(AuthGuard, RolesGuard) + RolesGuard import + @Roles", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "AdminController",
      Description: "yonetim",
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

  it("her govde-gerektiren metotta surgical marker + NOT_IMPLEMENTED var", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE, CREATE_USER_DTO, USER_DTO], [
      edge("CALLS", CTRL_ID, SVC_ID, "e1111111-1111-4111-8111-111111111111"),
    ]);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.surgicalMarkers).toBe(2);
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: UsersController.getById");');
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: UsersController.post");');
  });

  it("DETERMINISM: same graph twice -> byte-identical", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE, CREATE_USER_DTO, USER_DTO], [
      edge("CALLS", CTRL_ID, SVC_ID, "e1111111-1111-4111-8111-111111111111"),
    ]);
    const a = emitController(ctx.graph.byId(CTRL_ID)!, ctx)[0].content;
    const b = emitController(ctx.graph.byId(CTRL_ID)!, ctx)[0].content;
    expect(a).toBe(b);
  });

  it("content ends with single newline", () => {
    const ctx = ctxFor([USERS_CONTROLLER, USERS_SERVICE], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("path/query param tipleri GECERLI TS'e normalize edilir (uuid/int/long -> string/number)", () => {
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
    // uuid -> string, int -> number, datetime -> Date (ham 'uuid'/'int' GECERSIZ TS idi).
    expect(file.content).toContain('@Param("id") id: string');
    expect(file.content).toContain('@Query("count") count?: number');
    expect(file.content).toContain('@Query("since") since?: Date');
    expect(file.content).not.toContain(": uuid");
    expect(file.content).not.toContain(": int");
  });

  /* ── EDGE-CASE: servissiz controller + kayip DTO ref + bos StatusCodes ── */
  it("CALLS edge yoksa constructor uretilmez; kayip DTO ref TODO birakir, throw etmez", () => {
    const lonely = node("Controller", CTRL_ID, {
      ControllerName: "PingController",
      Description: "Saglik",
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
    const ctx = ctxFor([lonely], []); // hic service/DTO yok
    expect(() => emitController(ctx.graph.byId(CTRL_ID)!, ctx)).not.toThrow();
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).not.toContain("constructor(");
    expect(file.content).toContain("@Body() dto: unknown");
    expect(file.content).toContain("MissingDto");
    // bos StatusCodes -> @HttpCode yok
    expect(file.content).not.toContain("@HttpCode");
    // delegasyon ipucu yok (servis yok)
    expect(file.content).not.toContain("Delegation hint");
    expect(file.path).toBe("ping/ping.controller.ts");
  });

  /* ── Finding #6: ROUTE SIRASI — statik rota'lar ":param" rota'lardan FIRST ── */
  it("statik rota'lar param rota'lardan FIRST deklare edilir (Nest eslesme tuzagi)", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "ProductsController",
      Description: "urun API",
      BaseRoute: "products",
      Endpoints: [
        // Graph sirasi: once :id (param), AFTER categories (statik) -> Nest'te
        //   "/categories" asla eslesmezdi. Emitter bunu duzeltmeli.
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
    // statik "categories" param ":id"'den FIRST cikmali.
    expect(categoriesIdx).toBeLessThan(byIdIdx);
  });

  it("statik/param siralamasi STABLE — esit ranklarda graph sirasi korunur", () => {
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
    // iki statik graph sirasinda (featured < popular), ikisi de param'dan once.
    expect(featured).toBeLessThan(popular);
    expect(popular).toBeLessThan(byId);
  });

  /* ── Finding #7: LIST RETURN — koleksiyon endpoint'i DTO[] doner ── */
  it("GET + path-param NONE -> koleksiyon: ResponseDTORef DTO[] doner", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "ProductsController",
      Description: "liste",
      BaseRoute: "products",
      Endpoints: [
        // GET /, no path param -> koleksiyon -> ProductDto[].
        { HttpMethod: "GET", Route: "/", RequiresAuth: false, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [{ Code: 200 }], ResponseDTORef: "ProductDto", MiddlewareRefs: [] },
        // GET /:id -> tekil kayit -> ProductDto (array NOT).
        { HttpMethod: "GET", Route: ":id", RequiresAuth: false, RequiredRoles: [], PathParams: [{ Name: "id", Type: "string" }], QueryParams: [], StatusCodes: [{ Code: 200 }], ResponseDTORef: "ProductDto", MiddlewareRefs: [] },
      ],
    });
    const productDto = node("DTO", "d6666666-6666-4666-8666-666666666666", {
      Name: "ProductDto", Description: "urun", Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const ctx = ctxFor([ctrl, productDto], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("async get(): Promise<ProductDto[]>");
    // getById tekil doner (array NOT).
    expect(file.content).toMatch(/async getById\([\s\S]*?\): Promise<ProductDto> \{/);
  });

  it("GET /me (self/tekil semantik) -> path-param olmasa da SINGLE DTO (array NOT)", () => {
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

  it("route list/findAll semantigi -> path-param olsa bile koleksiyon (DTO[])", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "OrdersController",
      Description: "liste-semantigi",
      BaseRoute: "orders",
      Endpoints: [
        // GET /:userId/list -> path param var ama son segment "list" -> koleksiyon.
        { HttpMethod: "GET", Route: ":userId/list", RequiresAuth: false, RequiredRoles: [], PathParams: [{ Name: "userId", Type: "string" }], QueryParams: [], StatusCodes: [], ResponseDTORef: "OrderDto", MiddlewareRefs: [] },
      ],
    });
    const orderDto = node("DTO", "d7777777-7777-4777-8777-777777777777", {
      Name: "OrderDto", Description: "order", Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const ctx = ctxFor([ctrl, orderDto], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("Promise<OrderDto[]>");
  });

  /* ── TEK-SOURCE KARDINALITE: bildirilmis ReturnsCollection > route sezgisi ──
   * Endpoint'te ReturnsCollection bildirilmisse, controller route sekline DAYALI
   * tahmini (isCollectionEndpoint) NOT bildirilen alani kullanir. service.emitter
   * ile AYNI tek-kaynak: kanvas iki uca da ayni karari set eder -> imzalar garantili
   * hizali. */
  it("ReturnsCollection=true: route tekil-sezgili (GET /:id) olsa bile DTO[] doner", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "ProductsController",
      Description: "bildirilmis koleksiyon",
      BaseRoute: "products",
      Endpoints: [
        // GET /:id -> route sezgisi SINGLE der (path param var); ama bildirilen true.
        {
          HttpMethod: "GET", Route: ":id", RequiresAuth: false, RequiredRoles: [],
          PathParams: [{ Name: "id", Type: "string" }], QueryParams: [], StatusCodes: [{ Code: 200 }],
          ResponseDTORef: "ProductDto", ReturnsCollection: true, MiddlewareRefs: [],
        },
      ],
    });
    const productDto = node("DTO", "d9999999-9999-4999-8999-999999999999", {
      Name: "ProductDto", Description: "urun", Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const ctx = ctxFor([ctrl, productDto], []);
    const [file] = emitController(ctx.graph.byId(CTRL_ID)!, ctx);
    expect(file.content).toContain("Promise<ProductDto[]>");
    expect(file.content).not.toContain("Promise<ProductDto> {");
  });

  it("ReturnsCollection=false: route koleksiyon-sezgili (GET /) olsa bile SINGLE doner", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "SummaryController",
      Description: "bildirilmis tekil",
      BaseRoute: "summary",
      Endpoints: [
        // GET / (path-param yok) -> route sezgisi COLLECTION der; ama bildirilen false.
        {
          HttpMethod: "GET", Route: "/", RequiresAuth: false, RequiredRoles: [],
          PathParams: [], QueryParams: [], StatusCodes: [{ Code: 200 }],
          ResponseDTORef: "ProductDto", ReturnsCollection: false, MiddlewareRefs: [],
        },
      ],
    });
    const productDto = node("DTO", "da999999-9999-4999-8999-999999999999", {
      Name: "ProductDto", Description: "urun", Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
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
    // userId surgical govdede erisilebilir oldugu marker'da belirtilir.
    expect(file.content).toContain("Authenticated user available as 'user' (e.g. user.id).");
  });

  it("RequiresAuth=false -> @CurrentUser NONE", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "PublicController",
      Description: "acik",
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

  it("login endpoint (ResponseDTORef yok) -> Promise<AuthResponse> (void degil)", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "AuthController",
      Description: "auth",
      BaseRoute: "auth",
      Endpoints: [
        { HttpMethod: "POST", Route: "login", RequestDTORef: "LoginDto", RequiresAuth: false, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [{ Code: 200 }], MiddlewareRefs: [] },
      ],
    });
    const loginDto = node("DTO", "d8888888-8888-4888-8888-888888888888", {
      Name: "LoginDto", Description: "giris", Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false }],
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

  it("DETERMINISM: route-sira + auth + array fix sonrasi byte-identical", () => {
    const ctrl = node("Controller", CTRL_ID, {
      ControllerName: "MixController",
      Description: "karisik",
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
