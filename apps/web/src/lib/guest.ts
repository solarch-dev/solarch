/** Guest mode (single-project trial without login).
 *  A signed "guest ticket" is fetched from the backend, kept in localStorage, and
 *  added as the X-Guest-Token header on every API request while there is no Clerk session.
 *  Since EventSource (AI SSE) cannot carry headers, the ticket is ALSO written to a cookie —
 *  the backend falls back to the cookie when no header is present. The backend treats the
 *  ticket like a real user identity (guest plan). On signup the project is claimed and the
 *  ticket is cleared. */

import { useAuth } from "@clerk/clerk-react";

const KEY = "solarch:guest-token";
const COOKIE = "solarch_guest_token";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // same as ticket lifetime: 30 days

/** Mirror the ticket into a cookie — SSE (EventSource) carries identity via cookie. */
function syncGuestCookie(token: string | null): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = token
      ? `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`
      : `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  } catch {
    /* cookie could not be written — header-based requests still work */
  }
}

export function getGuestToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearGuestToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — non-critical */
  }
  syncGuestCookie(null);
}

/** If no ticket exists, mint a new one from the backend. Returns null if guest mode
 *  is disabled (503) → caller redirects to sign-in. 429 (throttle on a shared IP) is
 *  transient: wait briefly and retry once — don't drop to login on the first attempt. */
export async function ensureGuestToken(): Promise<string | null> {
  const existing = getGuestToken();
  if (existing) {
    // For existing ticket holders (including those minted before the cookie feature),
    // refresh the cookie on every session start.
    syncGuestCookie(existing);
    return existing;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("/api/v1/auth/guest", { method: "POST" });
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 3_000));
        continue;
      }
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: { token?: string } };
      const token = body?.data?.token;
      if (!token) return null;
      localStorage.setItem(KEY, token);
      syncGuestCookie(token);
      return token;
    } catch {
      return null;
    }
  }
  return null;
}

/** Guest header to add when there is no Clerk token. */
export function guestHeaders(): Record<string, string> {
  const token = getGuestToken();
  return token ? { "X-Guest-Token": token } : {};
}

/** Is the active session a guest? (Clerk loaded + signed-out + ticket present) */
export function useIsGuest(): boolean {
  const { isLoaded, isSignedIn } = useAuth();
  return isLoaded && !isSignedIn && !!getGuestToken();
}

/** Open the signup modal in TopBar from anywhere (LockedAiBar, OmniBar, ...). */
export function openGuestSignupModal(): void {
  window.dispatchEvent(new CustomEvent("solarch:guest-signup-open"));
}
