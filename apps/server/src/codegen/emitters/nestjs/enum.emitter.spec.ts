import { describe, it, expect } from "vitest";
import { emitEnum } from "./enum.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";

/* ── Fixture helpers ──────────────────────────────────────────────── */
function enumNode(properties: Record<string, unknown>, id = "11111111-1111-4111-8111-111111111111"): StoredNode {
  return {
    id,
    type: "Enum",
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

const ORDER_STATUS = {
  Name: "OrderStatus",
  Description: "Order status",
  BackingType: "string",
  Values: [
    { Key: "PENDING" },
    { Key: "SHIPPED", Value: "shipped", Description: "Handed to shipping" },
    { Key: "DELIVERED" },
  ],
};

describe("emitEnum (canonical reference emitter)", () => {
  it("string backing — snapshot", () => {
    const node = enumNode(ORDER_STATUS);
    const { ctx } = ctxFor(node);
    const [file] = emitEnum(ctx.graph.byId(node.id)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "/** Order status */
      export enum OrderStatus {
        PENDING = "PENDING",
        /** Handed to shipping */
        SHIPPED = "shipped",
        DELIVERED = "DELIVERED",
      }
      ",
        "language": "typescript",
        "path": "common/enums/order-status.enum.ts",
        "surgicalMarkers": 0,
      }
    `);
  });

  it("int backing — sequential + explicit value", () => {
    const node = enumNode({
      Name: "Priority",
      Description: "Priority",
      BackingType: "int",
      Values: [{ Key: "LOW" }, { Key: "MEDIUM", Value: "5" }, { Key: "HIGH" }],
    });
    const { ctx } = ctxFor(node);
    const [file] = emitEnum(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain("LOW = 0,");
    expect(file.content).toContain("MEDIUM = 5,");
    expect(file.content).toContain("HIGH = 6,");
    expect(file.language).toBe("typescript");
  });

  it("file path kebab-case under common/enums", () => {
    const node = enumNode(ORDER_STATUS);
    const { ctx } = ctxFor(node);
    const [file] = emitEnum(ctx.graph.byId(node.id)!, ctx);
    expect(file.path).toBe("common/enums/order-status.enum.ts");
  });

  it("content ends with single newline", () => {
    const node = enumNode(ORDER_STATUS);
    const { ctx } = ctxFor(node);
    const [file] = emitEnum(ctx.graph.byId(node.id)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMINISM: same node twice -> byte-identical", () => {
    const node = enumNode(ORDER_STATUS);
    const { ctx } = ctxFor(node);
    const a = emitEnum(ctx.graph.byId(node.id)!, ctx)[0].content;
    const b = emitEnum(ctx.graph.byId(node.id)!, ctx)[0].content;
    expect(a).toBe(b);
  });

  it("invalid member key is sanitized", () => {
    const node = enumNode({
      Name: "WeirdEnum",
      Description: "weird",
      BackingType: "string",
      Values: [{ Key: "1ST-PLACE" }, { Key: "OK GO" }],
    });
    const { ctx } = ctxFor(node);
    const [file] = emitEnum(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain("_1ST_PLACE = ");
    expect(file.content).toContain("OK_GO = ");
  });

  /* ── STATE MACHINE (L2): Transitions -> transition map + canTransition + assert ─
   * When Transitions provided, emit allowed-transition map + canTransition<Enum> +
   * assert<Enum>Transition (throws on illegal transition). Status-updating service
   * uses this guard -> skips like pending->delivered are rejected. */
  it("Transitions -> transition map + canTransition + assert guards", () => {
    const node = enumNode({
      Name: "OrderStatus",
      Description: "Order status",
      BackingType: "string",
      Values: [
        { Key: "PENDING", Value: "pending" },
        { Key: "CONFIRMED", Value: "confirmed" },
        { Key: "DELIVERED", Value: "delivered" },
        { Key: "CANCELLED", Value: "cancelled" },
      ],
      Transitions: [
        { From: "PENDING", To: ["CONFIRMED", "CANCELLED"] },
        { From: "CONFIRMED", To: ["DELIVERED", "CANCELLED"] },
        // DELIVERED, CANCELLED terminal (no transitions) -> not in map.
      ],
    });
    const { ctx } = ctxFor(node);
    const [file] = emitEnum(ctx.graph.byId(node.id)!, ctx);
    // Transition map (computed enum member keys).
    expect(file.content).toMatch(/ORDER_STATUS_TRANSITIONS:\s*Partial<Record<OrderStatus/);
    expect(file.content).toContain("[OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],");
    expect(file.content).toContain("[OrderStatus.CONFIRMED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],");
    // Terminal states NOT in map.
    expect(file.content).not.toContain("[OrderStatus.DELIVERED]:");
    // Guards exported.
    expect(file.content).toContain("export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean");
    expect(file.content).toContain("export function assertOrderStatusTransition(from: OrderStatus, to: OrderStatus): void");
    expect(file.content).toContain("Illegal OrderStatus transition");
  });

  it("no Transitions -> enum only (no transition code emitted)", () => {
    const node = enumNode({
      Name: "Color",
      Description: "color",
      BackingType: "string",
      Values: [{ Key: "RED" }, { Key: "BLUE" }],
    });
    const { ctx } = ctxFor(node);
    const [file] = emitEnum(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).not.toContain("TRANSITIONS");
    expect(file.content).not.toContain("canTransition");
  });
});
