import type { TestingModuleBuilder } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { ClerkAuthGuard } from "../src/auth/clerk-auth.guard";
import { ProjectAccessGuard } from "../src/auth/project-access.guard";

export const TEST_AUTH = { userId: "user_test", orgId: null as string | null, orgRole: null as string | null };

/** Mevcut e2e'ler için: kimlik doğrulamayı sabit bir kullanıcıyla baypas et ve
 *  proje erişim guard'ını da geç (bu testler tenancy'yi denemiyor). */
export function bypassAuth(builder: TestingModuleBuilder): TestingModuleBuilder {
  return builder
    // ClerkAuthGuard APP_GUARD'a useExisting ile bağlı → overrideProvider global guard'ı değiştirir.
    .overrideProvider(ClerkAuthGuard)
    .useValue({
      canActivate: (ctx: { switchToHttp: () => { getRequest: () => { auth?: unknown } } }) => {
        ctx.switchToHttp().getRequest().auth = TEST_AUTH;
        return true;
      },
    })
    .overrideGuard(ProjectAccessGuard)
    .useValue({ canActivate: () => true });
}

/** auth.e2e için header-güdümlü kimlik stub'ı: x-test-user / x-test-org header'larından
 *  req.auth üretir; header yoksa 401. ProjectAccessGuard GERÇEK kalır (BOLA testi). */
export function headerAuthGuardValue() {
  return {
    canActivate: (ctx: { switchToHttp: () => { getRequest: () => Record<string, any> } }) => {
      const req = ctx.switchToHttp().getRequest();
      const userId = req.headers["x-test-user"] as string | undefined;
      if (!userId) {
        throw new UnauthorizedException({ code: "ERR_UNAUTHORIZED", message: "Kimlik doğrulama gerekli." });
      }
      const orgId = (req.headers["x-test-org"] as string | undefined) ?? null;
      req.auth = { userId, orgId, orgRole: null };
      return true;
    },
  };
}
