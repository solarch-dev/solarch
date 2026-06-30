import { describe, it, expect } from "vitest";
import { emitOrchestrator } from "./orchestrator.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ── Fixture yardımcıları (service.emitter.spec ile aynı desen) ──────────── */
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
const ORCH = "10000000-0000-4000-8000-0000000000a1";
const PAYMENT_SVC = "10000000-0000-4000-8000-0000000000a2";
const INVENTORY_SVC = "10000000-0000-4000-8000-0000000000a3";
const SHIPPING_SVC = "10000000-0000-4000-8000-0000000000a4";
const CHECKOUT_CTRL = "10000000-0000-4000-8000-0000000000a5";

/* ── Node fixture'ları ──────────────────────────────────────────────────── */
const paymentService = node("Service", PAYMENT_SVC, {
  ServiceName: "PaymentService",
  Description: "Ödeme",
  IsTransactionScoped: false,
  Dependencies: [],
  Methods: [],
});

const inventoryService = node("Service", INVENTORY_SVC, {
  ServiceName: "InventoryService",
  Description: "Stok",
  IsTransactionScoped: false,
  Dependencies: [],
  Methods: [],
});

const shippingService = node("Service", SHIPPING_SVC, {
  ServiceName: "ShippingService",
  Description: "Kargo",
  IsTransactionScoped: false,
  Dependencies: [],
  Methods: [],
});

// Bir Controller'ın CALLS ettiği service'ler "checkout" feature'ını tohumlar;
// böylece orchestrator + service'ler aynı feature'a düşer (göreli import kısa).
const checkoutController = node("Controller", CHECKOUT_CTRL, {
  ControllerName: "CheckoutController",
  Description: "Checkout API",
  BasePath: "/checkout",
  Endpoints: [],
});

const checkoutOrchestrator = node("Orchestrator", ORCH, {
  OrchestratorName: "CheckoutOrchestrator",
  Description: "Sipariş onay saga'sı",
  Pattern: "Saga",
  Steps: [
    {
      StepName: "ReserveInventory",
      ServiceRef: "InventoryService",
      Action: "Stok rezerve et",
      CompensationAction: "Rezervasyonu geri al",
      OnFailure: "compensate",
    },
    {
      StepName: "ChargePayment",
      ServiceRef: "PaymentService",
      Action: "Ödemeyi tahsil et",
      CompensationAction: "Ödemeyi iade et",
      OnFailure: "compensate",
    },
    {
      StepName: "ScheduleShipment",
      ServiceRef: "ShippingService",
      Action: "Kargoyu planla",
      OnFailure: "retry",
    },
  ],
});

/* Controller'ın service'leri CALLS etmesi feature ataması için: checkout feature.
 * Orchestrator da bu service'leri CALLS eder (DI). */
function fullGraphEdges(): StoredEdge[] {
  return [
    edge("e-c-pay", "CALLS", CHECKOUT_CTRL, PAYMENT_SVC),
    edge("e-c-inv", "CALLS", CHECKOUT_CTRL, INVENTORY_SVC),
    edge("e-c-shp", "CALLS", CHECKOUT_CTRL, SHIPPING_SVC),
    edge("e-o-pay", "CALLS", ORCH, PAYMENT_SVC),
    edge("e-o-inv", "CALLS", ORCH, INVENTORY_SVC),
    edge("e-o-shp", "CALLS", ORCH, SHIPPING_SVC),
  ];
}

