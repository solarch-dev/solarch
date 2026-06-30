import { HttpException, HttpStatus } from "@nestjs/common";

/** 402 — plan limiti/erişimi. `code` ve `requiredPlan` envelope'a taşınır. */
export class PaymentRequiredException extends HttpException {
  constructor(code: string, message: string, requiredPlan?: string) {
    super({ code, message, requiredPlan }, HttpStatus.PAYMENT_REQUIRED);
  }
}
