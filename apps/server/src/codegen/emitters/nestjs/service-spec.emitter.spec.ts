import { describe, it, expect } from "vitest";
import { emitServiceSpecs } from "./service-spec.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ── Fixture yardımcıları (service.emitter.spec.ts ile aynı şekil) ───────── */
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
    properties: {},
  };
}

function ctxFrom(nodes: StoredNode[], edges: StoredEdge[]): EmitterContext {
  return { graph: buildCodeGraph(nodes, edges), target: "nestjs" };
}

/* ── ID'ler ─────────────────────────────────────────────────────────────── */
const SVC = "10000000-0000-4000-8000-000000000001";
const REPO = "10000000-0000-4000-8000-000000000002";
const DEP_SVC = "10000000-0000-4000-8000-000000000003";

/* ── Node fixture'ları ──────────────────────────────────────────────────── */
const usersRepository = node("Repository", REPO, {
  RepositoryName: "UsersRepository",
  EntityReference: "User",
  CustomQueries: [
    { QueryName: "findByEmail", Parameters: [], ReturnType: "User" },
    { QueryName: "countActive", Parameters: [], ReturnType: "number" },
  ],
});

const paymentService = node("Service", DEP_SVC, {
  ServiceName: "PaymentService",
  Description: "Payment side service",
  IsTransactionScoped: false,
  Dependencies: [],
  Methods: [
    { MethodName: "charge", Visibility: "public", Parameters: [], ReturnType: "void", IsAsync: true },
    { MethodName: "internalHelper", Visibility: "private", Parameters: [], ReturnType: "void", IsAsync: false },
  ],
});

const usersService = node("Service", SVC, {
  ServiceName: "UsersService",
  Description: "User business logic",
  IsTransactionScoped: true,
  Dependencies: [
    { Kind: "Repository", Ref: "UsersRepository" },
    { Kind: "Service", Ref: "PaymentService" },
  ],
  Methods: [
    {
      MethodName: "createUser",
      Visibility: "public",
      Parameters: [{ Name: "input", Type: "unknown", Optional: false, DtoRef: "CreateUserDto" }],
      ReturnType: "User",
      ReturnDtoRef: "UserDto",
      IsAsync: true,
      Throws: [],
      Description: "Creates a new user.",
    },
    {
      MethodName: "validateNow",
      Visibility: "public",
      Parameters: [],
      ReturnType: "boolean",
      IsAsync: false,
      Throws: [],
    },
    {
      MethodName: "secretInternal",
      Visibility: "private",
      Parameters: [],
      ReturnType: "void",
      IsAsync: false,
      Throws: [],
    },
  ],
});

const fullNodes = [usersService, usersRepository, paymentService];

