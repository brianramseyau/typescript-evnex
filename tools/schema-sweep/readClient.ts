/**
 * The sweep's own thin, read-only HTTP client.
 *
 * Deliberately hand-rolled instead of reusing `Evnex` (`src/api.ts`) or the
 * package barrel (`src/index.ts`, which re-exports `Evnex`): `Evnex` bundles
 * every state-changing charger command (the override/stop/availability/
 * unlock/load-profile/schedule methods — see `test/tools/readonly-import.test.ts`
 * for the exact, named list this whole directory is checked against) into
 * one class, so importing it at all — even to call only its read methods —
 * would drag the mutators into this module's import graph, and a future
 * edit could then call one by accident with nothing structural stopping it.
 * This file imports only `Transport`/`withAuthFlow`/`withRetry` (pure
 * request plumbing, PLAN.md §5 A8) and error classes — never `Evnex` itself.
 *
 * The other reason not to reuse `Evnex`: its methods parse-and-throw
 * internally (`this.parse()`, `src/api.ts`), which discards the raw body the
 * moment validation fails — exactly the evidence this sweep exists to keep
 * (PLAN.md: "a ZodError must never destroy the payload that proves the
 * schema wrong"). This client always returns the raw body (or raw text, for
 * a body that didn't even parse as JSON) and lets the caller validate
 * separately (`diff.ts`).
 */

import { EvnexAuthError } from "../../src/errors.js";
import { ReauthenticationRequiredError } from "../../src/errors.js";
import { EvnexHttpError, EvnexTimeoutError } from "../../src/http/errors.js";
import type { RequestSpec, Transport } from "../../src/http/transport.js";
import { withAuthFlow } from "../../src/http/authFlow.js";
import type { AuthTokenSource } from "../../src/http/authFlow.js";
import { withRetry } from "../../src/http/retry.js";
import type { ErrorClass } from "../../src/http/retry.js";
import type { CaptureOutcome } from "./types.js";

export interface RawCaptureResult {
  outcome: Extract<
    CaptureOutcome,
    "ok" | "invalid-json" | "http-error" | "timeout" | "exception"
  >;
  httpStatus?: number | undefined;
  /** Only for outcome "ok" — the parsed JSON body (possibly `undefined` for an empty 2xx body). */
  rawJson?: unknown;
  /** For "invalid-json" / "http-error" — the raw text body, still unredacted at this point. */
  rawText?: string | undefined;
  /** Short, body-free description safe to fold straight into a report (never contains response content). */
  note?: string | undefined;
}

/**
 * Send one request and capture its raw outcome — no schema validation, no
 * redaction (both happen in `capture.ts`, after this returns). Retries per
 * `withRetry`'s policy (same semantics `src/api.ts`'s real read methods
 * use), then returns exactly once — "one shot per endpoint" per PLAN.md's
 * D5 sweep spec refers to not looping/polling an endpoint, not to skipping
 * the standing retry-on-transient-failure policy.
 *
 * Throws only `EvnexAuthError` (its subclasses, including a persistent 401
 * after the built-in single refresh-and-resend) — the one condition PLAN.md
 * says should stop the whole sweep rather than being recorded as a
 * per-endpoint finding. Every other failure (HTTP error, timeout, invalid
 * JSON, an unexpected exception) is captured as data and returned normally.
 */
export async function captureEndpointRaw(
  transport: Transport,
  auth: AuthTokenSource,
  spec: RequestSpec,
  nonRetryable: readonly ErrorClass[] = [],
): Promise<RawCaptureResult> {
  try {
    const send = withAuthFlow(transport, auth);
    const response = await withRetry(() => send(spec), { nonRetryable });

    if (response.status === 401) {
      // withAuthFlow already refreshed-and-resent once internally; a 401
      // that survives that means the session itself is no longer usable —
      // abort the sweep rather than recording 14 consecutive auth failures.
      throw new ReauthenticationRequiredError(
        "Request still unauthorized after refreshing the session — aborting the sweep " +
          "rather than recording every remaining endpoint as an auth failure. Sign in " +
          "again and re-run; already-captured endpoints are skipped on resume.",
      );
    }

    const text = await response.text();

    if (!response.ok) {
      return {
        outcome: "http-error",
        httpStatus: response.status,
        rawText: text,
        note: `HTTP ${response.status}`,
      };
    }

    if (text.length === 0) {
      return { outcome: "ok", httpStatus: response.status, rawJson: undefined };
    }

    try {
      const rawJson = JSON.parse(text) as unknown;
      return { outcome: "ok", httpStatus: response.status, rawJson };
    } catch {
      return {
        outcome: "invalid-json",
        httpStatus: response.status,
        rawText: text,
        note: "2xx response body did not parse as JSON",
      };
    }
  } catch (err) {
    if (err instanceof EvnexAuthError) {
      throw err;
    }
    if (err instanceof EvnexTimeoutError) {
      return { outcome: "timeout", note: err.message };
    }
    if (err instanceof EvnexHttpError) {
      // Not expected on this code path (this client checks `response.ok`
      // itself rather than calling `ensureSuccess`), but handled defensively
      // in case a future edit routes an EvnexHttpError through here.
      return { outcome: "http-error", httpStatus: err.status, note: err.message };
    }
    return {
      outcome: "exception",
      note: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}
