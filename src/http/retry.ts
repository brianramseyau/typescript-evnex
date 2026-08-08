/**
 * Retry policy — a hand-written port of `evnex/api.py`'s `tenacity`
 * configuration (`api_retry`), mirroring its semantics exactly (PLAN.md §2.5).
 *
 * - 5 total attempts (1 initial + 4 retries), not 5 retries.
 * - Delay before attempt n (1-indexed retries) is
 *   `Math.random() * Math.min(60_000, 1000 * 2 ** n)` — a *uniform* draw
 *   across the whole window, not full backoff with jitter added on top.
 * - Surface the underlying error, never a wrapper (`reraise=True` analogue).
 * - Never-retryable, always: EvnexValidationError, EvnexAuthError,
 *   EvnexConfigurationError. Plus whatever `nonRetryable` adds per call site
 *   (PLAN.md §2.5's per-method table).
 */

import {
  EvnexAuthError,
  EvnexConfigurationError,
  EvnexValidationError,
} from "../errors.js";

/**
 * A constructor for an `Error` subtype, used to classify non-retryable
 * failures by `instanceof`. Accepts any Error subclass regardless of its own
 * constructor parameter list.
 */
export type ErrorClass = new (...args: never[]) => Error;

export interface WithRetryOptions {
  /** Exception types that are never retried, in addition to the standing set. */
  nonRetryable?: readonly ErrorClass[];
  /**
   * Test seam: override the delay function so tests do not actually sleep
   * (the `wait_none()` analogue). Receives the 1-indexed retry attempt
   * number. Defaults to a real, uniform-jittered `setTimeout` delay.
   */
  delay?: (attempt: number) => Promise<void>;
}

/** 1 initial attempt + 4 retries — not 5 retries. */
const MAX_ATTEMPTS = 5;

const STANDING_NON_RETRYABLE: readonly ErrorClass[] = [
  EvnexValidationError,
  EvnexAuthError,
  EvnexConfigurationError,
];

/**
 * The uniform-over-window draw for the delay before retry `attempt`
 * (1-indexed): `random() * Math.min(60_000, 1000 * 2 ** attempt)`. This is
 * *not* full exponential backoff with jitter layered on top (a floor of
 * `1000 * 2 ** attempt` with jitter added) — the classic tenacity mis-port
 * (PLAN.md §2.5, risk register #4). `random` is a seam for deterministic
 * distribution tests.
 */
export function computeDelayMs(attempt: number, random: () => number = Math.random): number {
  const windowMs = Math.min(60_000, 1000 * 2 ** attempt);
  return random() * windowMs;
}

function defaultDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, computeDelayMs(attempt));
  });
}

function isNonRetryable(err: unknown, classes: readonly ErrorClass[]): boolean {
  return classes.some((cls) => err instanceof cls);
}

/** Run `fn`, retrying transient failures with the policy described above. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: WithRetryOptions,
): Promise<T> {
  const nonRetryable = [...STANDING_NON_RETRYABLE, ...(options?.nonRetryable ?? [])];
  const delay = options?.delay ?? defaultDelay;

  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      // reraise=True analogue: on exhaustion or a non-retryable exception,
      // surface the underlying error unchanged — never a wrapper.
      if (attempt >= MAX_ATTEMPTS || isNonRetryable(err, nonRetryable)) {
        throw err;
      }
      await delay(attempt);
    }
  }
}
