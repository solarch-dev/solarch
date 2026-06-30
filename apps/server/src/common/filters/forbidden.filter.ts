import { ArgumentsHost, Catch, ExceptionFilter, ForbiddenException } from "@nestjs/common";
import { err } from "../envelope";

@Catch(ForbiddenException)
export class ForbiddenFilter implements ExceptionFilter {
  catch(exception: ForbiddenException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const res = exception.getResponse() as { code?: string; message?: string } | string;
    const code = typeof res === "object" && res.code ? res.code : "ERR_FORBIDDEN";
    const message = typeof res === "object" && res.message ? res.message : "You do not have permission to access this resource.";
    response.status(403).json(err(code, message));
  }
}
