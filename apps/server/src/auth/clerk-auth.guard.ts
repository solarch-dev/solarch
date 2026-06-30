import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { getAuth } from "@clerk/express";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { verifyGuestToken } from "./guest-token";
import { API_KEY_PREFIX, ApiKeysService } from "./api-keys/api-keys.service";
import type { AuthContext } from "./auth.types";

/** Global guard (APP_GUARD). Üç kimlik yolu, sırayla:
 *  1. Clerk session (cookie veya Bearer JWT) — clerkMiddleware çözer.
 *  2. API anahtarı (Authorization: Bearer slk_...) — CLI/MCP istemcileri.
 *  3. X-Guest-Token (imzalı misafir bileti).
 *  Hiçbiri yoksa 401. @Public() işaretli route'lar atlanır. */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const auth = getAuth(req);
    if (auth.userId) {
      const ctx: AuthContext = {
        userId: auth.userId,
        orgId: auth.orgId ?? null,
        orgRole: auth.orgRole ?? null,
        isGuest: false,
      };
      (req as { auth?: AuthContext }).auth = ctx;
      return true;
    }

    const headers = (req as { headers?: Record<string, string | string[] | undefined> }).headers ?? {};

    // API anahtarı (CLI/MCP): Authorization: Bearer slk_...
    const rawAuthz = headers["authorization"];
    const authz = Array.isArray(rawAuthz) ? rawAuthz[0] : rawAuthz;
    if (authz?.startsWith(`Bearer ${API_KEY_PREFIX}`)) {
      const verified = await this.apiKeys.verify(authz.slice("Bearer ".length));
      if (verified) {
        const ctx: AuthContext = {
          userId: verified.userId,
          orgId: null,
          orgRole: null,
          isGuest: false,
        };
        (req as { auth?: AuthContext }).auth = ctx;
        return true;
      }
      throw new UnauthorizedException({
        code: "ERR_API_KEY_INVALID",
        message: "API key is invalid or revoked.",
      });
    }

    // Clerk oturumu yok → misafir bileti (login'siz 1 projelik deneme).
    // Önce header (normal fetch yolu), yoksa cookie: EventSource (AI SSE)
    // header taşıyamaz, frontend bileti solarch_guest_token cookie'sine yansıtır.
    const rawHeader = headers["x-guest-token"];
    const token =
      (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader) ??
      readGuestCookie(typeof headers.cookie === "string" ? headers.cookie : undefined);
    const guest = token ? verifyGuestToken(token) : null;
    if (guest) {
      const ctx: AuthContext = {
        userId: guest.guestId,
        orgId: null,
        orgRole: null,
        isGuest: true,
      };
      (req as { auth?: AuthContext }).auth = ctx;
      return true;
    }

    throw new UnauthorizedException({
      code: "ERR_UNAUTHORIZED",
      message: "Authentication is required.",
    });
  }
}

/** Cookie başlığından misafir biletini çıkar (cookie-parser bağımlılığı yok). */
function readGuestCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "solarch_guest_token" && rest.length > 0) {
      const value = rest.join("=");
      return value || undefined;
    }
  }
  return undefined;
}
