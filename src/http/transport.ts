/**
 * HTTP transport — ported from `evnex/api.py`'s `_request`,
 * `_check_api_response`, and `_ensure_success` (PLAN.md §5 A8).
 *
 * TODO(A8): implement.
 *
 * - Base-URL joining, the three common headers (`Accept`,
 *   `content-type: application/json`, `User-Agent: evnex/<version>`).
 * - `AbortSignal.timeout(ms)` on every request; an abort becomes
 *   `EvnexTimeoutError`, never a raw `AbortError` (default 30s, matching
 *   httpx; explicit per-call timeouts from Python are carried over verbatim
 *   — PLAN.md §2.7).
 * - `x-correlation-id` is captured onto `EvnexHttpError.correlationId`
 *   (PLAN.md §10.6). Error *messages* carry status, path, and correlation id
 *   only — the raw response body stays on `cause`.
 */

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface RequestSpec {
  method: string;
  /** Relative to the transport's base URL; must start with "/". */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON-serialisable request body. */
  json?: unknown;
  /** Overrides the transport's default timeout for this call. */
  timeoutMs?: number;
}

export interface TransportOptions {
  baseUrl: string;
  /** Injection point replacing "optionally pass in an httpx client". */
  fetch?: FetchLike;
  /** Client version, embedded in the `User-Agent` header. */
  version?: string;
  /** Default request timeout in ms. */
  defaultTimeoutMs?: number;
}

/** Sends one HTTP request: base-URL join, common headers, and the timeout. */
export class Transport {
  constructor(options: TransportOptions) {
    throw new Error("TODO(A8)");
  }

  /** Send a request. Does not inject auth, check the status, or parse the body. */
  async send(spec: RequestSpec, headers?: Record<string, string>): Promise<Response> {
    throw new Error("TODO(A8)");
  }
}

/**
 * Raise `EvnexHttpError` (correlation id attached) for a non-2xx response,
 * or `ReauthenticationRequiredError` for a 401 (the auth flow already
 * refreshed and resent once; a 401 here means the renewed session is still
 * rejected).
 */
export function ensureSuccess(response: Response, path: string): void {
  throw new Error("TODO(A8)");
}

/** `ensureSuccess`, then parse and return the JSON body. */
export async function checkApiResponse(response: Response, path: string): Promise<unknown> {
  throw new Error("TODO(A8)");
}
