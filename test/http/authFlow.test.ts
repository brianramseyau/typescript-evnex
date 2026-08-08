import { describe, it, expect, vi } from "vitest";
import { withAuthFlow, type AuthTokenSource } from "../../src/http/authFlow.js";
import { Transport, ensureSuccess, type FetchLike } from "../../src/http/transport.js";
import { ReauthenticationRequiredError } from "../../src/errors.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A minimal fake CognitoSession-shaped AuthTokenSource for these tests. */
function makeAuth(tokens: string[]): {
  auth: AuthTokenSource;
  forceRefreshCalls: (string | undefined)[];
} {
  let index = 0;
  const forceRefreshCalls: (string | undefined)[] = [];
  const auth: AuthTokenSource = {
    getAccessToken: async () => {
      const token = tokens[Math.min(index, tokens.length - 1)];
      return token ?? "";
    },
    forceRefresh: async ({ staleAccessToken }) => {
      forceRefreshCalls.push(staleAccessToken);
      index += 1;
      return undefined;
    },
  };
  return { auth, forceRefreshCalls };
}

describe("withAuthFlow — bare token injection (PLAN.md §10.5)", () => {
  it("injects Authorization as the bare access token, with no Bearer prefix", async () => {
    let capturedAuthHeader: string | null = null;
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedAuthHeader = new Headers(init?.headers).get("Authorization");
      return jsonResponse({ ok: true });
    };
    const transport = new Transport({ baseUrl: "https://client-api.evnex.io", fetch: fetchImpl });
    const { auth } = makeAuth(["access-0"]);
    const send = withAuthFlow(transport, auth);

    await send({ method: "GET", path: "/v2/apps/user" });

    expect(capturedAuthHeader).toBe("access-0");
    expect(capturedAuthHeader).not.toMatch(/^Bearer /);
  });

  it("uses the access token, never the id token", async () => {
    let capturedAuthHeader: string | null = null;
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedAuthHeader = new Headers(init?.headers).get("Authorization");
      return jsonResponse({ ok: true });
    };
    const transport = new Transport({ baseUrl: "https://client-api.evnex.io", fetch: fetchImpl });
    const auth: AuthTokenSource = {
      getAccessToken: async () => "the-access-token",
      forceRefresh: async () => undefined,
    };
    const send = withAuthFlow(transport, auth);

    await send({ method: "GET", path: "/v2/apps/user" });

    expect(capturedAuthHeader).toBe("the-access-token");
  });
});

describe("withAuthFlow — 401 refresh-and-resend", () => {
  it("refreshes and resends exactly once on a 401, then succeeds", async () => {
    let callCount = 0;
    const seenAuthHeaders: (string | null)[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      callCount += 1;
      const header = new Headers(init?.headers).get("Authorization");
      seenAuthHeaders.push(header);
      if (header === "access-0") {
        return jsonResponse({}, 401);
      }
      return jsonResponse({ name: "Test User" });
    };
    const transport = new Transport({ baseUrl: "https://client-api.evnex.io", fetch: fetchImpl });
    const { auth, forceRefreshCalls } = makeAuth(["access-0", "access-1"]);
    const send = withAuthFlow(transport, auth);

    const response = await send({ method: "GET", path: "/v2/apps/user" });

    expect(callCount).toBe(2);
    expect(seenAuthHeaders).toEqual(["access-0", "access-1"]);
    expect(forceRefreshCalls).toEqual(["access-0"]);
    expect(response.status).toBe(200);
  });

  it("still 401 after refresh: resends exactly once, and the caller sees the persistent 401", async () => {
    let callCount = 0;
    const fetchImpl: FetchLike = async () => {
      callCount += 1;
      return jsonResponse({}, 401);
    };
    const transport = new Transport({ baseUrl: "https://client-api.evnex.io", fetch: fetchImpl });
    const { auth, forceRefreshCalls } = makeAuth(["access-0", "access-1"]);
    const send = withAuthFlow(transport, auth);

    const response = await send({ method: "GET", path: "/v2/apps/user" });

    // One original request + exactly one auth-flow resend; the generic
    // retry policy must not multiply auth recovery.
    expect(callCount).toBe(2);
    expect(forceRefreshCalls).toEqual(["access-0"]);
    expect(response.status).toBe(401);

    // Downstream error mapping (ensureSuccess) turns the still-401 response
    // into ReauthenticationRequiredError.
    expect(() => ensureSuccess(response, "/v2/apps/user")).toThrow(
      ReauthenticationRequiredError,
    );
  });

  it("does not refresh or resend when the first response is not a 401", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse({ name: "Test User" }));
    const transport = new Transport({ baseUrl: "https://client-api.evnex.io", fetch: fetchImpl });
    const { auth, forceRefreshCalls } = makeAuth(["access-0"]);
    const send = withAuthFlow(transport, auth);

    await send({ method: "GET", path: "/v2/apps/user" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(forceRefreshCalls).toEqual([]);
  });

  it("passes staleAccessToken as the token that was actually rejected", async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      const header = new Headers(init?.headers).get("Authorization");
      if (header === "access-0") {
        return jsonResponse({}, 401);
      }
      return jsonResponse({});
    };
    const transport = new Transport({ baseUrl: "https://client-api.evnex.io", fetch: fetchImpl });
    const { auth, forceRefreshCalls } = makeAuth(["access-0", "access-1"]);
    const send = withAuthFlow(transport, auth);

    await send({ method: "GET", path: "/v2/apps/user" });

    expect(forceRefreshCalls).toEqual(["access-0"]);
  });
});
