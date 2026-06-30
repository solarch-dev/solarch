import type { TestingModuleBuilder } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { LocalAuthGuard } from "../src/auth/local-auth.guard";
import { ProjectAccessGuard } from "../src/auth/project-access.guard";

export const TEST_AUTH = { userId: "user_test", orgId: null as string | null, orgRole: null as string | null };

/** For existing e2e: bypass authentication with a fixed user and
* bypass project access guard (these tests do not test tenancy). */
export function bypassAuth(builder: TestingModuleBuilder): TestingModuleBuilder {
  return builder
// LocalAuthGuard bound to APP_GUARD with useExisting → overrideProvider replaces global guard.
    .overrideProvider(LocalAuthGuard)
    .useValue({
      canActivate: (ctx: { switchToHttp: () => { getRequest: () => { auth?: unknown } } }) => {
        ctx.switchToHttp().getRequest().auth = TEST_AUTH;
        return true;
      },
    })
    .overrideGuard(ProjectAccessGuard)
    .useValue({ canActivate: () => true });
}

/** Header-driven identity stub for auth.e2e: from x-test-user / x-test-org headers
* generates req.auth; If there is no header, 401. ProjectAccessGuard remains TRUE (BOLA test). */
export function headerAuthGuardValue() {
  return {
    canActivate: (ctx: { switchToHttp: () => { getRequest: () => Record<string, any> } }) => {
      const req = ctx.switchToHttp().getRequest();
      const userId = req.headers["x-test-user"] as string | undefined;
      if (!userId) {
throw new UnauthorizedException({ code: "ERR_UNAUTHORIZED", message: "Authentication required." });
      }
      const orgId = (req.headers["x-test-org"] as string | undefined) ?? null;
      req.auth = { userId, orgId, orgRole: null };
      return true;
    },
  };
}
