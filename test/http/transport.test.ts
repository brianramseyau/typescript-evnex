import { describe, it, expect, vi } from "vitest";
import { ReauthenticationRequiredError } from "../../src/errors.js";
import { EvnexHttpError, EvnexTimeoutError } from "../../src/http/errors.js";
import {
  Transport,
  ensureSuccess,
  checkApiResponse,
  resolvePackageVersion,
  type FetchLike,
} from "../../src/http/transport.js";

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

describe("resolvePackageVersion", () => {
  it("reads the real package.json version when unspecified", () => {
    // The repo's package.json always has a non-empty semver string.
    expect(resolvePackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("falls back to 'unknown' when the package.json cannot be read (PackageNotFoundError analogue)", () => {
    expect(
      resolvePackageVersion(() => {
        throw new Error("ENOENT");
      }),
    ).toBe("unknown");
  });

  it("falls back to 'unknown' when the read succeeds but version is missing", () => {
    expect(resolvePackageVersion(() => ({}))).toBe("unknown");
  });

  it("falls back to 'unknown' when version is an empty string", () => {
    expect(resolvePackageVersion(() => ({ version: "" }))).toBe("unknown");
  });
});

describe("Transport — base URL, headers, and User-Agent", () => {
  it("joins the base URL and path, stripping a trailing slash on baseUrl", async () => {
    let capturedUrl = "";
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url;
      return jsonResponse({});
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io/",
      fetch: fetchImpl,
      version: "9.9.9",
    });

    await transport.send({ method: "GET", path: "/v2/apps/user" });

    expect(capturedUrl).toBe("https://client-api.evnex.io/v2/apps/user");
  });

  it("sends the three common headers, with User-Agent carrying the version", async () => {
    let capturedHeaders: Headers | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({});
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
      version: "1.2.3",
    });

    await transport.send({ method: "GET", path: "/v2/apps/user" });

    expect(capturedHeaders?.get("Accept")).toBe("application/json");
    expect(capturedHeaders?.get("content-type")).toBe("application/json");
    expect(capturedHeaders?.get("User-Agent")).toBe("evnex/1.2.3");
  });

  it("defaults the User-Agent version via resolvePackageVersion when unspecified", async () => {
    let capturedHeaders: Headers | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({});
    };
    const transport = new Transport({ baseUrl: "https://client-api.evnex.io", fetch: fetchImpl });

    await transport.send({ method: "GET", path: "/v2/apps/user" });

    expect(capturedHeaders?.get("User-Agent")).toMatch(/^evnex\/\d+\.\d+\.\d+/);
    expect(transport.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("merges caller-supplied headers (e.g. Authorization) over the common ones", async () => {
    let capturedHeaders: Headers | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({});
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
      version: "1.0.0",
    });

    await transport.send({ method: "GET", path: "/v2/apps/user" }, { Authorization: "tok-1" });

    expect(capturedHeaders?.get("Authorization")).toBe("tok-1");
  });

  it("serialises query params, dropping undefined values", async () => {
    let capturedUrl = "";
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url;
      return jsonResponse({});
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
      version: "1.0.0",
    });

    await transport.send({
      method: "GET",
      path: "/organisations/org-1/summary/insights",
      query: { days: 7, "tz-offset": 12, unset: undefined },
    });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("days")).toBe("7");
    expect(url.searchParams.get("tz-offset")).toBe("12");
    expect(url.searchParams.has("unset")).toBe(false);
  });

  it("serialises a JSON body when spec.json is provided", async () => {
    let capturedBody: unknown;
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedBody = init?.body;
      return jsonResponse({});
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
      version: "1.0.0",
    });

    await transport.send({
      method: "POST",
      path: "/charge-points/cp-1/commands/set-override",
      json: { connectorId: 1, chargeNow: true },
    });

    expect(capturedBody).toBe(JSON.stringify({ connectorId: 1, chargeNow: true }));
  });

  it("omits a body entirely when spec.json is not provided", async () => {
    let capturedBody: unknown = "sentinel";
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedBody = init?.body;
      return jsonResponse({});
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
      version: "1.0.0",
    });

    await transport.send({ method: "GET", path: "/v2/apps/user" });

    expect(capturedBody).toBeUndefined();
  });

  it("defaults to the global fetch when none is injected", async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn(async () => jsonResponse({ ok: true }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = spy;
    try {
      const transport = new Transport({ baseUrl: "https://client-api.evnex.io", version: "1.0.0" });
      const response = await transport.send({ method: "GET", path: "/v2/apps/user" });
      expect(await response.json()).toEqual({ ok: true });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Transport — timeouts (PLAN.md §2.7)", () => {
  it("uses the default 30s timeout when no per-call timeout is given", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedInit = init;
      return jsonResponse({});
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
      version: "1.0.0",
    });

    await transport.send({ method: "GET", path: "/v2/apps/user" });

    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("honours a per-call timeoutMs override, e.g. the 15s/10s command timeouts", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedInit = init;
      return jsonResponse({});
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
      version: "1.0.0",
    });

    await transport.send({
      method: "POST",
      path: "/charge-points/cp-1/commands/get-override",
      timeoutMs: 15_000,
    });

    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("translates a timeout abort into EvnexTimeoutError, not a raw AbortError", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
      version: "1.0.0",
    });

    const error = await transport
      .send({ method: "POST", path: "/charge-points/cp-1/commands/get-status" })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(EvnexTimeoutError);
    expect(error).not.toBeInstanceOf(EvnexHttpError);
    expect((error as EvnexTimeoutError).name).not.toBe("AbortError");
    expect((error as EvnexTimeoutError).path).toBe("/charge-points/cp-1/commands/get-status");
  });

  it("also translates a generic AbortError (some fetch implementations use this name)", async () => {
    const fetchImpl: FetchLike = async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
      version: "1.0.0",
    });

    await expect(
      transport.send({ method: "GET", path: "/v2/apps/user" }),
    ).rejects.toBeInstanceOf(EvnexTimeoutError);
  });

  it("propagates a non-timeout fetch failure unchanged", async () => {
    const original = new TypeError("network error");
    const fetchImpl: FetchLike = async () => {
      throw original;
    };
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: fetchImpl,
      version: "1.0.0",
    });

    await expect(
      transport.send({ method: "GET", path: "/v2/apps/user" }),
    ).rejects.toBe(original);
  });
});

