import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnauthorizedException } from "@nestjs/common";

vi.mock("../config/env", () => ({
  env: { GUEST_TOKEN_SECRET: "test-secret" },
}));

const getAuth = vi.fn();
vi.mock("@clerk/express", () => ({
  getAuth: (...a: unknown[]) => getAuth(...a),
}));

import { ClerkAuthGuard } from "./clerk-auth.guard";
import { mintGuestToken } from "./guest-token";
import type { AuthContext } from "./auth.types";

const verifyApiKey = vi.fn();
const fakeApiKeys = { verify: (...a: unknown[]) => verifyApiKey(...a) };

function ctxFor(req: Record<string, unknown>, isPublic = false) {
  const reflector = { getAllAndOverride: vi.fn(() => isPublic) };
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  };
  return {
    guard: new ClerkAuthGuard(reflector as never, fakeApiKeys as never),
    context: context as never,
    req,
  };
}

describe("ClerkAuthGuard", () => {
  beforeEach(() => {
    getAuth.mockReset();
    verifyApiKey.mockReset();
  });

  it("@Public route'lar auth'suz geçer", async () => {
    const { guard, context } = ctxFor({}, true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("Clerk oturumu → req.auth dolu, isGuest false", async () => {
    getAuth.mockReturnValue({ userId: "user_1", orgId: "org_1", orgRole: "org:admin" });
    const req: { auth?: AuthContext; headers: Record<string, string> } = { headers: {} };
    const { guard, context } = ctxFor(req);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.auth).toEqual({ userId: "user_1", orgId: "org_1", orgRole: "org:admin", isGuest: false });
  });

  it("geçerli API anahtarı (Bearer slk_) → anahtar sahibinin kimliği", async () => {
    getAuth.mockReturnValue({ userId: null });
    verifyApiKey.mockResolvedValue({ userId: "user_cli" });
    const req: { auth?: AuthContext; headers: Record<string, string> } = {
      headers: { authorization: "Bearer slk_abc123" },
    };
    const { guard, context } = ctxFor(req);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyApiKey).toHaveBeenCalledWith("slk_abc123");
    expect(req.auth).toEqual({ userId: "user_cli", orgId: null, orgRole: null, isGuest: false });
  });

  it("geçersiz API anahtarı → 401 ERR_API_KEY_INVALID (misafire düşmez)", async () => {
    getAuth.mockReturnValue({ userId: null });
    verifyApiKey.mockResolvedValue(null);
    const { guard, context } = ctxFor({ headers: { authorization: "Bearer slk_revoked" } });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("slk_ olmayan Bearer (Clerk JWT) API anahtarı yolunu tetiklemez", async () => {
    getAuth.mockReturnValue({ userId: null });
    const { guard, context } = ctxFor({ headers: { authorization: "Bearer eyJhbGciOi..." } });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it("geçerli X-Guest-Token → misafir kimliği, isGuest true", async () => {
    getAuth.mockReturnValue({ userId: null });
    const { token, guestId } = mintGuestToken();
    const req: { auth?: AuthContext; headers: Record<string, string> } = {
      headers: { "x-guest-token": token },
    };
    const { guard, context } = ctxFor(req);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.auth).toEqual({ userId: guestId, orgId: null, orgRole: null, isGuest: true });
  });

  it("cookie'deki bilet de kabul edilir (EventSource/SSE yolu)", async () => {
    getAuth.mockReturnValue({ userId: null });
    const { token, guestId } = mintGuestToken();
    const req: { auth?: AuthContext; headers: Record<string, string> } = {
      headers: { cookie: `other=1; solarch_guest_token=${token}; x=2` },
    };
    const { guard, context } = ctxFor(req);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.auth?.userId).toBe(guestId);
    expect(req.auth?.isGuest).toBe(true);
  });

  it("header cookie'ye önceliklidir", async () => {
    getAuth.mockReturnValue({ userId: null });
    const a = mintGuestToken();
    const b = mintGuestToken();
    const req: { auth?: AuthContext; headers: Record<string, string> } = {
      headers: { "x-guest-token": a.token, cookie: `solarch_guest_token=${b.token}` },
    };
    const { guard, context } = ctxFor(req);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.auth?.userId).toBe(a.guestId);
  });

  it("oturum yok + bilet yok → 401", async () => {
    getAuth.mockReturnValue({ userId: null });
    const { guard, context } = ctxFor({ headers: {} });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("geçersiz bilet → 401", async () => {
    getAuth.mockReturnValue({ userId: null });
    const { guard, context } = ctxFor({ headers: { "x-guest-token": "g1.fake.123.mac" } });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
