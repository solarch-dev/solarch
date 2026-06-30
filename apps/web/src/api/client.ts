import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { getGuestToken } from "../lib/guest";
import { API_URL } from "../lib/env";

// Empty = relative (same-origin). In dev Vite proxy (/api → :4000), in prod reverse
// proxy handles it; this way the Clerk httpOnly cookie (__session) flows to the backend.
const BASE_URL = API_URL;

/** Clerk session token (Bearer). Supplement/backup to cookie: after signup/signin
 *  the __session cookie may not be written yet → getToken() always provides a fresh
 *  token, avoiding a 401 race on initial requests. Returns null if not signed in. */
export async function getClerkToken(): Promise<string | null> {
  const clerk = (window as unknown as {
    Clerk?: { session?: { getToken?: () => Promise<string | null> } };
  }).Clerk;
  try {
    return (await clerk?.session?.getToken?.()) ?? null;
  } catch {
    return null;
  }
}

/** Typed openapi-fetch client. Path/param/body types come from schema.d.ts.
 *  credentials:"include" → cookie; additionally a Bearer token is attached to every request. */
export const api = createClient<paths>({ baseUrl: BASE_URL, credentials: "include" });

// Backend clerkMiddleware accepts cookie OR Authorization Bearer. By attaching
// Bearer to every request we ensure robust auth independent of cookie timing.
// No Clerk session → guest ticket (X-Guest-Token) if present (login'siz deneme).
api.use({
  async onRequest({ request }) {
    const token = await getClerkToken();
    if (token) {
      request.headers.set("Authorization", `Bearer ${token}`);
    } else {
      const guest = getGuestToken();
      if (guest) request.headers.set("X-Guest-Token", guest);
    }
    return request;
  },
});

/** Solarch envelope: { success, data } | { success:false, error }. */
export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: { field: string; issue: string }[];
    suggestion?: string;       // Fix suggestion on Rules Engine rejection
    ruleViolated?: string;
    docLink?: string;
    currentVersion?: number;   // version conflict
  };
}

export class ApiError extends Error {
  code: string;
  details?: { field: string; issue: string }[];
  suggestion?: string;
  constructor(code: string, message: string, details?: { field: string; issue: string }[], suggestion?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.suggestion = suggestion;
  }
}

/** Unwraps the envelope from an openapi-fetch result; throws ApiError on failure. */
export function unwrap<T>(res: { data?: unknown; error?: unknown }): T {
  if (res.error) {
    const e = res.error as ErrorEnvelope;
    if (e && e.error) throw new ApiError(e.error.code, e.error.message, e.error.details, e.error.suggestion);
    throw new ApiError("ERR_UNKNOWN", "An unexpected error occurred.");
  }
  const body = res.data as { success: boolean; data: T };
  return body.data;
}

/** Shared error gate for raw fetch (raw.ts): if res.ok is false, throw ApiError
 *  from the envelope → no silent swallowing, error reaches global toast/caller. */
export async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  let env: ErrorEnvelope | undefined;
  try { env = (await res.json()) as ErrorEnvelope; } catch { /* no body / not JSON */ }
  const e = env?.error;
  throw new ApiError(e?.code ?? "ERR_UNKNOWN", e?.message ?? `HTTP ${res.status}`, e?.details, e?.suggestion);
}
