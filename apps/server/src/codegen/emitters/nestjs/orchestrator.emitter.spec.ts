import { describe, it, expect } from "vitest";
import { emitOrchestrator } from "./orchestrator.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";
import type { StoredEdge } from "../../../edges/edges.repository";
import type { EdgeKind } from "../../../edges/schemas/edge.schema";

/* ── Fixture helpers (service.emitter.spec ile ayni desen) ──────────── */
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

/* ── Node fixtures ──────────────────────────────────────────────────── */
const paymentService = node("Service", PAYMENT_SVC, {
  ServiceName: "PaymentService",
  Description: "Odeme",
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

// Bir Controller'in CALLS ettigi service'ler "checkout" feature'ini tohumlar;
// boylece orchestrator + service'ler ayni feature'a duser (goreli import kisa).
const checkoutController = node("Controller", CHECKOUT_CTRL, {
  ControllerName: "CheckoutController",
  Description: "Checkout API",
  BasePath: "/checkout",
  Endpoints: [],
});

const checkoutOrchestrator = node("Orchestrator", ORCH, {
  OrchestratorName: "CheckoutOrchestrator",
  Description: "Order approval saga",
  Pattern: "Saga",
  Steps: [
    {
      StepName: "ReserveInventory",
      ServiceRef: "InventoryService",
      Action: "Reserve stock",
      CompensationAction: "Release reservation",
      OnFailure: "compensate",
    },
    {
      StepName: "ChargePayment",
      ServiceRef: "PaymentService",
      Action: "Collect payment",
      CompensationAction: "Refund payment",
      OnFailure: "compensate",
    },
    {
      StepName: "ScheduleShipment",
      ServiceRef: "ShippingService",
      Action: "Schedule shipment",
      OnFailure: "retry",
    },
  ],
});

/* Controller'in service'leri CALLS etmesi feature atamasi icin: checkout feature.
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
  it("tam orchestrator — snapshot (DI, dekorator, execute + adim metotlari, surgical marker)", () => {
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

      /** Order approval saga */
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
          // Reserve stock
          // onFailure: compensate
          // compensation: Release reservation
          // deps: this.inventoryService
          throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.reserveInventory");
        }

        async chargePayment(): Promise<void> {
          // @solarch:surgical id=10000000-0000-4000-8000-0000000000a1#chargePayment
          // Collect payment
          // onFailure: compensate
          // compensation: Refund payment
          // deps: this.paymentService
          throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.chargePayment");
        }

        async scheduleShipment(): Promise<void> {
          // @solarch:surgical id=10000000-0000-4000-8000-0000000000a1#scheduleShipment
          // Schedule shipment
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

  it("dosya yolu feature klasoru + rol-tekrarsiz .orchestrator.ts", () => {
    const ctx = ctxFrom(
      [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController],
      fullGraphEdges(),
    );
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    // base "Checkout" (Orchestrator eki duser) -> checkout.orchestrator.ts.
    expect(file.path).toBe("checkout/checkout.orchestrator.ts");
  });

  it("DI = Steps[].ServiceRef ∪ CALLS hedefleri, DEDUP + isme gore sirali", () => {
    // Steps'te 3 service ref + ayni service'lere CALLS edge -> her biri TEK alan.
    const ctx = ctxFrom(
      [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController],
      fullGraphEdges(),
    );
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    // Her service tek kez enjekte edilir.
    expect(file.content.split("private readonly inventoryService").length - 1).toBe(1);
    expect(file.content.split("private readonly paymentService").length - 1).toBe(1);
    expect(file.content.split("private readonly shippingService").length - 1).toBe(1);
    // Isme gore sirali: inventory < payment < shipping.
    const iInv = file.content.indexOf("inventoryService:");
    const iPay = file.content.indexOf("paymentService:");
    const iShp = file.content.indexOf("shippingService:");
    expect(iInv).toBeLessThan(iPay);
    expect(iPay).toBeLessThan(iShp);
  });

  it("her adim icin + execute icin surgical marker + NOT_IMPLEMENTED", () => {
    const ctx = ctxFrom(
      [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController],
      fullGraphEdges(),
    );
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    // 1 execute + 3 adim = 4 marker.
    expect(file.surgicalMarkers).toBe(4);
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.execute");');
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.reserveInventory");');
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.chargePayment");');
    expect(file.content).toContain('throw new Error("NOT_IMPLEMENTED: CheckoutOrchestrator.scheduleShipment");');
  });

  it("CALLS edge'i olmadan da Steps[].ServiceRef'ten DI cozer + import uretir", () => {
    // Hic CALLS edge yok; DI yalniz Steps[].ServiceRef'ten gelmeli.
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

  it("edge-case: kayip ServiceRef — throw etmez, ham isimden sinif adi + import atlanir", () => {
    const lonelyOrch = node("Orchestrator", ORCH, {
      OrchestratorName: "GhostOrchestrator",
      Description: "Kayip ref'li akis",
      Pattern: "StateMachine",
      Steps: [
        {
          StepName: "DoThing",
          ServiceRef: "MissingService",
          Action: "do something",
          OnFailure: "abort",
        },
      ],
    });
    const ctx = ctxFrom([lonelyOrch], []);
    let file: { content: string; surgicalMarkers: number; path: string } | undefined;
    expect(() => {
      file = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx)[0];
    }).not.toThrow();
    // Ham ref'ten sinif adi turetilir.
    expect(file!.content).toContain("private readonly missingService: MissingService,");
    // Cozulemeyen service import EDILMEZ.
    expect(file!.content).not.toMatch(/import \{ MissingService \}/);
    // execute + 1 adim = 2 marker.
    expect(file!.surgicalMarkers).toBe(2);
    expect(file!.content).toContain('throw new Error("NOT_IMPLEMENTED: GhostOrchestrator.doThing");');
  });

  it("edge-case: bos Steps — yine de execute uretir, constructor yok", () => {
    const emptyOrch = node("Orchestrator", ORCH, {
      OrchestratorName: "EmptyOrchestrator",
      Description: "Adimsiz akis",
      Pattern: "ProcessManager",
      Steps: [],
    });
    const ctx = ctxFrom([emptyOrch], []);
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    // DI yok -> constructor yok.
    expect(file.content).not.toContain("constructor(");
    // Yalniz execute() uretilir.
    expect(file.content).toContain("async execute(): Promise<void> {");
    expect(file.surgicalMarkers).toBe(1);
  });

  it("content ends with single newline", () => {
    const ctx = ctxFrom(
      [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController],
      fullGraphEdges(),
    );
    const [file] = emitOrchestrator(ctx.graph.byId(ORCH)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMINISM: two independent graph builds -> byte-identical", () => {
    const nodes = [checkoutOrchestrator, paymentService, inventoryService, shippingService, checkoutController];
    const ctxA = ctxFrom(nodes, fullGraphEdges());
    const a = emitOrchestrator(ctxA.graph.byId(ORCH)!, ctxA)[0].content;
    const ctxB = ctxFrom(nodes, fullGraphEdges());
    const b = emitOrchestrator(ctxB.graph.byId(ORCH)!, ctxB)[0].content;
    expect(a).toBe(b);
  });
});
