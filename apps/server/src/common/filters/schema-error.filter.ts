import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { ZodError } from "zod";
import { ZodValidationException } from "nestjs-zod";
import { err } from "../envelope";

@Catch(ZodError, ZodValidationException)
export class SchemaErrorFilter implements ExceptionFilter {
  catch(exception: ZodError | ZodValidationException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    // nestjs-zod ZodValidationException carries ZodError in `error` field
    const zodError: ZodError =
      exception instanceof ZodValidationException
        ? ((exception as any).error as ZodError)
        : exception;
    const details = zodError.issues.map((issue) => ({
      field: issue.path.join("."),
      issue: issue.message,
    }));
    response.status(400).json(
      err(
        "ERR_SCHEMA_INVALID",
        "The submitted properties do not match the schema.",
        details,
      ),
    );
  }
}
