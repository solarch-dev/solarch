import { describe, it, expect } from "vitest";
import { emitException } from "./exception.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";

/* ── Fixture helpers ──────────────────────────────────────────────── */
function exceptionNode(
  properties: Record<string, unknown>,
  id = "11111111-1111-4111-8111-111111111111",
): StoredNode {
  return {
    id,
    type: "Exception",
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

const USER_NOT_FOUND = {
  ExceptionName: "UserNotFoundException",
  Description: "Requested user not found",
  HttpStatusCode: 404,
  LogSeverity: "Warning",
  ErrorCode: "ERR_USER_NOT_FOUND",
};

describe("emitException", () => {
  it("HttpException-based — snapshot", () => {
    const node = exceptionNode(USER_NOT_FOUND);
    const { ctx } = ctxFor(node);
    const [file] = emitException(ctx.graph.byId(node.id)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { HttpException, HttpStatus } from "@nestjs/common";

      /** Requested user not found */
      export class UserNotFoundException extends HttpException {
        static readonly httpStatus = HttpStatus.NOT_FOUND;
        static readonly errorCode = "ERR_USER_NOT_FOUND";
        static readonly logSeverity = "Warning";

        constructor(message?: string) {
          super({ code: "ERR_USER_NOT_FOUND", message: message ?? "Requested user not found" }, HttpStatus.NOT_FOUND);
        }
      }
      ",
        "language": "typescript",
        "path": "common/exceptions/user-not-found.exception.ts",
        "surgicalMarkers": 0,
      }
    `);
  });

  it("file path under kebab-case common/exceptions", () => {
    const node = exceptionNode(USER_NOT_FOUND);
    const { ctx } = ctxFor(node);
    const [file] = emitException(ctx.graph.byId(node.id)!, ctx);
    expect(file.path).toBe("common/exceptions/user-not-found.exception.ts");
  });

  it("import'lar @nestjs/common'dan HttpException + HttpStatus (alfabetik)", () => {
    const node = exceptionNode(USER_NOT_FOUND);
    const { ctx } = ctxFor(node);
    const [file] = emitException(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain(
      'import { HttpException, HttpStatus } from "@nestjs/common";',
    );
  });

  it("HttpStatusCode -> correct HttpStatus member", () => {
    const node = exceptionNode({ ...USER_NOT_FOUND, HttpStatusCode: 409 });
    const { ctx } = ctxFor(node);
    const [file] = emitException(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain("static readonly httpStatus = HttpStatus.CONFLICT;");
    expect(file.content).toContain(", HttpStatus.CONFLICT);");
  });

  it("unknown HttpStatusCode -> falls back to cast", () => {
    const node = exceptionNode({ ...USER_NOT_FOUND, HttpStatusCode: 499 });
    const { ctx } = ctxFor(node);
    const [file] = emitException(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain("(499 as HttpStatus)");
  });

  it("when ParentExceptionRef resolves extends that class + relative import", () => {
    const parent = exceptionNode(
      {
        ExceptionName: "AppException",
        Description: "Application base error",
        HttpStatusCode: 500,
        LogSeverity: "Error",
      },
      "33333333-3333-4333-8333-333333333333",
    );
    const child = exceptionNode(
      {
        ExceptionName: "UserNotFoundException",
        Description: "Requested user not found",
        HttpStatusCode: 404,
        LogSeverity: "Warning",
        ErrorCode: "ERR_USER_NOT_FOUND",
        ParentExceptionRef: "AppException",
      },
      "44444444-4444-4444-8444-444444444444",
    );
    const { ctx } = ctxFor(parent, child);
    const [file] = emitException(ctx.graph.byId(child.id)!, ctx);
    expect(file.content).toContain(
      "export class UserNotFoundException extends AppException {",
    );
    expect(file.content).toContain(
      'import { AppException } from "./app.exception";',
    );
    // HttpException no longer imported in inheritance.
    expect(file.content).not.toContain("HttpException");
  });

  it("without ErrorCode response contains only message + static errorCode skipped", () => {
    const node = exceptionNode({
      ExceptionName: "ValidationException",
      Description: "Invalid request",
      HttpStatusCode: 400,
      LogSeverity: "Info",
    });
    const { ctx } = ctxFor(node);
    const [file] = emitException(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain(
      'super({ message: message ?? "Invalid request" }, HttpStatus.BAD_REQUEST);',
    );
    expect(file.content).not.toContain("static readonly errorCode");
  });

  it("EDGE-CASE: missing ParentExceptionRef -> no THROW, falls back to HttpException + TODO", () => {
    const node = exceptionNode({
      ...USER_NOT_FOUND,
      ParentExceptionRef: "GhostException",
    });
    const { ctx } = ctxFor(node); // parent graph'ta NONE
    expect(() => emitException(ctx.graph.byId(node.id)!, ctx)).not.toThrow();
    const [file] = emitException(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain("extends HttpException {");
    expect(file.content).toContain('// TODO: ParentExceptionRef "GhostException"');
    expect(file.surgicalMarkers).toBe(0);
  });

  it("surgical marker NONE (constructor not algorithm field)", () => {
    const node = exceptionNode(USER_NOT_FOUND);
    const { ctx } = ctxFor(node);
    const [file] = emitException(ctx.graph.byId(node.id)!, ctx);
    expect(file.surgicalMarkers).toBe(0);
    expect(file.content).not.toContain("@solarch:surgical");
  });

  it("content ends with single newline", () => {
    const node = exceptionNode(USER_NOT_FOUND);
    const { ctx } = ctxFor(node);
    const [file] = emitException(ctx.graph.byId(node.id)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMINISM: same node twice -> byte-identical", () => {
    const node = exceptionNode(USER_NOT_FOUND);
    const { ctx } = ctxFor(node);
    const a = emitException(ctx.graph.byId(node.id)!, ctx)[0].content;
    const b = emitException(ctx.graph.byId(node.id)!, ctx)[0].content;
    expect(a).toBe(b);
  });
});
