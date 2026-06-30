/** Clerk OAuth redirect targets (must match dashboard allowed redirect URLs). */
export const SSO_CALLBACK_PATH = "/sso-callback";
export const AUTH_COMPLETE_PATH = "/start";

export type OAuthProvider = "google" | "github";

export const OAUTH_STRATEGIES = {
  google: "oauth_google",
  github: "oauth_github",
} as const satisfies Record<OAuthProvider, `oauth_${string}`>;

export type OAuthStrategy = (typeof OAUTH_STRATEGIES)[OAuthProvider];
