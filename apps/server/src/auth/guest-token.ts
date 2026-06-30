import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

/** Misafir kimliği: login'siz ziyaretçiye backend imzalı, kendi kendini doğrulayan
 *  bilet. localStorage'da taşınır, her istekte X-Guest-Token header'ı ile gelir.
 *  Format: g1.<uuid>.<expEpochMs>.<hmac-base64url>  (DB kaydı yok — stateless). */

export const GUEST_PREFIX = "guest_";
export const GUEST_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün

export interface GuestTokenPayload {
  /** ownerId olarak damgalanan kimlik: "guest_<uuid>". */
  guestId: string;
  /** Epoch ms. */
  expiresAt: number;
}

export const guestModeEnabled = (): boolean => env.GUEST_TOKEN_SECRET.length > 0;

export const isGuestId = (userId: string): boolean => userId.startsWith(GUEST_PREFIX);

function sign(uuid: string, exp: number): string {
  return createHmac("sha256", env.GUEST_TOKEN_SECRET).update(`${uuid}.${exp}`).digest("base64url");
}

export function mintGuestToken(now = Date.now()): { token: string; guestId: string; expiresAt: string } {
  const uuid = randomUUID();
  const exp = now + GUEST_TOKEN_TTL_MS;
  return {
    token: `g1.${uuid}.${exp}.${sign(uuid, exp)}`,
    guestId: `${GUEST_PREFIX}${uuid}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

/** İmza + süre doğrulaması. allowExpired: claim akışı süresi geçmiş ama imzası
 *  geçerli bileti kabul eder — kullanıcının çizimi kayıtta kaybolmasın. */
export function verifyGuestToken(
  token: string,
  opts: { allowExpired?: boolean } = {},
  now = Date.now(),
): GuestTokenPayload | null {
  if (!guestModeEnabled()) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "g1") return null;
  const [, uuid, expRaw, mac] = parts;
  const exp = Number(expRaw);
  if (!uuid || !Number.isFinite(exp) || !mac) return null;

  const expected = Buffer.from(sign(uuid, exp));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (!opts.allowExpired && exp < now) return null;

  return { guestId: `${GUEST_PREFIX}${uuid}`, expiresAt: exp };
}
