import { ArgumentsHost, Catch, ExceptionFilter, NotFoundException } from "@nestjs/common";
import { err } from "../envelope";

@Catch(NotFoundException)
export class NotFoundFilter implements ExceptionFilter {
  catch(exception: NotFoundException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const res = exception.getResponse() as { code?: string; message?: string } | string;
    const code = typeof res === "object" && res.code ? res.code : "ERR_NODE_NOT_FOUND";
    const message = typeof res === "object" && res.message ? res.message : "Record not found.";
    response.status(404).json(err(code, message));
  }
}
