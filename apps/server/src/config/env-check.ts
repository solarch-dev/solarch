import { env } from "./env";
import { providerStatus, type LlmProvider } from "../ai/providers/llm.factory";

/** Boot-time env health check. Values that default to "" but are REQUIRED for a feature are
 *  reported one-by-one, so the log explains which feature won't work and why. (Truly required
 *  vars like NEO4J_* already hard-fail in Zod parse and never reach here.) Silent under test. */
export function warnMissingEnv(logger: { warn(msg: string): void } = console): void {
  if (env.NODE_ENV === "test") return;

  const checks: { ok: boolean; name: string; consequence: string }[] = [];

  // AI providers: warn if the active generation/chat provider is not configured (registry-driven).
  const providers = new Set<LlmProvider>([env.LLM_GENERATION_PROVIDER, env.LLM_CHAT_PROVIDER]);
  for (const p of providers) {
    const { configured, envHint } = providerStatus(p);
    checks.push({ ok: configured, name: envHint, consequence: `AI provider "${p}" is unavailable (/ai/* returns 503)` });
  }

  for (const c of checks) {
    if (!c.ok) logger.warn(`[env] ${c.name} is not set — ${c.consequence}.`);
  }
}
