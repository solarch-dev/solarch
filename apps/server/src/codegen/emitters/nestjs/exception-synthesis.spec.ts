import { describe, it, expect } from "vitest";
import { buildCodeGraph } from "../../ir";
import {
  emitSyntheticException,
  synthExceptionClassName,
  synthExceptionFilePath,
  undefinedThrownExceptions,
} from "./exception-synthesis";
import type { StoredNode } from "../../../nodes/nodes.repository";

function node(type: StoredNode["type"], id: string, properties: Record<string, unknown>): StoredNode {
  return {
    id, type, projectId: "00000000-0000-4000-8000-000000000000",
    positionX: 0, positionY: 0, homeTabId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", version: 1, properties,
  };
}

const method = (name: string, throws: string[]) => ({
  MethodName: name, Visibility: "public", Parameters: [], ReturnType: "void", IsAsync: true, Throws: throws,
});

describe("exception-synthesis — declared-but-undefined Throws", () => {
  it("collects Throws WITHOUT Exception nodes; skips existing ones (dedup + sorted)", () => {
    const svc1 = node("Service", "s1", { ServiceName: "OrderService", Methods: [
      method("PlaceOrder", ["CartEmptyException", "InsufficientStockException", "InvalidDiscountException"]),
      method("Cancel", ["InvalidDiscountException"]), // dedup
    ], Dependencies: [] });
    const svc2 = node("Service", "s2", { ServiceName: "PaymentService", Methods: [
      method("Pay", ["PaymentFailedException", "NotFoundException"]),
    ], Dependencies: [] });
    // InsufficientStockException + NotFoundException are REAL nodes → should be skipped.
    const exc1 = node("Exception", "e1", { ExceptionName: "InsufficientStockException", HttpStatusCode: 409, LogSeverity: "Warning" });
    const exc2 = node("Exception", "e2", { ExceptionName: "NotFoundException", HttpStatusCode: 404, LogSeverity: "Warning" });
    const graph = buildCodeGraph([svc1, svc2, exc1, exc2], []);
    expect(undefinedThrownExceptions(graph)).toEqual([
      "CartEmptyException", "InvalidDiscountException", "PaymentFailedException",
    ]);
  });

  it("single source name/path: pascalCase class + common/exceptions/<kebab>.exception.ts", () => {
    expect(synthExceptionClassName("CartEmptyException")).toBe("CartEmptyException");
    expect(synthExceptionFilePath("CartEmptyException")).toBe("common/exceptions/cart-empty.exception.ts");
    expect(synthExceptionFilePath("RefundFailedException")).toBe("common/exceptions/refund-failed.exception.ts");
  });

  it("generated class: HttpException subclass + optional message + code (compilable)", () => {
    const f = emitSyntheticException("CartEmptyException");
    expect(f.path).toBe("common/exceptions/cart-empty.exception.ts");
    expect(f.content).toContain("export class CartEmptyException extends HttpException {");
    expect(f.content).toContain("constructor(message =");
    expect(f.content).toContain('code: "CART_EMPTY"');
    expect(f.content).toContain("HttpStatus.BAD_REQUEST");
    expect(f.content).toContain('import { HttpException, HttpStatus } from "@nestjs/common";');
  });
});
