import { env } from "./env";
import { providerStatus, type LlmProvider } from "../ai/providers/llm.factory";

/** Boot-time env health check. Values that default to "" but are REQUIRED for a feature are
 *  reported one-by-one, so the log explains which feature won't work and why. (Truly required
 *  vars like NEO4J_* already hard-fail in Zod parse and never reach here.) Silent under test. */
export function warnMissingEnv(logger: { warn(msg: string): void } = console): void {
  if (env.NODE_ENV === "test") return;

  const checks: { ok: boolean; name: string; consequence: string }[] = [
    { ok: !!env.CLERK_SECRET_KEY, name: "CLERK_SECRET_KEY", consequence: "authentication will not work" },
    { ok: !!env.CLERK_PUBLISHABLE_KEY, name: "CLERK_PUBLISHABLE_KEY", consequence: "Clerk client config incomplete" },
    { ok: !!env.GUEST_TOKEN_SECRET, name: "GUEST_TOKEN_SECRET", consequence: "guest mode disabled (POST /auth/guest returns 503)" },
  ];

  // AI providers: warn if the active generation/chat provider is not configured (registry-driven).
  const providers = new Set<LlmProvider>([env.LLM_GENERATION_PROVIDER, env.LLM_CHAT_PROVIDER]);
  for (const p of providers) {
    const { configured, envHint } = providerStatus(p);
    checks.push({ ok: configured, name: envHint, consequence: `AI provider "${p}" is unavailable (/ai/* returns 503)` });
  }

  // Polar checks only matter when billing is enabled (SaaS). Self-host (BILLING_ENABLED=false)
  // runs unlimited and needs no Polar config.
  if (env.BILLING_ENABLED) {
    checks.push(
      { ok: !!env.POLAR_ACCESS_TOKEN, name: "POLAR_ACCESS_TOKEN", consequence: "billing checkout/portal will fail" },
      { ok: !!env.POLAR_WEBHOOK_SECRET, name: "POLAR_WEBHOOK_SECRET", consequence: "Polar webhooks cannot be verified" },
      { ok: !!env.POLAR_PRODUCT_DRAW, name: "POLAR_PRODUCT_DRAW", consequence: "Draw plan cannot be matched/purchased" },
      { ok: !!env.POLAR_PRODUCT_BUILD, name: "POLAR_PRODUCT_BUILD", consequence: "Build plan cannot be matched/purchased" },
      { ok: !!env.POLAR_PRODUCT_CODE, name: "POLAR_PRODUCT_CODE", consequence: "Code plan cannot be matched/purchased" },
    );
  }

  // Production-only hardening warnings.
  if (env.NODE_ENV === "production") {
    checks.push({
      ok: !!env.CLERK_AUTHORIZED_PARTIES,
      name: "CLERK_AUTHORIZED_PARTIES",
      consequence: "CSRF protection (authorizedParties) is off in production",
    });
  }

  for (const c of checks) {
    if (!c.ok) logger.warn(`[env] ${c.name} is not set — ${c.consequence}.`);
  }
}