describe("emitServiceSpecs", () => {
  it("tam davranış iskeleti — snapshot (mock provider'lar + per-metot delegasyon TODO)", () => {
    const ctx = ctxFrom(fullNodes, []);
    const files = emitServiceSpecs(ctx);
    // İki Service var (UsersService + PaymentService) -> iki spec.
    const usersSpec = files.find((f) => f.path === "users/users.service.spec.ts");
    expect(usersSpec).toBeDefined();
    expect(usersSpec!.content).toMatchInlineSnapshot(`
      "import { Test, TestingModule } from "@nestjs/testing";
      import { PaymentService } from "../payment/payment.service";
      import { UsersRepository } from "./users.repository";
      import { UsersService } from "./users.service";

      /** Behavior test skeleton for UsersService (Solarch-generated). */
      describe("UsersService", () => {
        let usersService: UsersService;

        // Mocked dependencies — delegated methods are jest.fn() so calls can be asserted.
        const paymentService = { charge: jest.fn() };
        const usersRepository = { countActive: jest.fn(), findByEmail: jest.fn() };

        beforeEach(async () => {
          jest.clearAllMocks();
          const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
              UsersService,
              { provide: PaymentService, useValue: paymentService as unknown as PaymentService },
              { provide: UsersRepository, useValue: usersRepository as unknown as UsersRepository },
            ],
          }).compile();

          usersService = moduleRef.get<UsersService>(UsersService);
        });

        it("is defined (DI resolves)", () => {
          expect(usersService).toBeDefined();
        });

        describe("createUser", () => {
          // Behavior skeleton — un-skip and replace the comments with real
          // arrange/act/assert once you've reviewed the filled method body.
          it.skip("delegates to its dependencies", () => {
            // Arrange: stub the calls this method should delegate to, e.g.
            //   paymentService.charge.mockResolvedValue(undefined as never);
            //   usersRepository.countActive.mockResolvedValue(undefined as never);
            //   usersRepository.findByEmail.mockResolvedValue(undefined as never);
            // Act:
            //   const result = await usersService.createUser(/* input */);
            // Assert: replace with real delegation/return assertions, e.g.
            //   expect(paymentService.charge).toHaveBeenCalled();
            //   expect(usersRepository.countActive).toHaveBeenCalled();
            //   expect(usersRepository.findByEmail).toHaveBeenCalled();
          });
        });

        describe("validateNow", () => {
          // Behavior skeleton — un-skip and replace the comments with real
          // arrange/act/assert once you've reviewed the filled method body.
          it.skip("delegates to its dependencies", () => {
            // Arrange: stub the calls this method should delegate to, e.g.
            //   paymentService.charge.mockResolvedValue(undefined as never);
            //   usersRepository.countActive.mockResolvedValue(undefined as never);
            //   usersRepository.findByEmail.mockResolvedValue(undefined as never);
            // Act:
            //   const result = usersService.validateNow();
            // Assert: replace with real delegation/return assertions, e.g.
            //   expect(paymentService.charge).toHaveBeenCalled();
            //   expect(usersRepository.countActive).toHaveBeenCalled();
            //   expect(usersRepository.findByEmail).toHaveBeenCalled();
          });
        });
      });
      "
    `);
  });

  it("yalnız PUBLIC metotlar test edilir (private/protected dış API değil)", () => {
    const ctx = ctxFrom(fullNodes, []);
    const usersSpec = emitServiceSpecs(ctx).find((f) => f.path === "users/users.service.spec.ts")!;
    expect(usersSpec.content).toContain('describe("createUser", () =>');
    expect(usersSpec.content).toContain('describe("validateNow", () =>');
    // private metot için ne describe ne çağrı üretilir.
    expect(usersSpec.content).not.toContain('describe("secretInternal"');
    expect(usersSpec.content).not.toContain("secretInternal(");
  });

  it("davranış iskeleti: her public metot bir it.skip bloğu (bayat stub assert'i YOK)", () => {
    const ctx = ctxFrom(fullNodes, []);
    const usersSpec = emitServiceSpecs(ctx).find((f) => f.path === "users/users.service.spec.ts")!;
    // Her metot ATLANMIŞ iskelet (it.skip) -> dolu metot jest'i KIRMAZ.
    expect(usersSpec.content).toContain('it.skip("delegates to its dependencies", () => {');
    // act ipucu yorum olarak: async metot -> await; sync -> await yok.
    expect(usersSpec.content).toContain("//   const result = await usersService.createUser(/* input */);");
    expect(usersSpec.content).toContain("//   const result = usersService.validateNow();");
    // Eski stub-sözleşmesi assert'i KALMADI (metot dolunca bayatlayıp fail ederdi).
    expect(usersSpec.content).not.toContain("NOT_IMPLEMENTED");
    expect(usersSpec.content).not.toContain(".rejects.toThrow");
    // Tek AKTİF assert: DI-resolves smoke'undaki toBeDefined.
    const definedOnly = usersSpec.content.split("toBeDefined").length - 1;
    expect(definedOnly).toBe(1);
  });

  it("delegasyon iskeleti: her mock metodu için arrange + assert ipucu (yorum)", () => {
    const ctx = ctxFrom(fullNodes, []);
    const usersSpec = emitServiceSpecs(ctx).find((f) => f.path === "users/users.service.spec.ts")!;
    // Arrange ipucu (mockResolvedValue) + assert ipucu (toHaveBeenCalled) yorum olarak.
    expect(usersSpec.content).toContain("//   usersRepository.findByEmail.mockResolvedValue(undefined as never);");
    expect(usersSpec.content).toContain("//   expect(usersRepository.findByEmail).toHaveBeenCalled();");
    expect(usersSpec.content).toContain("//   expect(paymentService.charge).toHaveBeenCalled();");
    expect(usersSpec.content).toContain("// Behavior skeleton — un-skip");
  });

  it("mock provider'lar gerçek public metot adlarından kurulur (Service.Methods / Repository.CustomQueries)", () => {
    const ctx = ctxFrom(fullNodes, []);
    const usersSpec = emitServiceSpecs(ctx).find((f) => f.path === "users/users.service.spec.ts")!;
    // Repository mock'u CustomQueries'ten (countActive, findByEmail), isme sıralı.
    expect(usersSpec.content).toContain("const usersRepository = { countActive: jest.fn(), findByEmail: jest.fn() };");
    // Service mock'u yalnız PUBLIC metottan (charge; private internalHelper DEĞİL).
    expect(usersSpec.content).toContain("const paymentService = { charge: jest.fn() };");
    expect(usersSpec.content).not.toContain("internalHelper");
    // useValue, sınıf tipine cast'lenir (strict altında DI tip-uyumu).
    expect(usersSpec.content).toContain(
      "{ provide: UsersRepository, useValue: usersRepository as unknown as UsersRepository },",
    );
  });

  it("DI = Dependencies ∪ CALLS hedefleri, DEDUP (aynı repo iki yoldan -> tek mock)", () => {
    // Dependencies'te UsersRepository + CALLS edge ile de aynı repo -> tek mock alanı.
    const ctx = ctxFrom(fullNodes, [edge("e-dup", "CALLS", SVC, REPO)]);
    const usersSpec = emitServiceSpecs(ctx).find((f) => f.path === "users/users.service.spec.ts")!;
    const mockDecls = usersSpec.content.split("const usersRepository = {").length - 1;
    expect(mockDecls).toBe(1);
    const providerLines = usersSpec.content.split("{ provide: UsersRepository,").length - 1;
    expect(providerLines).toBe(1);
  });

  it("bağımlılıksız servis: constructor mock yok, providers tek satır, davranış bloğu yine üretilir", () => {
    const lonely = node("Service", SVC, {
      ServiceName: "LonelyService",
      Description: "No deps",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [
        { MethodName: "ping", Visibility: "public", Parameters: [], ReturnType: "boolean", IsAsync: false, Throws: [] },
      ],
    });
    const ctx = ctxFrom([lonely], []);
    const [spec] = emitServiceSpecs(ctx);
    expect(spec.path).toBe("lonely/lonely.service.spec.ts");
    // Boş DI -> mock bloğu ve jest.clearAllMocks YOK; providers tek satır.
    expect(spec.content).not.toContain("Mocked dependencies");
    expect(spec.content).not.toContain("jest.clearAllMocks();");
    expect(spec.content).toContain("providers: [LonelyService],");
    // Davranış iskeleti yine var (atlanmış it.skip; mock'suz da üretilir).
    expect(spec.content).toContain('describe("ping", () =>');
    expect(spec.content).toContain('it.skip("delegates to its dependencies", () => {');
    expect(spec.content).toContain("//   const result = lonelyService.ping();");
    // Mock yokken arrange ipucu placeholder'a düşer.
    expect(spec.content).toContain("<no resolvable dependencies — inject test doubles as needed>");
  });

  it("metotsuz servis: davranış bloğu yok ama DI-resolves smoke korunur", () => {
    // Şema Methods.min(1) ister ama emitter THROW etmemeli; boş Methods'a dayanıklı.
    const empty = node("Service", SVC, {
      ServiceName: "EmptyService",
      Description: "No methods",
      IsTransactionScoped: false,
      Dependencies: [],
      Methods: [],
    });
    const ctx = ctxFrom([empty], []);
    const [spec] = emitServiceSpecs(ctx);
    expect(spec.content).toContain('it("is defined (DI resolves)"');
    expect(spec.content).not.toContain("delegates to its dependencies");
  });

  it("çözülemeyen bağımlılık ref'i ATLANIR (mock üretilmez -> spec derlenebilir kalır)", () => {
    const svc = node("Service", SVC, {
      ServiceName: "GhostUserService",
      Description: "Has an unresolvable dep",
      IsTransactionScoped: false,
      Dependencies: [{ Kind: "Repository", Ref: "MissingRepository" }],
      Methods: [
        { MethodName: "run", Visibility: "public", Parameters: [], ReturnType: "void", IsAsync: true, Throws: [] },
      ],
    });
    const ctx = ctxFrom([svc], []);
    const [spec] = emitServiceSpecs(ctx);
    // Çözülemeyen ref import edilmez/mocklanmaz.
    expect(spec.content).not.toContain("MissingRepository");
    // Davranış bloğu yine üretilir.
    expect(spec.content).toContain('describe("run", () =>');
  });

  it("içerik tek satır sonu ile biter", () => {
    const ctx = ctxFrom(fullNodes, []);
    const usersSpec = emitServiceSpecs(ctx).find((f) => f.path === "users/users.service.spec.ts")!;
    expect(usersSpec.content.endsWith("});\n")).toBe(true);
    expect(usersSpec.content.endsWith("});\n\n")).toBe(false);
  });

  it("test dosyaları surgical marker TAŞIMAZ ve nodeId taşımaz", () => {
    const ctx = ctxFrom(fullNodes, []);
    for (const f of emitServiceSpecs(ctx)) {
      expect(f.surgicalMarkers).toBe(0);
      expect(f.nodeId).toBeUndefined();
      expect(f.language).toBe("typescript");
    }
  });

  it("DETERMİNİZM: iki bağımsız graph kuruluşu -> byte-identical", () => {
    const a = emitServiceSpecs(ctxFrom(fullNodes, [edge("e", "CALLS", SVC, REPO)]));
    const b = emitServiceSpecs(ctxFrom(fullNodes, [edge("e", "CALLS", SVC, REPO)]));
    expect(a.map((f) => f.content)).toEqual(b.map((f) => f.content));
  });
});
