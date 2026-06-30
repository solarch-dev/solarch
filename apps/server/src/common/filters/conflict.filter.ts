import { ArgumentsHost, Catch, ConflictException, ExceptionFilter } from "@nestjs/common";
import { err } from "../envelope";

@Catch(ConflictException)
export class ConflictFilter implements ExceptionFilter {
  catch(exception: ConflictException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const res = exception.getResponse() as
      | { code?: string; message?: string; suggestion?: string; ruleViolated?: string; docLink?: string; currentVersion?: number; currentRevision?: number }
      | string;
    const code = typeof res === "object" && res.code ? res.code : "ERR_CONFLICT";
    const message = typeof res === "object" && res.message ? res.message : "Conflict.";
    const envelope = err(code, message);
    // Rules Engine reddinin çekirdek değeri (suggestion/ruleViolated/docLink) ve
    // version conflict'in currentVersion'ı düşmesin — envelope'a taşı (PaymentRequiredFilter deseni).
    if (typeof res === "object") {
      const e = envelope.error as Record<string, unknown>;
      if (res.suggestion) e.suggestion = res.suggestion;
      if (res.ruleViolated) e.ruleViolated = res.ruleViolated;
      if (res.docLink) e.docLink = res.docLink;
      if (res.currentVersion !== undefined) e.currentVersion = res.currentVersion;
      if (res.currentRevision !== undefined) e.currentRevision = res.currentRevision;
    }
    response.status(409).json(envelope);
  }
}
