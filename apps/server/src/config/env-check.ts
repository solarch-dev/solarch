import { env } from "./env";

/** Boot'ta env sağlık denetimi.
 *  Şemada default("") olan ama özellik için ZORUNLU değerler boşsa tek tek uyarır —
 *  hangi özelliğin neden çalışmayacağı log'dan okunur. (NEO4J_* gibi gerçek
 *  zorunlular zaten Zod parse'ında boot'u durdurur, buraya gelmez.)
 *  Test ortamında susar. */
export function warnMissingEnv(logger: { warn(msg: string): void } = console): void {
  if (env.NODE_ENV === "test") return;

  const checks: { ok: boolean; name: string; consequence: string }[] = [
    { ok: !!env.CLERK_SECRET_KEY, name: "CLERK_SECRET_KEY", consequence: "authentication will not work" },
    { ok: !!env.CLERK_PUBLISHABLE_KEY, name: "CLERK_PUBLISHABLE_KEY", consequence: "Clerk client config incomplete" },
    { ok: !!env.GUEST_TOKEN_SECRET, name: "GUEST_TOKEN_SECRET", consequence: "guest mode disabled (POST /auth/guest returns 503)" },
    { ok: !!env.POLAR_ACCESS_TOKEN, name: "POLAR_ACCESS_TOKEN", consequence: "billing checkout/portal will fail" },
    { ok: !!env.POLAR_WEBHOOK_SECRET, name: "POLAR_WEBHOOK_SECRET", consequence: "Polar webhooks cannot be verified" },
    { ok: !!env.POLAR_PRODUCT_DRAW, name: "POLAR_PRODUCT_DRAW", consequence: "Draw plan cannot be matched/purchased" },
    { ok: !!env.POLAR_PRODUCT_BUILD, name: "POLAR_PRODUCT_BUILD", consequence: "Build plan cannot be matched/purchased" },
    { ok: !!env.POLAR_PRODUCT_CODE, name: "POLAR_PRODUCT_CODE", consequence: "Code plan cannot be matched/purchased" },
  ];

  // AI sağlayıcısına göre koşullu zorunlular.
  const providers = new Set([env.LLM_GENERATION_PROVIDER, env.LLM_CHAT_PROVIDER]);
  if (providers.has("deepseek")) {
    checks.push({ ok: !!env.DEEPSEEK_API_KEY, name: "DEEPSEEK_API_KEY", consequence: "AI chat/generation returns 503" });
  }
  if (providers.has("bedrock")) {
    checks.push(
      { ok: !!env.BEDROCK_API_KEY, name: "BEDROCK_API_KEY", consequence: "Bedrock AI provider will fail" },
      { ok: !!env.BEDROCK_BASE_URL, name: "BEDROCK_BASE_URL", consequence: "Bedrock AI provider will fail" },
    );
  }

  // Prod'a özel sıkılaştırma uyarıları.
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
