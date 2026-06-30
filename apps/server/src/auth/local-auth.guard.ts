import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { env } from "../config/env";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { API_KEY_PREFIX, ApiKeysService } from "./api-keys/api-keys.service";
import type { AuthContext } from "./auth.types";

function headerOne(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const raw = headers[name.toLowerCase()] ?? headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Global guard (APP_GUARD). Every request gets the local owner identity unless
 *  the caller presents a valid API key (Authorization: Bearer slk_* or X-Solarch-Api-Key). */
@Injectable()
export class LocalAuthGuard implements CanActivate {
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
    const headers = (req as { headers?: Record<string, string | string[] | undefined> }).headers ?? {};

    const rawAuthz = headerOne(headers, "authorization");
    const apiKeyHeader = headerOne(headers, "x-solarch-api-key");
    const rawKey = rawAuthz?.startsWith(`Bearer ${API_KEY_PREFIX}`)
      ? rawAuthz.slice("Bearer ".length)
      : apiKeyHeader?.startsWith(API_KEY_PREFIX)
        ? apiKeyHeader
        : undefined;

    if (rawKey) {
      const verified = await this.apiKeys.verify(rawKey);
      if (verified) {
        const ctx: AuthContext = {
          userId: verified.userId,
          orgId: null,
          orgRole: null,
        };
        (req as { auth?: AuthContext }).auth = ctx;
        return true;
      }
      throw new UnauthorizedException({
        code: "ERR_API_KEY_INVALID",
        message: "API key is invalid or revoked.",
      });
    }

    const ctx: AuthContext = {
      userId: env.LOCAL_USER_ID,
      orgId: null,
      orgRole: null,
    };
    (req as { auth?: AuthContext }).auth = ctx;
    return true;
  }
}
