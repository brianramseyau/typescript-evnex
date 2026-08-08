/**
 * Route-table `fetch` stub — the offline replacement for the EVNEX server,
 * injected through `EvnexOptions.fetch` / `TransportOptions.fetch` (PLAN.md
 * §5 A9). Deliberately **not** `msw`: A8's `Transport` already accepts a
 * `fetch` replacement as its injection seam (the httpx-client-replacement
 * pattern this whole port is built on), so intercepting the global `fetch`
 * would be redundant — and a direct route table makes request assertions
 * (headers, body, call count) a plain array read instead of a mock server's
 * call log.
 *
 * Analogue of the Python suite's `respx` route registrations: a `StubRoute`
 * with `json`/`status`/`headers` is `respx.get(url).mock(return_value=...)`;
 * one with `handler` is `respx.get(url).mock(side_effect=...)` — the handler
 * receives the parsed request and decides the response per call, which is
 * how tests like "the first call gets 401, the retried one gets 200" and "the
 * `Authorization` header carries the bare access token" are ported directly.
 */

import type { FetchLike } from "../../src/http/transport.js";

/** One request the stub received, in the shape tests actually want to assert on. */
export interface StubFetchCall {
  method: string;
  /** The full request URL. */
  url: URL;
  /** `url.pathname` — what routes match against. */
  path: string;
  query: URLSearchParams;
  headers: Headers;
  /** The parsed JSON request body, or `undefined` for a bodyless / non-JSON request. */
  json: unknown;
}

export interface StubRouteResponse {
  /** Default 200. */
  status?: number;
  /** JSON-serialised as the body with `content-type: application/json`. Omit for a bodyless response (e.g. a bare 401/504). */
  json?: unknown;
  headers?: Record<string, string>;
}

/** Decide a response per-call — the `side_effect` analogue. Runs after the call is recorded. */
export type StubRouteHandler = (
  call: StubFetchCall,
) => StubRouteResponse | Response | Promise<StubRouteResponse | Response>;

export interface StubRoute {
  /** HTTP method, case-insensitive. */
  method: string;
  /** Exact pathname to match — no host, no query string, e.g. `"/v2/apps/user"`. */
  path: string;
  /** Static response. Ignored when `handler` is set. */
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
  /** Dynamic response, e.g. a sequenced or header-dependent one. Takes precedence over `status`/`json`/`headers` on this route. */
  handler?: StubRouteHandler;
}

export interface StubFetch {
  /** Pass directly as `EvnexOptions.fetch` / `TransportOptions.fetch`. */
  fetch: FetchLike;
  /** Every request received so far, in order. */
  readonly calls: readonly StubFetchCall[];
  /** This stub's recorded calls matching one method + path, in request order. */
  callsFor(method: string, path: string): readonly StubFetchCall[];
  /** Register a route, replacing any existing one for the same method + path. */
  addRoute(route: StubRoute): void;
  /** Clear recorded calls without touching the route table. */
  reset(): void;
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function bodyToText(body: RequestInit["body"]): string | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  // Transport (A8) only ever sends a JSON string body; other BodyInit shapes
  // (FormData, Blob, streams, ...) are not part of this client's contract.
  return undefined;
}

function parseJsonBody(init: RequestInit | undefined, headers: Headers): unknown {
  const text = bodyToText(init?.body);
  if (text === undefined || text.length === 0) return undefined;
  const contentType = headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;
  return JSON.parse(text) as unknown;
}

function toResponse(spec: StubRouteResponse): Response {
  const status = spec.status ?? 200;
  const headers = new Headers(spec.headers);
  if (spec.json === undefined) {
    return new Response(null, { status, headers });
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Response(JSON.stringify(spec.json), { status, headers });
}

/** Build an in-memory route-table stand-in for `fetch`, for `EvnexOptions.fetch`. */
export function createStubFetch(routes: readonly StubRoute[] = []): StubFetch {
  const table = new Map<string, StubRoute>();
  for (const route of routes) {
    table.set(routeKey(route.method, route.path), route);
  }
  const calls: StubFetchCall[] = [];

  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const json = parseJsonBody(init, headers);
    const call: StubFetchCall = {
      method,
      url,
      path: url.pathname,
      query: url.searchParams,
      headers,
      json,
    };
    calls.push(call);

    const route = table.get(routeKey(method, url.pathname));
    if (route === undefined) {
      const known = [...table.keys()].join(", ") || "(no routes registered)";
      throw new Error(
        `stubFetch: no route for ${method} ${url.pathname} — known routes: ${known}`,
      );
    }

    const result = route.handler
      ? await route.handler(call)
      : { status: route.status, json: route.json, headers: route.headers };
    return result instanceof Response ? result : toResponse(result);
  };

  return {
    fetch: fetchImpl,
    calls,
    callsFor(method, path) {
      const key = routeKey(method, path);
      return calls.filter((call) => routeKey(call.method, call.path) === key);
    },
    addRoute(route) {
      table.set(routeKey(route.method, route.path), route);
    },
    reset() {
      calls.length = 0;
    },
  };
}
