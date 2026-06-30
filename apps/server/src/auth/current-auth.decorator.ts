import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthContext } from "./auth.types";

/** Injects req.auth into a controller method (populated by LocalAuthGuard). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
    return req.auth as AuthContext;
  },
);
