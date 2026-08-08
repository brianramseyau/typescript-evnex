/**
 * HTTP transport — ported from `evnex/api.py`'s `_request`,
 * `_check_api_response`, and `_ensure_success` (PLAN.md §5 A8).
 *
 * - Base-URL joining, the three common headers (`Accept`,
 *   `content-type: application/json`, `User-Agent: evnex/<version>`).
 * - `AbortSignal.timeout(ms)` on every request; an abort becomes
 *   `EvnexTimeoutError`, never a raw `AbortError` (default 30s, matching
 *   httpx; explicit per-call timeouts from Python are carried over verbatim
 *   — PLAN.md §2.7).
 * - `x-correlation-id` is captured onto `EvnexHttpError.correlationId`
 *   (PLAN.md §10.6). Error *messages* carry status, path, and correlation id
 *   only — the raw response body stays on `cause`.
 */

import { createRequire } from "node:module";
import { ReauthenticationRequiredError } from "../errors.js";
import { EvnexHttpError, EvnexTimeoutError } from "./errors.js";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface RequestSpec {
  method: string;
  /** Relative to the transport's base URL; must start with "/". */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON-serialisable request body. */
  json?: unknown;
  /** Overrides the transport's default timeout for this call. */
  timeoutMs?: number;
}

export interface TransportOptions {
  baseUrl: string;
  /** Injection point replacing "optionally pass in an httpx client". */
  fetch?: FetchLike;
  /** Client version, embedded in the `User-Agent` header. */
  version?: string;
  /** Default request timeout in ms. */
  defaultTimeoutMs?: number;
}

/** matches `httpx`'s default timeout (PLAN.md §2.7). */
const DEFAULT_TIMEOUT_MS = 30_000;

interface PackageMetadata {
  readonly version?: string;
}

/**
 * Reads this package's own `version` field for the default `User-Agent`
 * header — the `importlib.metadata.version("evnex")` analogue, falling back
 * to `"unknown"` exactly like Python's `PackageNotFoundError` handler.
 *
 * Untested upstream (§6.3): `readPackageJson` is a test seam so the fallback
 * path is exercisable without deleting files from the filesystem.
 */
export function resolvePackageVersion(
  readPackageJson: () => PackageMetadata = defaultReadPackageJson,
): string {
  try {
    const pkg = readPackageJson();
    return typeof pkg.version === "string" && pkg.version.length > 0
      ? pkg.version
      : "unknown";
  } catch {
    return "unknown";
  }
}

function defaultReadPackageJson(): PackageMetadata {
  const require = createRequire(import.meta.url);
  return require("../../package.json") as PackageMetadata;
}

function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null | undefined)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Sends one HTTP request: base-URL join, common headers, and the timeout. */
export class Transport {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly defaultTimeoutMs: number;
  /** The version embedded in the `User-Agent` header. */
  readonly version: string;

  constructor(options: TransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.version = options.version ?? resolvePackageVersion();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private get commonHeaders(): Record<string, string> {
    // Authorization is injected per-request by withAuthFlow, not here.
    return {
      Accept: "application/json",
      "content-type": "application/json",
      "User-Agent": `evnex/${this.version}`,
    };
  }

  private buildUrl(spec: RequestSpec): string {
    const url = new URL(`${this.baseUrl}${spec.path}`);
    if (spec.query) {
      for (const [key, value] of Object.entries(spec.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  /** Send a request. Does not inject auth, check the status, or parse the body. */
  async send(spec: RequestSpec, headers?: Record<string, string>): Promise<Response> {
    const url = this.buildUrl(spec);
    const timeoutMs = spec.timeoutMs ?? this.defaultTimeoutMs;
    const init: RequestInit = {
      method: spec.method,
      headers: { ...this.commonHeaders, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (spec.json !== undefined) {
      init.body = JSON.stringify(spec.json);
    }

    try {
      return await this.fetchImpl(url, init);
    } catch (err) {
      if (isTimeoutError(err)) {
        throw new EvnexTimeoutError(
          `Request to ${spec.path} timed out after ${timeoutMs}ms`,
          { path: spec.path, cause: err },
        );
      }
      throw err;
    }
  }
}

function buildErrorMessage(
  status: number,
  path: string,
  correlationId: string | undefined,
): string {
  const suffix = correlationId ? ` (correlation id: ${correlationId})` : "";
  return `Request to ${path} failed with status ${status}${suffix}`;
}

/**
 * Raise `EvnexHttpError` (correlation id attached) for a non-2xx response,
 * or `ReauthenticationRequiredError` for a 401 (the auth flow already
 * refreshed and resent once; a 401 here means the renewed session is still
 * rejected).
 */
export function ensureSuccess(response: Response, path: string): void {
  const correlationId = response.headers.get("x-correlation-id") ?? undefined;
  if (response.status === 401) {
    // EvnexHttpxAuth (withAuthFlow) already refreshed and re-sent once; a
    // 401 here means the renewed session is still rejected.
    throw new ReauthenticationRequiredError(
      "Request still unauthorized after refreshing the session",
    );
  }
  if (!response.ok) {
    throw new EvnexHttpError(buildErrorMessage(response.status, path, correlationId), {
      status: response.status,
      path,
      correlationId,
    });
  }
}

/** `ensureSuccess`, then parse and return the JSON body. */
export async function checkApiResponse(response: Response, path: string): Promise<unknown> {
  ensureSuccess(response, path);

  const text = await response.text();
  // No wrapping: an invalid-JSON body propagates its raw SyntaxError, just
  // as Python's `from_json` lets pydantic_core's parse error propagate
  // unchanged (untested upstream — PLAN.md §6.3).
  return JSON.parse(text) as unknown;
}
