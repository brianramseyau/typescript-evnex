/**
 * HTTP-transport errors — ported from the httpx exception surface used by
 * `evnex/api.py` (`HTTPStatusError`, `ReadTimeout`).
 *
 * TODO(A1): implement. `EvnexHttpError.message` carries status, path, and
 * correlation id only — the raw response body stays on `cause` and never
 * reaches a user-facing string, since error payloads can echo request
 * details back (PLAN.md §10.6). `x-correlation-id` is a pure addition over
 * python-evnex, which discards it.
 */

import { EvnexError } from "../errors.js";

export interface EvnexHttpErrorOptions extends ErrorOptions {
  status: number;
  path: string;
  /** The raw, unparsed response body — never included in `.message`. */
  body?: unknown;
  correlationId?: string | undefined;
}

/** A non-2xx HTTP response from the EVNEX API. */
export class EvnexHttpError extends EvnexError {
  readonly status!: number;
  readonly path!: string;
  readonly body: unknown;
  readonly correlationId: string | undefined;

  constructor(message: string, options: EvnexHttpErrorOptions) {
    super(message, options);
    throw new Error("TODO(A1)");
  }
}

/** A request timed out (`httpx.ReadTimeout` analogue). */
export class EvnexTimeoutError extends EvnexError {
  readonly path!: string;

  constructor(message: string, options: { path: string } & ErrorOptions) {
    super(message, options);
    throw new Error("TODO(A1)");
  }
}
