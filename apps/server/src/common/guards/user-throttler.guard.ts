import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { getAuth } from "@clerk/express";

/** Rate-limit anahtarı: kimlik doğrulanmışsa kullanıcı (Clerk userId), değilse IP.
 *
 *  KRİTİK: userId'yi `req.auth`'tan OKUMA — req.auth'ı ClerkAuthGuard doldurur ve
 *  global guard sırasında throttler ondan ÖNCE koşabilir (req.auth boş olur, hep IP'ye
 *  düşer). Bunun yerine clerkMiddleware'in (main.ts'te guard'lardan ÖNCE çalışan
 *  Express middleware) hazırladığı getAuth(req)'i doğrudan çağır → guard sırasından bağımsız. */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    try {
      const userId = getAuth(req as never)?.userId;
      if (userId) return userId;
    } catch {
      /* clerkMiddleware çalışmadıysa (test/health) → IP fallback */
    }
    return (req.ip as string) ?? "anon";
  }
}
