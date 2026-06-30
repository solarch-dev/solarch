import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { API_URL } from "../lib/env";

const BASE_URL = API_URL;

/** Typed openapi-fetch client. OSS local mode: no auth headers (backend injects owner identity). */
export const api = createClient<paths>({ baseUrl: BASE_URL, credentials: "include" });

/** Solarch envelope: { success, data } | { success:false, error }. */
export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: { field: string; issue: string }[];
    suggestion?: string;
    ruleViolated?: string;
    docLink?: string;
    currentVersion?: number;
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

export function unwrap<T>(res: { data?: unknown; error?: unknown }): T {
  if (res.error) {
    const e = res.error as ErrorEnvelope;
    if (e && e.error) throw new ApiError(e.error.code, e.error.message, e.error.details, e.error.suggestion);
    throw new ApiError("ERR_UNKNOWN", "An unexpected error occurred.");
  }
  const body = res.data as { success: boolean; data: T };
  return body.data;
}

export async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  let env: ErrorEnvelope | undefined;
  try { env = (await res.json()) as ErrorEnvelope; } catch { /* no body */ }
  const e = env?.error;
  throw new ApiError(e?.code ?? "ERR_UNKNOWN", e?.message ?? `HTTP ${res.status}`, e?.details, e?.suggestion);
}
