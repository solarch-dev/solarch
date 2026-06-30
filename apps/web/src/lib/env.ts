/** The SINGLE place frontend env values are read.
 *  Rule: never hardcode values — everything comes from VITE_* env; if a value a
 *  feature needs is empty, a "[env] ... is not set" warning is logged and that
 *  feature stays off. (Vite inlines env values at build time: after adding a
 *  value, a rebuild is required.)
 *
 *  Note: import.meta.env.X accesses must be written as literals for Vite's
 *  static replacement — that's why each value is read individually. */

function warn(name: string, consequence: string): void {
  console.warn(`[env] ${name} is not set — ${consequence}.`);
}

/** Empty = same-origin (/api) — intentional design (Clerk httpOnly cookie flows
 *  on the same origin, a reverse proxy splits it in prod). No warning needed. */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

/** Without Clerk the app cannot authenticate — warn in every environment. */
export const CLERK_PUBLISHABLE_KEY: string | undefined = (() => {
  const v = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  if (!v) warn("VITE_CLERK_PUBLISHABLE_KEY", "authentication will not work");
  return v || undefined;
})();

/** PostHog: both token + host are required. Running without a token in dev is
 *  normal (analytics intentionally off) → warn only in prod build; a token with
 *  no host is a misconfiguration → warn in every environment. */
export const POSTHOG = (() => {
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN as string | undefined;
  const host = import.meta.env.VITE_POSTHOG_HOST as string | undefined;
  if (!token && import.meta.env.PROD) {
    warn("VITE_POSTHOG_PROJECT_TOKEN", "analytics is disabled");
  }
  if (token && !host) {
    warn("VITE_POSTHOG_HOST", "analytics is disabled (set us.i or eu.i host)");
  }
  return { token: token || undefined, host: host || undefined, enabled: !!token && !!host };
})();
