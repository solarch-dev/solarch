import { describe, it, expect, beforeEach } from "vitest";
import { UserThrottlerGuard } from "./user-throttler.guard";

describe("UserThrottlerGuard", () => {
  let guard: UserThrottlerGuard;

  beforeEach(() => {
    guard = new UserThrottlerGuard({} as never, {} as never, {} as never);
  });

  it("tracks req.auth.userId when present", async () => {
    const tracker = await guard["getTracker"]({
      auth: { userId: "user_abc", orgId: null, orgRole: null },
      ip: "203.0.113.5",
    });
    expect(tracker).toBe("user_abc");
  });

  it("falls back to IP when auth is missing", async () => {
    const tracker = await guard["getTracker"]({ ip: "203.0.113.5" });
    expect(tracker).toBe("203.0.113.5");
  });

  it("falls back to anon when no userId and no IP", async () => {
    const tracker = await guard["getTracker"]({ auth: { orgId: null, orgRole: null } });
    expect(tracker).toBe("anon");
  });
});
