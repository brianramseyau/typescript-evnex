/**
 * Request authentication flow — ported from `evnex/auth.py`'s
 * `EvnexHttpxAuth` (PLAN.md §5 A8).
 *
 * TODO(A8): implement.
 *
 * Inject `Authorization: <accessToken>` — the bare token, **no** `Bearer`
 * prefix, and the *access* token, never the id token. Confirmed live by two
 * independent implementations (PLAN.md §10.5) — this is the kind of detail a
 * future contributor "fixes" to look more standard; do not "fix" it. On a
 * 401, call `forceRefresh({ staleAccessToken })` and resend **once**. A 401
 * after that becomes `ReauthenticationRequiredError`. A 401 means the server
 * rejected the request before executing it, so the single resend is safe
 * even for command endpoints.
 */

import type { RequestSpec, Transport } from "./transport.js";

/** The subset of `CognitoSession` (B1) that the auth flow needs. */
export interface AuthTokenSource {
  getAccessToken(): Promise<string>;
  forceRefresh(options: { staleAccessToken: string | undefined }): Promise<unknown>;
}

/**
 * Wrap a `Transport`'s `send` with bare-token `Authorization` injection and
 * a single 401 refresh-and-resend.
 */
export function withAuthFlow(
  transport: Transport,
  auth: AuthTokenSource,
): (spec: RequestSpec) => Promise<Response> {
  throw new Error("TODO(A8)");
}