describe("emitOrchestrator", () => {
  it("tam orchestrator — snapshot (DI, dekoratör, execute + adım metotları, surgical marker)", () => {
    const ctx = ctxFrom(
      [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController],
      fullGraphEdges(),
    );
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { Injectable } from "@nestjs/common";
      import { InventoryService } from "./inventory.service";
      import { PaymentService } from "./payment.service";
      import { ShippingService } from "./shipping.service";

      /** Sipariş onay saga'sı */
      @Injectable()
      export class CheckoutOrchestrator {
        constructor(
          private readonly inventoryService: InventoryService,
          private readonly paymentService: PaymentService,
          private readonly shippingService: ShippingService,
        ) {}

        async execute(): Promise<void> {
          // @solarch:surgical id=10000000-0000-4000-8000-0000000000a1#execute
          // Saga orchestration: coordinates all steps.
          // steps: ReserveInventory -> ChargePayment -> ScheduleShipment
          // deps: this.inventoryService, this.paymentService, this.shippingService
          throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.execute");
        }

        async reserveInventory(): Promise<void> {
          // @solarch:surgical id=10000000-0000-4000-8000-0000000000a1#reserveInventory
          // Stok rezerve et
          // onFailure: compensate
          // compensation: Rezervasyonu geri al
          // deps: this.inventoryService
          throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.reserveInventory");
        }

        async chargePayment(): Promise<void> {
          // @solarch:surgical id=10000000-0000-4000-8000-0000000000a1#chargePayment
          // Ödemeyi tahsil et
          // onFailure: compensate
          // compensation: Ödemeyi iade et
          // deps: this.paymentService
          throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.chargePayment");
        }

        async scheduleShipment(): Promise<void> {
          // @solarch:surgical id=10000000-0000-4000-8000-0000000000a1#scheduleShipment
          // Kargoyu planla
          // onFailure: retry
          // deps: this.shippingService
          throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.scheduleShipment");
        }
      }
      ",
        "language": "typescript",
        "path": "checkout/checkout.orchestrator.ts",
        "surgicalMarkers": 4,
      }
    `);
  });

  it("dosya yolu feature klasörü + rol-tekrarsız .orchestrator.ts", () => {
    const ctx = ctxFrom(
      [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController],
      fullGraphEdges(),
    );
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    // base "Checkout" (Orchestrator eki düşer) -> checkout.orchestrator.ts.
    expect(file.path).toBe("checkout/checkout.orchestrator.ts");
  });

  it("DI = Steps[].ServiceRef ∪ CALLS hedefleri, DEDUP + isme göre sıralı", () => {
    // Steps'te 3 service ref + aynı service'lere CALLS edge -> her biri TEK alan.
    const ctx = ctxFrom(
      [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController],
      fullGraphEdges(),
    );
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    // Her service tek kez enjekte edilir.
    expect(file.content.split("private readonly inventoryService").length - 1).toBe(1);
    expect(file.content.split("private readonly paymentService").length - 1).toBe(1);
    expect(file.content.split("private readonly shippingService").length - 1).toBe(1);
    // İsme göre sıralı: inventory < payment < shipping.
    const iInv = file.content.indexOf("inventoryService:");
    const iPay = file.content.indexOf("paymentService:");
    const iShp = file.content.indexOf("shippingService:");
    expect(iInv).toBeLessThan(iPay);
    expect(iPay).toBeLessThan(iShp);
  });

  it("her adım için + execute için surgical marker + NOT_IMPLEMENTED", () => {
    const ctx = ctxFrom(
      [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController],
      fullGraphEdges(),
    );
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    // 1 execute + 3 adım = 4 marker.
    expect(file.surgicalMarkers).toBe(4);
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.execute");');
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.reserveInventory");');
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.chargePayment");');
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.scheduleShipment");');
  });

  it("CALLS edge'i olmadan da Steps[].ServiceRef'ten DI çözer + import üretir", () => {
    // Hiç CALLS edge yok; DI yalnız Steps[].ServiceRef'ten gelmeli.
    const ctx = ctxFrom(
      [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController],
      [
        edge("e-c-pay", "CALLS", CHECKOUT_CTRL, PAYMENT_SVC),
        edge("e-c-inv", "CALLS", CHECKOUT_CTRL, INVENTORY_SVC),
        edge("e-c-shp", "CALLS", CHECKOUT_CTRL, SHIPPING_SVC),
      ],
    );
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    expect(file.content).toContain("private readonly paymentService: PaymentService,");
    expect(file.content).toMatch(/import \{ PaymentService \} from ".*payment\.service"/);
  });

  it("edge-case: kayıp ServiceRef — throw etmez, ham isimden sınıf adı + import atlanır", () => {
    const lonelyOrch = node("Orchestrator", ORCH, {
      OrchestratorName: "GhostOrchestrator",
      Description: "Kayıp ref'li akış",
      Pattern: "StateMachine",
      Steps: [
        {
          StepName: "DoThing",
          ServiceRef: "MissingService",
          Action: "bir şey yap",
          OnFailure: "abort",
        },
      ],
    });
    const ctx = ctxFrom([lonelyOrch], []);
    let file: { content: string; surgicalMarkers: number; path: string } | undefined;
    expect(() => {
      file = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx)[0];
    }).not.toThrow();
    // Ham ref'ten sınıf adı türetilir.
    expect(file!.content).toContain("private readonly missingService: MissingService,");
    // Çözülemeyen service import EDİLMEZ.
    expect(file!.content).not.toMatch(/import \{ MissingService \}/);
    // execute + 1 adım = 2 marker.
    expect(file!.surgicalMarkers).toBe(2);
    expect(file!.content).toContain('throw new Error("NOT_IMPLEMENTED: GhostOrchestrator.doThing");');
  });

  it("edge-case: boş Steps — yine de execute üretir, constructor yok", () => {
    const emptyOrch = node("Orchestrator", ORCH, {
      OrchestratorName: "EmptyOrchestrator",
      Description: "Adımsız akış",
      Pattern: "ProcessManager",
      Steps: [],
    });
    const ctx = ctxFrom([emptyOrch], []);
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    // DI yok -> constructor yok.
    expect(file.content).not.toContain("constructor(");
    // Yalnız execute() üretilir.
    expect(file.content).toContain("async execute(): Promise<void> {");
    expect(file.surgicalMarkers).toBe(1);
  });

  it("içerik tek satır sonu ile biter", () => {
    const ctx = ctxFrom(
      [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController],
      fullGraphEdges(),
    );
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMİNİZM: iki bağımsız graph kuruluşu -> byte-identical", () => {
    const nodes = [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController];
    const ctxA = ctxFrom(nodes, fullGraphEdges());
    const a = emitOrchestrator(ctxA.graph.byId(ORCH)!, ctxA)[0].content;
    const ctxB = ctxFrom(nodes, fullGraphEdges());
    const b = emitOrchestrator(ctxB.graph.byId(ORCH)!, ctxB)[0].content;
    expect(a).toBe(b);
  });
});
