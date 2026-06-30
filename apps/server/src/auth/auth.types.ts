/** Identity placed on the request context (req.auth) — from LocalAuthGuard or API key. */
export interface AuthContext {
  /** Local owner id or API-key owner. */
  userId: string;
  /** Reserved for future workspace scoping. Always null in OSS edition. */
  orgId: string | null;
  /** Reserved for future workspace roles. Always null in OSS edition. */
  orgRole: string | null;
}
