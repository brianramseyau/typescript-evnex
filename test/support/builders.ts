/**
 * Fixture builders — the analogues of `tests/conftest.py`'s `make_jwt`,
 * `auth`, `resumed_auth`, and `client` fixtures (PLAN.md §5 A9).
 *
 * pytest fixtures are injected by name and composed automatically; vitest has
 * no equivalent, so each Python fixture becomes a plain function a test calls
 * directly. Where a Python fixture depended on another (`resumed_auth` and
 * `client` both need `token_updates`), the dependency is folded into one
 * return value instead of a second function to call, so a test gets
 * everything it needs from a single `makeResumedAuth()` / `makeClient()` call.
 */

import { createHmac } from "node:crypto";
import { EvnexAuth } from "../../src/auth/index.js";
import type { EvnexAuthOptions } from "../../src/auth/index.js";
import { TokenSet } from "../../src/auth/tokens.js";
import { Evnex } from "../../src/api.js";
import type { EvnexConfig } from "../../src/config.js";
import { FakeCognito } from "./fakeCognito.js";
import { createStubFetch } from "./stubFetch.js";
import type { StubFetch, StubRoute } from "./stubFetch.js";

// -- makeJwt ------------------------------------------------------------------

export interface MakeJwtOptions {
  /**
   * Milliseconds from now until the token's `exp` claim. Default 24 hours,
   * matching `conftest.py::make_jwt`'s default. Pass a negative value for an
   * already-expired token (`tests/test_auth.py::test_expired_token_refreshed_proactively`'s
   * `timedelta(seconds=-60)` analogue).
   */
  expiresIn?: number;
}

const JWT_TEST_SECRET = "test-key-long-enough-for-hs256-minimum!";

function base64url(input: string | Uint8Array): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buffer.toString("base64url");
}

/**
 * A structurally valid (unverified) access token with an `exp` claim — for
 * exercising `decodeExpiry` (A7) and `TokenSet`'s expiry-derivation path.
 * Signed with HS256 for realism; nothing in this codebase verifies the
 * signature of a bare access/id token (only Cognito-issued JWTs are ever
 * signature-verified, via JWKS — see `src/auth/jwt.ts`'s `verifyJwt`), so the
 * signature only needs to make the token look like a real three-segment JWT.
 */
export function makeJwt(options: MakeJwtOptions = {}): string {
  const expiresIn = options.expiresIn ?? 24 * 60 * 60 * 1000;
  const exp = Math.floor((Date.now() + expiresIn) / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ exp }));
  const signature = base64url(
    createHmac("sha256", JWT_TEST_SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

// -- makeAuth / makeResumedAuth ------------------------------------------------

export interface AuthBuilderOptions {
  /** Override the config passed to `EvnexAuth` (e.g. a different pool/client id). */
  config?: EvnexConfig;
  /** Supply your own fake instead of a fresh default one (e.g. to share one across builders). */
  cognito?: FakeCognito;
}

export interface AuthBuilder {
  /** The `EvnexAuth` under test. */
  auth: EvnexAuth;
  /**
   * The injected fake. Reassign its methods to script a Cognito failure or a
   * different result for the next call — see `FakeCognito`'s docstring.
   */
  cognito: FakeCognito;
  /** Every `TokenSet` published via `onTokenUpdate`, in publish order. */
  tokenUpdates: TokenSet[];
}

function buildAuth(options: EvnexAuthOptions, cognito: FakeCognito): AuthBuilder {
  const tokenUpdates: TokenSet[] = [];
  const auth = new EvnexAuth({
    ...options,
    cognito,
    onTokenUpdate: async (tokens: TokenSet) => {
      tokenUpdates.push(tokens);
    },
  });
  return { auth, cognito, tokenUpdates };
}

/** An `EvnexAuth` with no session yet — the `conftest.py::auth` fixture analogue. */
export function makeAuth(options: AuthBuilderOptions = {}): AuthBuilder {
  return buildAuth({ config: options.config }, options.cognito ?? new FakeCognito());
}

export interface ResumedAuthBuilderOptions extends AuthBuilderOptions {
  /** Seed tokens; defaults to access-0/id-0/refresh-0, matching `conftest.py::resumed_auth`. */
  tokens?: TokenSet;
}

/**
 * An `EvnexAuth` resumed from persisted tokens (no credentials needed) — the
 * `conftest.py::resumed_auth` fixture analogue.
 */
export function makeResumedAuth(options: ResumedAuthBuilderOptions = {}): AuthBuilder {
  const tokens =
    options.tokens ??
    new TokenSet({ accessToken: "access-0", idToken: "id-0", refreshToken: "refresh-0" });
  return buildAuth({ tokens, config: options.config }, options.cognito ?? new FakeCognito());
}

// -- makeClient -----------------------------------------------------------------

export interface ClientBuilderOptions {
  /** Reuse an existing auth (e.g. from `makeAuth()`); defaults to a fresh `makeResumedAuth()`. */
  auth?: EvnexAuth;
  /** Route table for the injected `stubFetch`. */
  routes?: readonly StubRoute[];
  config?: EvnexConfig;
}

export interface ClientBuilder {
  client: Evnex;
  /** The auth backing `client` — the fresh `makeResumedAuth().auth` when `options.auth` was not given. */
  auth: EvnexAuth;
  /** The stub `client`'s requests go through; inspect `.calls` or add routes with `.addRoute`. */
  stub: StubFetch;
}

/** An `Evnex` client over a stub `fetch` — the `conftest.py::client` fixture analogue. */
export function makeClient(options: ClientBuilderOptions = {}): ClientBuilder {
  const auth = options.auth ?? makeResumedAuth().auth;
  const stub = createStubFetch(options.routes ?? []);
  const client = new Evnex({ auth, fetch: stub.fetch, config: options.config });
  return { client, auth, stub };
}
