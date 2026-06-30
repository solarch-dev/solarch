/**
 * transport.ts — the request/response transport seam shared by the API reference.
 *
 * `SendFn` is the single point Plan 2's VS Code bridge plugs into: when a host supplies it, the
 * Try-it console routes the request through the host (the extension's local proxy) instead of the
 * browser `fetch`. Kept in its own pure module (no React, no app imports) so every reference
 * component imports it from one place — no import cycle, fully portable for the standalone bundle.
 */

/** A request the Try-it console builds and a transport sends. */
export interface ApiRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** The normalized response a transport returns (status + timing + headers + raw text body). */
export interface ApiResponse {
  status: number;
  statusText?: string;
  durationMs?: number;
  headers?: Record<string, string>;
  body: string;
}

/** The send seam: when provided, the Try-it console calls this instead of `fetch` (Plan 2 bridge). */
export type SendFn = (req: ApiRequest) => Promise<ApiResponse>;
