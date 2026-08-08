import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EvnexAuthError,
  EvnexConfigurationError,
  EvnexValidationError,
  InvalidCredentialsError,
} from "../../src/errors.js";
import { EvnexHttpError, EvnexTimeoutError } from "../../src/http/errors.js";
import { computeDelayMs, withRetry } from "../../src/http/retry.js";

/** A test seam delay that never actually sleeps, and records every call. */
function noSleepDelay(): { delay: (attempt: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    delay: async (attempt: number) => {
      calls.push(attempt);
    },
  };
}

class RetryableError extends Error {}

describe("computeDelayMs — the uniform-over-window draw", () => {
  it("draws uniformly across [0, window), not a fixed backoff floor plus jitter", () => {
    // If this were full backoff-with-jitter-on-top (a floor of
    // 1000 * 2**n with jitter added), the minimum possible delay would be
    // that floor, never 0. The literal formula in PLAN.md §2.5 is
    // `random() * window`, so a random() of exactly 0 must yield exactly 0.
    expect(computeDelayMs(1, () => 0)).toBe(0);
    expect(computeDelayMs(4, () => 0)).toBe(0);
  });

  it("the window is min(60_000, 1000 * 2**attempt), reached at random()=1", () => {
    expect(computeDelayMs(1, () => 1)).toBe(2_000);
    expect(computeDelayMs(2, () => 1)).toBe(4_000);
    expect(computeDelayMs(3, () => 1)).toBe(8_000);
    expect(computeDelayMs(4, () => 1)).toBe(16_000);
  });

  it("caps the window at 60_000ms for large attempt numbers", () => {
    // 1000 * 2**6 = 64_000 > 60_000, so the window is capped.
    expect(computeDelayMs(6, () => 1)).toBe(60_000);
    expect(computeDelayMs(20, () => 1)).toBe(60_000);
  });

  it("scales linearly with the injected random draw inside the window", () => {
    expect(computeDelayMs(1, () => 0.5)).toBe(1_000);
  });

  it("defaults to Math.random when no random function is supplied", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.25);
    try {
      expect(computeDelayMs(1)).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("withRetry — 5-attempt cap and delay distribution", () => {
  it("makes exactly 5 total attempts (1 initial + 4 retries) before reraising", async () => {
    const { delay, calls } = noSleepDelay();
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      throw new RetryableError("transient");
    });

    await expect(withRetry(fn, { delay })).rejects.toThrow(RetryableError);

    expect(attempts).toBe(5);
    expect(fn).toHaveBeenCalledTimes(5);
    // 4 retries, delayed before attempts 2..5 — i.e. retry numbers 1..4.
    expect(calls).toEqual([1, 2, 3, 4]);
  });

  it("reraises the exact underlying error instance, never a wrapper", async () => {
    const { delay } = noSleepDelay();
    const original = new RetryableError("boom");
    const fn = vi.fn(async () => {
      throw original;
    });

    await expect(withRetry(fn, { delay })).rejects.toBe(original);
  });

  it("succeeds without retrying when fn succeeds on the first attempt", async () => {
    const { delay, calls } = noSleepDelay();
    const fn = vi.fn(async () => "ok");

    await expect(withRetry(fn, { delay })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it("succeeds after a transient failure without exhausting all attempts", async () => {
    const { delay, calls } = noSleepDelay();
    let call = 0;
    const fn = vi.fn(async () => {
      call += 1;
      if (call < 3) {
        throw new RetryableError("transient");
      }
      return "recovered";
    });

    await expect(withRetry(fn, { delay })).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([1, 2]);
  });

  for (const ErrorClass of [
    EvnexValidationError,
    EvnexAuthError,
    EvnexConfigurationError,
    InvalidCredentialsError, // an EvnexAuthError subclass
  ]) {
    it(`never retries the standing non-retryable type ${ErrorClass.name}`, async () => {
      const { delay, calls } = noSleepDelay();
      const fn = vi.fn(async () => {
        throw new ErrorClass("not retryable");
      });

      await expect(withRetry(fn, { delay })).rejects.toBeInstanceOf(ErrorClass);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([]);
    });
  }

  it("never retries per-call additions to nonRetryable", async () => {
    const { delay, calls } = noSleepDelay();
    const fn = vi.fn(async () => {
      throw new EvnexHttpError("boom", { status: 500, path: "/x" });
    });

    await expect(
      withRetry(fn, { delay, nonRetryable: [EvnexHttpError] }),
    ).rejects.toBeInstanceOf(EvnexHttpError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it("still retries a type absent from the per-call nonRetryable set", async () => {
    const { delay, calls } = noSleepDelay();
    const fn = vi.fn(async () => {
      throw new EvnexTimeoutError("timed out", { path: "/x" });
    });

    // nonRetryable only excludes EvnexHttpError here, so EvnexTimeoutError
    // is still retried up to the 5-attempt cap.
    await expect(
      withRetry(fn, { delay, nonRetryable: [EvnexHttpError] }),
    ).rejects.toBeInstanceOf(EvnexTimeoutError);
    expect(fn).toHaveBeenCalledTimes(5);
    expect(calls).toEqual([1, 2, 3, 4]);
  });

  describe("default delay (real timer path)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("uses a real timer-based delay when no delay override is given, without wall-clock sleep", async () => {
      let call = 0;
      const fn = vi.fn(async () => {
        call += 1;
        if (call < 2) {
          throw new RetryableError("transient");
        }
        return "ok";
      });

      const promise = withRetry(fn);
      // Let the fake clock run out the real setTimeout-based delay.
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