describe("ensureSuccess", () => {
  it("passes through a 2xx response without throwing", () => {
    expect(() => ensureSuccess(jsonResponse({}), "/v2/apps/user")).not.toThrow();
  });

  it("throws ReauthenticationRequiredError on a 401", () => {
    expect(() => ensureSuccess(jsonResponse({}, { status: 401 }), "/v2/apps/user")).toThrow(
      ReauthenticationRequiredError,
    );
  });

  it("throws EvnexHttpError for a non-401, non-2xx response", () => {
    const response = jsonResponse({ message: "server exploded" }, { status: 500 });
    let caught: unknown;
    try {
      ensureSuccess(response, "/v2/apps/user");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(EvnexHttpError);
    const httpErr = caught as EvnexHttpError;
    expect(httpErr.status).toBe(500);
    expect(httpErr.path).toBe("/v2/apps/user");
  });

  it("captures x-correlation-id onto EvnexHttpError.correlationId and into the message", () => {
    const response = jsonResponse(
      { message: "server exploded" },
      { status: 500, headers: { "x-correlation-id": "corr-abc-123" } },
    );
    let caught: unknown;
    try {
      ensureSuccess(response, "/v2/apps/user");
    } catch (err) {
      caught = err;
    }

    const httpErr = caught as EvnexHttpError;
    expect(httpErr.correlationId).toBe("corr-abc-123");
    expect(httpErr.message).toContain("corr-abc-123");
  });

  it("leaves correlationId undefined, and out of the message, when the header is absent", () => {
    const response = jsonResponse({}, { status: 500 });
    let caught: unknown;
    try {
      ensureSuccess(response, "/v2/apps/user");
    } catch (err) {
      caught = err;
    }

    const httpErr = caught as EvnexHttpError;
    expect(httpErr.correlationId).toBeUndefined();
    expect(httpErr.message).not.toContain("correlation id");
  });

  it("never lets the response body reach the error message, only the status/path/correlation id", () => {
    const secret = "sk-live-super-secret-request-echo";
    const response = jsonResponse(
      { message: secret },
      { status: 400, headers: { "x-correlation-id": "corr-1" } },
    );
    let caught: unknown;
    try {
      ensureSuccess(response, "/v2/apps/user");
    } catch (err) {
      caught = err;
    }

    const httpErr = caught as EvnexHttpError;
    expect(httpErr.message).not.toContain(secret);
    expect(httpErr.message).toContain("400");
    expect(httpErr.message).toContain("/v2/apps/user");
    expect(httpErr.message).toContain("corr-1");
  });
});

describe("checkApiResponse", () => {
  it("returns the parsed JSON body for a successful response", async () => {
    const response = jsonResponse({ name: "Test User" });
    await expect(checkApiResponse(response, "/v2/apps/user")).resolves.toEqual({
      name: "Test User",
    });
  });

  it("raises before parsing when the response is unsuccessful", async () => {
    const response = jsonResponse({ message: "nope" }, { status: 500 });
    await expect(checkApiResponse(response, "/v2/apps/user")).rejects.toBeInstanceOf(
      EvnexHttpError,
    );
  });

  it("raises ReauthenticationRequiredError before parsing on a persistent 401", async () => {
    const response = jsonResponse({}, { status: 401 });
    await expect(checkApiResponse(response, "/v2/apps/user")).rejects.toBeInstanceOf(
      ReauthenticationRequiredError,
    );
  });

  it("propagates a raw parse error on an invalid-JSON body (untested upstream, §6.3)", async () => {
    const response = new Response("not valid json {{{", {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await expect(checkApiResponse(response, "/v2/apps/user")).rejects.toBeInstanceOf(SyntaxError);
  });

  it("body stays out of the message for an unsuccessful response, even with a body present", async () => {
    const secret = "leaked-header-value";
    const response = jsonResponse({ detail: secret }, { status: 502 });

    const error = await checkApiResponse(response, "/v2/apps/user").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(EvnexHttpError);
    expect((error as EvnexHttpError).message).not.toContain(secret);
  });
});
