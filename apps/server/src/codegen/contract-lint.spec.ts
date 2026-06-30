import { describe, it, expect } from "vitest";
import { lintContracts } from "./contract-lint";
import { buildCodeGraph } from "./ir";
import type { StoredNode } from "../nodes/nodes.repository";

/* ── Fixture yardimcisi ─────────────────────────────────────────────────── */
function node(type: StoredNode["type"], id: string, properties: Record<string, unknown>): StoredNode {
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

const ep = (over: Record<string, unknown>) => ({
  HttpMethod: "POST",
  Route: "/",
  RequiresAuth: false,
  RequiredRoles: [],
  PathParams: [],
  QueryParams: [],
  StatusCodes: [],
  MiddlewareRefs: [],
  ...over,
});

const CTRL = "c0000000-0000-4000-8000-000000000001";

describe("lintContracts", () => {
  it("RequestDTORef'siz write endpoint (POST) -> uyari (controller + metot + route)", () => {
    const ctrl = node("Controller", CTRL, {
      ControllerName: "CategoryController",
      Description: "kategori",
      BaseRoute: "categories",
      Endpoints: [ep({ HttpMethod: "POST", Route: "/" })],
    });
    const warnings = lintContracts(buildCodeGraph([ctrl], []));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CategoryController");
    expect(warnings[0]).toContain("POST");
    expect(warnings[0]).toMatch(/RequestDTORef|request body|input DTO/i);
  });

  it("PUT ve PATCH de govde-alan write -> RequestDTORef'siz uyari", () => {
    const ctrl = node("Controller", CTRL, {
      ControllerName: "OrderController",
      Description: "order",
      BaseRoute: "orders",
      Endpoints: [
        // PathParam verilir -> route-param kurali tetiklenmez; yalniz RequestDTORef'siz body kurali.
        ep({ HttpMethod: "PUT", Route: ":id", PathParams: [{ Name: "id", Type: "string" }] }),
        ep({ HttpMethod: "PATCH", Route: ":id/status", PathParams: [{ Name: "id", Type: "string" }] }),
      ],
    });
    expect(lintContracts(buildCodeGraph([ctrl], []))).toHaveLength(2);
  });

  it("RequestDTORef OLAN write -> uyari yok; GET/DELETE (govdesiz) -> uyari yok", () => {
    const ctrl = node("Controller", CTRL, {
      ControllerName: "ProductController",
      Description: "urun",
      BaseRoute: "products",
      Endpoints: [
        ep({ HttpMethod: "POST", Route: "/", RequestDTORef: "CreateProductDto" }),
        ep({ HttpMethod: "GET", Route: "/" }),
        ep({ HttpMethod: "DELETE", Route: ":id", PathParams: [{ Name: "id", Type: "string" }] }),
      ],
    });
    // CreateProductDto gercek bir DTO node'u (dangling-ref kurali tetiklenmesin).
    const dto = node("DTO", "db300000-0000-4000-8000-000000000001", {
      Name: "CreateProductDto",
      Description: "urun girdisi",
      Fields: [{ Name: "name", DataType: "string", IsRequired: true, IsArray: false }],
    });
    expect(lintContracts(buildCodeGraph([ctrl, dto], []))).toHaveLength(0);
  });

  it("RequiredRoles var ama RequiresAuth yok -> uyari (rol auth olmadan enforce edilemez)", () => {
    // RolesGuard request.user.role'e bakar; AuthGuard yoksa request.user set edilmez ->
    // RolesGuard her istegi reddeder -> endpoint erisilemez. Kontrat ihlali.
    const ctrl = node("Controller", CTRL, {
      ControllerName: "AdminController",
      Description: "yonetim",
      BaseRoute: "admin",
      Endpoints: [
        ep({ HttpMethod: "GET", Route: "panel", RequiresAuth: false, RequiredRoles: ["admin"], ResponseDTORef: "PanelDto" }),
      ],
    });
    const warnings = lintContracts(buildCodeGraph([ctrl], []));
    expect(warnings.some((w) => /role/i.test(w) && /auth/i.test(w))).toBe(true);
  });

  it("RequiredRoles + RequiresAuth birlikte -> auth uyarisi NONE", () => {
    const ctrl = node("Controller", CTRL, {
      ControllerName: "AdminController",
      Description: "yonetim",
      BaseRoute: "admin",
      Endpoints: [
        ep({ HttpMethod: "GET", Route: "panel", RequiresAuth: true, RequiredRoles: ["admin"], ResponseDTORef: "PanelDto" }),
      ],
    });
    const warnings = lintContracts(buildCodeGraph([ctrl], []));
    expect(warnings.some((w) => /role/i.test(w) && /auth/i.test(w))).toBe(false);
  });

  it("route param'i eslesen PathParam'siz -> uyari (handler okuyamaz)", () => {
    // GET /:id ama PathParams bos -> @Param("id") uretilmez, handler id'yi okuyamaz.
    const dto = node("DTO", "da100000-0000-4000-8000-000000000001", {
      Name: "OrderDto",
      Description: "order",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const ctrl = node("Controller", CTRL, {
      ControllerName: "OrderController",
      Description: "order",
      BaseRoute: "orders",
      Endpoints: [ep({ HttpMethod: "GET", Route: ":id", PathParams: [], ResponseDTORef: "OrderDto" })],
    });
    const warnings = lintContracts(buildCodeGraph([ctrl, dto], []));
    expect(warnings.some((w) => /route parameter/i.test(w) && /\bid\b/.test(w))).toBe(true);
  });

  it("PathParam route'la eslesince -> route-param uyarisi NONE", () => {
    const dto = node("DTO", "da200000-0000-4000-8000-000000000001", {
      Name: "OrderDto",
      Description: "order",
      Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const ctrl = node("Controller", CTRL, {
      ControllerName: "OrderController",
      Description: "order",
      BaseRoute: "orders",
      Endpoints: [ep({ HttpMethod: "GET", Route: ":id", PathParams: [{ Name: "id", Type: "string" }], ResponseDTORef: "OrderDto" })],
    });
    const warnings = lintContracts(buildCodeGraph([ctrl, dto], []));
    expect(warnings.some((w) => /route parameter/i.test(w))).toBe(false);
  });

  it("cozulemeyen DTO ref (Request/Response) -> uyari (var olmayan DTO)", () => {
    const ctrl = node("Controller", CTRL, {
      ControllerName: "ProductController",
      Description: "urun",
      BaseRoute: "products",
      Endpoints: [
        ep({ HttpMethod: "POST", Route: "/", RequestDTORef: "GhostInput", ResponseDTORef: "GhostOutput" }),
      ],
    });
    // GhostInput/GhostOutput DTO node'u NONE -> dangling ref.
    const warnings = lintContracts(buildCodeGraph([ctrl], []));
    expect(warnings.some((w) => /GhostInput/.test(w) && /exist|resolve/i.test(w))).toBe(true);
    expect(warnings.some((w) => /GhostOutput/.test(w))).toBe(true);
  });

  it("Repository EntityReference cozulemezse -> uyari (Repository<any> fallback)", () => {
    const repo = node("Repository", "dc100000-0000-4000-8000-000000000001", {
      RepositoryName: "GhostRepository",
      Description: "baglantisiz",
      EntityReference: "Phantom",
      IsCached: false,
      CustomQueries: [],
    });
    const warnings = lintContracts(buildCodeGraph([repo], []));
    expect(warnings.some((w) => /Phantom/.test(w) && /resolve|Model or Table|exist/i.test(w))).toBe(true);
  });

  it("Service Dependency Ref cozulemezse -> uyari (import'suz inject)", () => {
    const svc = node("Service", "dc200000-0000-4000-8000-000000000001", {
      ServiceName: "OrderService",
      Description: "order",
      IsTransactionScoped: false,
      Methods: [{ MethodName: "doThing", Visibility: "public", Parameters: [], ReturnType: "void", IsAsync: true, Throws: [] }],
      Dependencies: [{ Kind: "Repository", Ref: "GhostRepo" }],
    });
    const warnings = lintContracts(buildCodeGraph([svc], []));
    expect(warnings.some((w) => /GhostRepo/.test(w) && /resolve|exist/i.test(w))).toBe(true);
  });

  it("Kural 6: DTO zorunlu alani NULLABLE kolondan besleniyor -> uyari; NOT NULL/optional -> uyari yok", () => {
    const table = node("Table", "dt100000-0000-4000-8000-000000000001", {
      TableName: "Videos",
      Description: "videolar",
      Columns: [
        { Name: "Id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: false, AutoIncrement: false },
        { Name: "Title", DataType: "VARCHAR", IsPrimaryKey: false, IsNotNull: true, IsUnique: false, AutoIncrement: false },
        { Name: "VideoUrl", DataType: "VARCHAR", IsPrimaryKey: false, IsNotNull: false, IsUnique: false, AutoIncrement: false },
      ],
    });
    const dto = node("DTO", "dd100000-0000-4000-8000-000000000001", {
      Name: "VideoDTO",
      Description: "video ciktisi",
      Fields: [
        { Name: "Title", DataType: "string", IsRequired: true, IsArray: false }, // NOT NULL → uyari yok
        { Name: "VideoUrl", DataType: "string", IsRequired: true, IsArray: false }, // nullable kolon + zorunlu → UYARI
        { Name: "Description", DataType: "string", IsRequired: false, IsArray: false }, // optional → uyari yok
      ],
    });
    const warnings = lintContracts(buildCodeGraph([table, dto], []));
    const nullWarn = warnings.filter((w) => /is required but its source column/.test(w));
    expect(nullWarn).toHaveLength(1);
    expect(nullWarn[0]).toContain("VideoDTO.VideoUrl");
    expect(nullWarn[0]).toContain("Videos.VideoUrl");
  });

  it("Kural 6: entity-bagli olmayan DTO (eslesen tablo yok) -> nullability uyarisi yok", () => {
    const dto = node("DTO", "dd200000-0000-4000-8000-000000000001", {
      Name: "LoginRequestDTO",
      Description: "giris",
      Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false }],
    });
    const warnings = lintContracts(buildCodeGraph([dto], []));
    expect(warnings.some((w) => /is required but its source column/.test(w))).toBe(false);
  });

  it("DETERMINISM: uyarilar sirali + tekrar uretimde ayni", () => {
    const ctrl = node("Controller", CTRL, {
      ControllerName: "MixController",
      Description: "karisik",
      BaseRoute: "mix",
      Endpoints: [
        ep({ HttpMethod: "POST", Route: "zeta" }),
        ep({ HttpMethod: "POST", Route: "alpha" }),
      ],
    });
    const a = lintContracts(buildCodeGraph([ctrl], []));
    const b = lintContracts(buildCodeGraph([ctrl], []));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(a);
  });
});
