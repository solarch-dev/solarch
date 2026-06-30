import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { AuthContext } from "../../auth/auth.types";

/** Rate-limit key: authenticated user when req.auth is set, otherwise IP. */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const auth = (req as { auth?: AuthContext }).auth;
    if (auth?.userId) return auth.userId;
    return (req.ip as string) ?? "anon";
  }
}
