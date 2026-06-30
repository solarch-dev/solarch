import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnauthorizedException } from "@nestjs/common";

vi.mock("../config/env", () => ({
  env: { LOCAL_USER_ID: "local_owner" },
}));

import { LocalAuthGuard } from "./local-auth.guard";
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
    guard: new LocalAuthGuard(reflector as never, fakeApiKeys as never),
    context: context as never,
    req,
  };
}

describe("LocalAuthGuard", () => {
  beforeEach(() => {
    verifyApiKey.mockReset();
  });

  it("@Public routes skip auth", async () => {
    const { guard, context } = ctxFor({}, true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("no API key → injects LOCAL_USER_ID", async () => {
    const req: { auth?: AuthContext; headers: Record<string, string> } = { headers: {} };
    const { guard, context } = ctxFor(req);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.auth).toEqual({ userId: "local_owner", orgId: null, orgRole: null });
  });

  it("valid API key (Bearer slk_) → key owner's identity", async () => {
    verifyApiKey.mockResolvedValue({ userId: "user_cli" });
    const req: { auth?: AuthContext; headers: Record<string, string> } = {
      headers: { authorization: "Bearer slk_abc123" },
    };
    const { guard, context } = ctxFor(req);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyApiKey).toHaveBeenCalledWith("slk_abc123");
    expect(req.auth).toEqual({ userId: "user_cli", orgId: null, orgRole: null });
  });

  it("valid API key (X-Solarch-Api-Key) → key owner's identity", async () => {
    verifyApiKey.mockResolvedValue({ userId: "user_cli" });
    const req: { auth?: AuthContext; headers: Record<string, string> } = {
      headers: { "x-solarch-api-key": "slk_abc123" },
    };
    const { guard, context } = ctxFor(req);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyApiKey).toHaveBeenCalledWith("slk_abc123");
    expect(req.auth).toEqual({ userId: "user_cli", orgId: null, orgRole: null });
  });

  it("invalid API key → 401 ERR_API_KEY_INVALID", async () => {
    verifyApiKey.mockResolvedValue(null);
    const { guard, context } = ctxFor({ headers: { authorization: "Bearer slk_revoked" } });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
