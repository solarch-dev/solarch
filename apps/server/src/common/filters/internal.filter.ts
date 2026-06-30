import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { err } from "../envelope";

@Catch()
export class InternalFilter implements ExceptionFilter {
  private readonly logger = new Logger(InternalFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse() as { code?: string; message?: string } | string;
      const hasCode = typeof res === "object" && !!res.code;
      // Our coded exceptions carry `code`. When code is absent this is a NestJS-builtin
      // exception (e.g. body-parser SyntaxError → Nest mapExternalException → BadRequest
      // with raw message that may reflect request body). Return generic message + ERR_BAD_JSON.
      if (status === 400 && !hasCode) {
        response.status(400).json(err("ERR_BAD_JSON", "The request body is not valid JSON or is invalid."));
        return;
      }
      const code = hasCode ? (res as { code: string }).code : `ERR_HTTP_${status}`;
      const message = typeof res === "object" && res.message
        ? res.message
        : (typeof res === "string" ? res : exception.message);
      response.status(status).json(err(code, message));
      return;
    }

    // body-parser / http-errors (payload too large, malformed JSON, ...) are not HttpException
    // → must not become 500; return correct client error code.
    const he = exception as { statusCode?: number; status?: number; type?: string };
    const httpStatus = he?.statusCode ?? he?.status;
    if (typeof httpStatus === "number" && httpStatus >= 400 && httpStatus < 500) {
      if (httpStatus === 413) {
        response.status(413).json(err("ERR_PAYLOAD_TOO_LARGE", "The request body is too large (limit: 1MB)."));
      } else if (he.type === "entity.parse.failed") {
        response.status(400).json(err("ERR_BAD_JSON", "The request body is not valid JSON."));
      } else {
        response.status(httpStatus).json(err(`ERR_HTTP_${httpStatus}`, "The request was rejected."));
      }
      return;
    }

    this.logger.error("Unexpected error", exception instanceof Error ? exception.stack : exception);
    response.status(500).json(err("ERR_INTERNAL", "An unexpected error occurred."));
  }
}
