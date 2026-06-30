import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeNode } from "../../ir";
import { filePathFor, pascalCase, relativeImportPath, importPathOf } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * exception.emitter.ts — ExceptionNode -> common/exceptions/<e>.exception.ts
 *
 * Generated class extends NestJS HttpException (or another Exception class
 * resolved via ParentExceptionRef). Constructor has deterministic body —
 * this is an "algorithm field" NOT, so no surgical marker
 * (countSurgicalMarkers -> 0).
 *
 *   constructor() {
 *     super({ code: "<ErrorCode>", message: "<Description>" }, HttpStatus.<XXX>);
 *   }
 *
 * Inheritance:
 *   - If ParentExceptionRef is set and ctx.graph.resolveRef("Exception", ref)
 *     resolves a node -> extends that class, relative import.
 *   - otherwise -> extends HttpException (@nestjs/common).
 *   Missing ref -> NO THROW; silently falls back to HttpException (+ TODO comment).
 *
 * PURE function: (node, ctx) -> GeneratedFile[]. No I/O, no throw.
 * Path always filePathFor; imports via ImportCollector; name pascalCase.
 * Content ends with single "\n".
 * ──────────────────────────────────────────────────────────────────────── */

export const emitException: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"Exception">(node);
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, ctx.graph);

  const imports = new ImportCollector();

  // HttpStatus always required (super's 2nd argument).
  imports.add("HttpStatus", "@nestjs/common");
  const statusMember = httpStatusMember(props.HttpStatusCode);

  // ── Resolve parent class ──────────────────────────────────────────────
  let parentClass = "HttpException";
  let missingParent = false;
  const parentRef = props.ParentExceptionRef;
  if (parentRef !== undefined && parentRef !== "") {
    const parentNode = ctx.graph.resolveRef("Exception", parentRef);
    if (parentNode) {
      parentClass = pascalCase(parentNode.name);
      const parentPath = filePathFor(parentNode, ctx.graph);
      // Relative import when not same file (Exceptions live under common/exceptions
      // so usually "./<other>.exception").
      if (importPathOf(parentPath) !== importPathOf(filePath)) {
        imports.add(parentClass, relativeImportPath(filePath, parentPath));
      }
    } else {
      // Missing ref -> fall back to HttpException, leave note for user.
      missingParent = true;
    }
  }

  if (parentClass === "HttpException") {
    imports.add("HttpException", "@nestjs/common");
  }

  // ── Body ───────────────────────────────────────────────────────────────
  const lines: string[] = [];

  if (props.Description) {
    lines.push(`/** ${props.Description} */`);
  }
  lines.push(`export class ${className} extends ${parentClass} {`);
  if (missingParent) {
    lines.push(`  // TODO: ParentExceptionRef "${parentRef}" could not be resolved; fell back to HttpException.`);
  }
  // In-class static fields (static, deterministic metadata).
  lines.push(`  static readonly httpStatus = ${statusMember};`);
  if (props.ErrorCode !== undefined && props.ErrorCode !== "") {
    lines.push(`  static readonly errorCode = ${JSON.stringify(props.ErrorCode)};`);
  }
  lines.push(`  static readonly logSeverity = ${JSON.stringify(props.LogSeverity)};`);
  lines.push("");
  lines.push("  constructor(message?: string) {");
  lines.push(`    super(${responseLiteral(props.ErrorCode, props.Description)}, ${statusMember});`);
  lines.push("  }");
  lines.push("}");

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  const file: GeneratedFile = {
    path: filePath,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
};

/** super()'s 1st argument: { code, message } response object.
 *  When ErrorCode absent, only message is written (deterministic). */
function responseLiteral(errorCode: string | undefined, description: string): string {
  // constructor(message?) -> use runtime message if present, else Description default.
  const message = `message ?? ${JSON.stringify(description)}`;
  if (errorCode !== undefined && errorCode !== "") {
    return `{ code: ${JSON.stringify(errorCode)}, message: ${message} }`;
  }
  return `{ message: ${message} }`;
}

/** HTTP status code (number) -> `HttpStatus.<MEMBER>`.
 *  Known codes map to named member; unknown fall back to safe `<n> as HttpStatus`
 *  cast instead of `HttpStatus[<n>]` (deterministic). */
function httpStatusMember(code: number): string {
  const name = HTTP_STATUS_NAMES[code];
  return name ? `HttpStatus.${name}` : `(${code} as HttpStatus)`;
}

/** NestJS HttpStatus enum equivalents (deterministic constant table). */
const HTTP_STATUS_NAMES: Record<number, string> = {
  100: "CONTINUE",
  101: "SWITCHING_PROTOCOLS",
  102: "PROCESSING",
  103: "EARLYHINTS",
  200: "OK",
  201: "CREATED",
  202: "ACCEPTED",
  203: "NON_AUTHORITATIVE_INFORMATION",
  204: "NO_CONTENT",
  205: "RESET_CONTENT",
  206: "PARTIAL_CONTENT",
  300: "AMBIGUOUS",
  301: "MOVED_PERMANENTLY",
  302: "FOUND",
  303: "SEE_OTHER",
  304: "NOT_MODIFIED",
  307: "TEMPORARY_REDIRECT",
  308: "PERMANENT_REDIRECT",
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  402: "PAYMENT_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  406: "NOT_ACCEPTABLE",
  407: "PROXY_AUTHENTICATION_REQUIRED",
  408: "REQUEST_TIMEOUT",
  409: "CONFLICT",
  410: "GONE",
  411: "LENGTH_REQUIRED",
  412: "PRECONDITION_FAILED",
  413: "PAYLOAD_TOO_LARGE",
  414: "URI_TOO_LONG",
  415: "UNSUPPORTED_MEDIA_TYPE",
  416: "REQUESTED_RANGE_NOT_SATISFIABLE",
  417: "EXPECTATION_FAILED",
  418: "I_AM_A_TEAPOT",
  421: "MISDIRECTED",
  422: "UNPROCESSABLE_ENTITY",
  424: "FAILED_DEPENDENCY",
  428: "PRECONDITION_REQUIRED",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_SERVER_ERROR",
  501: "NOT_IMPLEMENTED",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
  504: "GATEWAY_TIMEOUT",
  505: "HTTP_VERSION_NOT_SUPPORTED",
};
