import { ArgumentsHost, Catch, ExceptionFilter, UnauthorizedException } from "@nestjs/common";
import { err } from "../envelope";

@Catch(UnauthorizedException)
export class UnauthorizedFilter implements ExceptionFilter {
  catch(exception: UnauthorizedException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const res = exception.getResponse() as { code?: string; message?: string } | string;
    const code = typeof res === "object" && res.code ? res.code : "ERR_UNAUTHORIZED";
    const message = typeof res === "object" && res.message ? res.message : "Authentication is required.";
    response.status(401).json(err(code, message));
  }
}
