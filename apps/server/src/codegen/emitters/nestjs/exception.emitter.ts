import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeNode } from "../../ir";
import { filePathFor, pascalCase, relativeImportPath, importPathOf } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";

/* ────────────────────────────────────────────────────────────────────────
 * exception.emitter.ts — ExceptionNode -> common/exceptions/<e>.exception.ts
 *
 * Üretilen sınıf NestJS HttpException'ı (veya ParentExceptionRef ile çözülen
 * başka bir Exception sınıfını) genişletir. Constructor deterministik gövdeye
 * sahiptir — bu bir "algoritma alanı" DEĞİLDİR, dolayısıyla surgical marker
 * YOKTUR (countSurgicalMarkers -> 0).
 *
 *   constructor() {
 *     super({ code: "<ErrorCode>", message: "<Description>" }, HttpStatus.<XXX>);
 *   }
 *
 * Kalıtım:
 *   - ParentExceptionRef varsa ve ctx.graph.resolveRef("Exception", ref) bir node
 *     çözerse -> o sınıfı extends eder, göreli import ile alır.
 *   - aksi halde -> HttpException (@nestjs/common) extends eder.
 *   Kayıp ref -> THROW YOK; sessizce HttpException'a düşülür (+ TODO yorumu).
 *
 * SAF fonksiyon: (node, ctx) -> GeneratedFile[]. I/O yok, throw yok.
 * Yol her zaman filePathFor; import'lar ImportCollector; isim pascalCase.
 * İçerik tek "\n" ile biter.
 * ──────────────────────────────────────────────────────────────────────── */

export const emitException: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"Exception">(node);
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, ctx.graph);

  const imports = new ImportCollector();

  // HttpStatus her zaman gerekir (super'ın 2. argümanı).
  imports.add("HttpStatus", "@nestjs/common");
  const statusMember = httpStatusMember(props.HttpStatusCode);

  // ── Kalıtılan sınıf çözümü ──────────────────────────────────────────────
  let parentClass = "HttpException";
  let missingParent = false;
  const parentRef = props.ParentExceptionRef;
  if (parentRef !== undefined && parentRef !== "") {
    const parentNode = ctx.graph.resolveRef("Exception", parentRef);
    if (parentNode) {
      parentClass = pascalCase(parentNode.name);
      const parentPath = filePathFor(parentNode, ctx.graph);
      // Aynı dosya değilse göreli import (Exception'lar common/exceptions altında
      // toplandığından genelde "./<other>.exception").
      if (importPathOf(parentPath) !== importPathOf(filePath)) {
        imports.add(parentClass, relativeImportPath(filePath, parentPath));
      }
    } else {
      // Kayıp ref -> HttpException'a düş, kullanıcıya not bırak.
      missingParent = true;
    }
  }

  if (parentClass === "HttpException") {
    imports.add("HttpException", "@nestjs/common");
  }

  // ── Gövde ───────────────────────────────────────────────────────────────
  const lines: string[] = [];

  if (props.Description) {
    lines.push(`/** ${props.Description} */`);
  }
  lines.push(`export class ${className} extends ${parentClass} {`);
  if (missingParent) {
    lines.push(`  // TODO: ParentExceptionRef "${parentRef}" could not be resolved; fell back to HttpException.`);
  }
  // Sınıf-içi sabit alanlar (statik, deterministik metadata).
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

/** super()'ın 1. argümanı: { code, message } response nesnesi.
 *  ErrorCode yoksa yalnız message yazılır (deterministik). */
function responseLiteral(errorCode: string | undefined, description: string): string {
  // constructor(message?) → runtime mesaj varsa onu, yoksa Description varsayılanını kullan.
  const message = `message ?? ${JSON.stringify(description)}`;
  if (errorCode !== undefined && errorCode !== "") {
    return `{ code: ${JSON.stringify(errorCode)}, message: ${message} }`;
  }
  return `{ message: ${message} }`;
}

/** HTTP durum kodu (sayı) -> `HttpStatus.<MEMBER>`.
 *  Bilinen kodlar adlandırılmış member'a; bilinmeyenler `HttpStatus[<n>]`
 *  yerine güvenli `<n> as HttpStatus` cast'ine düşülür (deterministik). */
function httpStatusMember(code: number): string {
  const name = HTTP_STATUS_NAMES[code];
  return name ? `HttpStatus.${name}` : `(${code} as HttpStatus)`;
}

/** NestJS HttpStatus enum karşılıkları (deterministik sabit tablo). */
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
