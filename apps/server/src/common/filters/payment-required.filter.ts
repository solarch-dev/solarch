import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { PaymentRequiredException } from "../exceptions/payment-required.exception";
import { err } from "../envelope";

@Catch(PaymentRequiredException)
export class PaymentRequiredFilter implements ExceptionFilter {
  catch(exception: PaymentRequiredException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const body = exception.getResponse() as { code?: string; message?: string; requiredPlan?: string };
    const envelope = err(body.code ?? "ERR_PLAN_LIMIT", body.message ?? "Plan limit exceeded.");
    if (body.requiredPlan) (envelope.error as Record<string, unknown>).requiredPlan = body.requiredPlan;
    res.status(402).json(envelope);
  }
}
