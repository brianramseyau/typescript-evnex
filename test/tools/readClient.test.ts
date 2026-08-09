/**
 * `readClient.ts`'s raw-capture behaviour: every outcome PLAN.md's D5 spec
 * says must be recorded as data rather than aborting the sweep (HTTP error,
 * timeout, invalid JSON, an unexpected exception), plus the one condition
 * that legitimately does abort it (a 401 surviving the built-in
 * refresh-and-resend).
 */

import { describe, expect, it, vi } from "vitest";
import { captureEndpointRaw } from "../../tools/schema-sweep/readClient.js";
import { Transport } from "../../src/http/transport.js";
import type { FetchLike } from "../../src/http/transport.js";
import type { AuthTokenSource } from "../../src/http/authFlow.js";
import { EvnexAuthError } from "../../src/errors.js";
import { createStubFetch } from "../support/stubFetch.js";

/**
 * Run `fn` under fake timers so a real retry's backoff delay (an untouched
 * generic error is not in `withRetry`'s standing non-retryable set, so it
 * retries up to 5 attempts, same as `test/api.test.ts`'s own helper of the
 * same name) costs no wall-clock time.
 */
async function withFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const promise = fn();
    await vi.runAllTimersAsync();
    return await promise;
  } finally {
    vi.useRealTimers();
  }
}

function fakeAuth(overrides: Partial<AuthTokenSource> = {}): AuthTokenSource {
  return {
    getAccessToken: () => Promise.resolve("access-token"),
    forceRefresh: () => Promise.resolve(undefined),
    ...overrides,
  };
}

const SPEC = { method: "GET", path: "/v2/apps/user" } as const;

describe("captureEndpointRaw", () => {
  it("returns outcome ok with the parsed body on a clean 2xx JSON response", async () => {
    const stub = createStubFetch([
      { method: "GET", path: "/v2/apps/user", json: { data: { id: "u1" } } },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const result = await captureEndpointRaw(transport, fakeAuth(), SPEC);
    expect(result.outcome).toBe("ok");
    expect(result.httpStatus).toBe(200);
    expect(result.rawJson).toEqual({ data: { id: "u1" } });
  });

  it("returns outcome ok with rawJson undefined for an empty 2xx body", async () => {
    const stub = createStubFetch([{ method: "GET", path: "/v2/apps/user", status: 204 }]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const result = await captureEndpointRaw(transport, fakeAuth(), SPEC);
    expect(result.outcome).toBe("ok");
    expect(result.rawJson).toBeUndefined();
  });

  it("returns outcome invalid-json for a 2xx body that is not JSON", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(new Response("<html>not json</html>", { status: 200 }));
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
    });
    const result = await captureEndpointRaw(transport, fakeAuth(), SPEC);
    expect(result.outcome).toBe("invalid-json");
    expect(result.rawText).toContain("not json");
    expect(result.note).toBeDefined();
  });

  it("returns outcome http-error (not a thrown error) for a non-401 4xx/5xx, capturing the raw body", async () => {
    const stub = createStubFetch([
      { method: "GET", path: "/v2/apps/user", status: 500, json: { message: "boom" } },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const result = await captureEndpointRaw(transport, fakeAuth(), SPEC);
    expect(result.outcome).toBe("http-error");
    expect(result.httpStatus).toBe(500);
    expect(result.rawText).toContain("boom");
  });

  it("returns outcome timeout (not a thrown error) when the request times out", async () => {
    // Transport.send translates an abort into EvnexTimeoutError itself
    // (see src/http/transport.ts), so no retry-loop wait is involved here —
    // no fake timers needed for this one specifically, but harmless either way.
    const fetchImpl: FetchLike = () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
    });
    const result = await withFakeTimers(() =>
      captureEndpointRaw(transport, fakeAuth(), SPEC),
    );
    expect(result.outcome).toBe("timeout");
    expect(result.note).toBeDefined();
  });

  it("returns outcome exception (not a thrown error) for an unexpected non-timeout failure", async () => {
    // A raw, untranslated error is not in withRetry's standing non-retryable
    // set, so this genuinely exercises (and waits out, under fake timers)
    // all 5 attempts before finally surfacing as "exception".
    const fetchImpl: FetchLike = () => Promise.reject(new Error("DNS lookup failed"));
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
    });
    const result = await withFakeTimers(() =>
      captureEndpointRaw(transport, fakeAuth(), SPEC),
    );
    expect(result.outcome).toBe("exception");
    expect(result.note).toContain("DNS lookup failed");
  });

  it("throws (aborting the sweep) when a 401 survives the built-in refresh-and-resend", async () => {
    const stub = createStubFetch([{ method: "GET", path: "/v2/apps/user", status: 401 }]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    await expect(captureEndpointRaw(transport, fakeAuth(), SPEC)).rejects.toThrow(
      EvnexAuthError,
    );
  });

  it("propagates (aborting the sweep) when the auth source itself throws EvnexAuthError", async () => {
    const stub = createStubFetch([{ method: "GET", path: "/v2/apps/user", status: 200 }]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const auth = fakeAuth({
      getAccessToken: () => Promise.reject(new EvnexAuthError("session is gone")),
    });
    await expect(captureEndpointRaw(transport, auth, SPEC)).rejects.toThrow(
      EvnexAuthError,
    );
  });

  it("sends the bare access token (no Bearer prefix) via Authorization, matching the real client", async () => {
    const stub = createStubFetch([
      { method: "GET", path: "/v2/apps/user", json: { data: {} } },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    await captureEndpointRaw(
      transport,
      fakeAuth({ getAccessToken: () => Promise.resolve("tok-123") }),
      SPEC,
    );
    expect(stub.calls[0]?.headers.get("Authorization")).toBe("tok-123");
  });
});
