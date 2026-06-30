import { describe, it, expect, vi } from "vitest";

vi.mock("../config/env", () => ({
  env: { GUEST_TOKEN_SECRET: "test-secret" },
}));

import { mintGuestToken, verifyGuestToken, isGuestId, GUEST_TOKEN_TTL_MS } from "./guest-token";

describe("guest-token", () => {
  it("mint → verify roundtrip", () => {
    const minted = mintGuestToken();
    const payload = verifyGuestToken(minted.token);
    expect(payload).not.toBeNull();
    expect(payload!.guestId).toBe(minted.guestId);
    expect(payload!.guestId.startsWith("guest_")).toBe(true);
  });

  it("kurcalanmış token reddedilir", () => {
    const { token } = mintGuestToken();
    expect(verifyGuestToken(token.slice(0, -2) + "xx")).toBeNull();
    // uuid değişikliği imzayı bozar
    const parts = token.split(".");
    parts[1] = "11111111-1111-1111-1111-111111111111";
    expect(verifyGuestToken(parts.join("."))).toBeNull();
  });

  it("bozuk format reddedilir", () => {
    expect(verifyGuestToken("")).toBeNull();
    expect(verifyGuestToken("g2.a.b.c")).toBeNull();
    expect(verifyGuestToken("g1.yalnız-iki-parça")).toBeNull();
  });

  it("süresi geçmiş token reddedilir; allowExpired ile kabul (claim akışı)", () => {
    const mintedAt = Date.now() - GUEST_TOKEN_TTL_MS - 1_000;
    const { token, guestId } = mintGuestToken(mintedAt);
    expect(verifyGuestToken(token)).toBeNull();
    expect(verifyGuestToken(token, { allowExpired: true })?.guestId).toBe(guestId);
  });

  it("isGuestId guest_ önekini tanır", () => {
    expect(isGuestId("guest_abc")).toBe(true);
    expect(isGuestId("user_2abc")).toBe(false);
  });
});
