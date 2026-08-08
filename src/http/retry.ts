/**
 * Retry policy — a hand-written port of `evnex/api.py`'s `tenacity`
 * configuration (`api_retry`), mirroring its semantics exactly (PLAN.md §2.5).
 *
 * TODO(A8): implement.
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

/** Run `fn`, retrying transient failures with the policy described above. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: WithRetryOptions,
): Promise<T> {
  throw new Error("TODO(A8)");
}
