import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthContext } from "./auth.types";

/** Controller method'una req.auth'u (ClerkAuthGuard tarafından doldurulur) enjekte eder. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
    return req.auth as AuthContext;
  },
);
