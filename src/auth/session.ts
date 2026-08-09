/**
 * Session lifecycle — ported from `evnex/auth.py`'s `EvnexAuth` session half:
 * `start_authentication`, `respond_to_challenge`, `get_access_token`,
 * `force_refresh`, `_store_tokens`, `_run_user_pool_op`, `_tokens_from_cognito`.
 *
 * Three properties must survive the port intact (PLAN.md §5 B1):
 *
 * 1. Single-flight refresh: `forceRefresh({ staleAccessToken })` returns the
 *    already-rotated tokens without a second network call when another task
 *    won the race. Calling `forceRefresh()` with **no** argument at all
 *    means "always refresh unconditionally" — distinct from passing
 *    `{ staleAccessToken: undefined }`, which means "the session never had
 *    an access token; refresh unless it already rotated past that". A
 *    nullish check on `staleAccessToken` is NOT a valid substitute for this
 *    distinction (the Python `_ALWAYS_REFRESH` sentinel); we branch on
 *    whether the `options` argument itself was passed (`options ===
 *    undefined`), not on its contents — `ForceRefreshOptions.staleAccessToken`
 *    is a required key, so `{}` is not a legal call and this check is exact.
 * 2. Persist-before-publish: `storeTokens` awaits `onTokenUpdate` **before**
 *    assigning the new tokens. Callback failures are logged and swallowed.
 * 3. `runUserPoolOp` recovery: on a Cognito `NotAuthorizedException`, refresh
 *    once (outside the locked section — the lock is not re-entrant) and
 *    retry exactly once.
 *
 * `EXPIRY_SKEW` is 30 seconds and refreshes proactively.
 *
 * Also wires the optional `verifyTokens` flag (PLAN.md §3.4): every freshly
 * issued token pair is verified against the pool's JWKS (A7's `verifyJwt` /
 * `fetchJwks`) before it is trusted, replacing `pycognito`'s internal
 * `TokenVerificationException` behaviour. Defaults to `true`. Verification
 * failure maps to `EvnexAuthError` at `startAuthentication` /
 * `respondToChallenge` (matching Python's `WarrantException` /
 * `TokenVerificationException` -> `EvnexAuthError` mapping) and to
 * `ReauthenticationRequiredError` at `forceRefresh` (matching Python's
 * `force_refresh` mapping of the same failure).
 */

import { EvnexConfig } from "../config.js";
import {
  ChallengeExpiredError,
  EvnexAuthError,
  InvalidChallengeResponseError,
  InvalidCredentialsError,
  ReauthenticationRequiredError,
} from "../errors.js";
import { AuthChallenge } from "./challenge.js";
import type { CognitoAdapter, CognitoAuthResult, CognitoTokens } from "./cognito.js";
import { CognitoError, createCognitoAdapter } from "./cognito.js";
import { fetchJwks, verifyJwt } from "./jwt.js";
import { Mutex } from "./mutex.js";
import { TokenSet } from "./tokens.js";

export type TokenUpdateCallback = (tokens: TokenSet) => Promise<void>;

export interface CognitoSessionOptions {
  tokens?: TokenSet | undefined;
  onTokenUpdate?: TokenUpdateCallback | undefined;
  config?: EvnexConfig | undefined;
  /** Injection point for tests; built from `config` when omitted. */
  cognito?: CognitoAdapter | undefined;
  /**
   * Verify every freshly issued token pair against the pool's JWKS before
   * trusting it (PLAN.md §3.4). Defaults to `true`.
   */
  verifyTokens?: boolean | undefined;
}

export interface ForceRefreshOptions {
  /**
   * The access token that was rejected (possibly `undefined` for a session
   * that never had one). Callers that lost the refresh race return the
   * already-rotated token set without refreshing again.
   */
  staleAccessToken: string | undefined;
}

export interface RunUserPoolOpOptions<T> {
  /**
   * Runs under the same lock as the successful call, so state captured
   * during `operation` (e.g. rotated tokens, via `publishTokens`) can be
   * published atomically.
   */
  after?: (result: T) => Promise<void>;
}

const CHALLENGE_SOFTWARE_TOKEN_MFA = "SOFTWARE_TOKEN_MFA";
const CHALLENGE_SMS_MFA = "SMS_MFA";

// Refresh this long before the access token's recorded expiry, to absorb
// clock skew between us and the API.
const EXPIRY_SKEW_MS = 30_000;

// Sentinel distinguishing "always refresh" from "refresh unless the tokens
// already rotated past this stale access token (which may be undefined)".
// See the module docstring: the distinguishing signal is whether the
// `options` argument was passed at all, not the value inside it.
const ALWAYS_REFRESH = Symbol("ALWAYS_REFRESH");

type ChallengeResponder = (params: {
  username: string;
  session: string;
  code: string;
}) => Promise<CognitoAuthResult>;

/** Cognito error-name -> typed-error mapping for `respondToChallenge` (PLAN.md §3.2). */
function mapChallengeError(err: CognitoError): EvnexAuthError {
  if (err.name === "CodeMismatchException") {
    return new InvalidChallengeResponseError(err.message, { cause: err });
  }
  if (err.name === "ExpiredCodeException" || err.name === "NotAuthorizedException") {
    // Cognito reports a lapsed challenge session as NotAuthorized.
    return new ChallengeExpiredError(err.message, { cause: err });
  }
  return new EvnexAuthError(err.message, { cause: err });
}

/** Manages Cognito sign-in, MFA challenge response, and session renewal. */
export class CognitoSession {
  private readonly lock = new Mutex();
  private readonly config: EvnexConfig;
  private readonly cognito: CognitoAdapter;
  private readonly onTokenUpdate: TokenUpdateCallback | undefined;
  private readonly verifyTokens: boolean;
  private currentTokens: TokenSet | undefined;
  // Cognito's REFRESH_TOKEN_AUTH flow does not actually require USERNAME
  // (pycognito never sends it either — only REFRESH_TOKEN, plus SECRET_HASH
  // when a client secret exists, which this client never has), but A6's
  // adapter interface requires a username parameter for symmetry with the
  // other operations. Track the most recently authenticated username so a
  // later `forceRefresh` on a session that *did* sign in interactively can
  // supply it; a session resumed from a bare refresh token (no interactive
  // sign-in ever happened) has no username to offer, so this falls back to
  // "".
  private username: string | undefined;

  constructor(options: CognitoSessionOptions = {}) {
    this.config = options.config ?? new EvnexConfig();
    this.cognito =
      options.cognito ??
      createCognitoAdapter({
        userPoolId: this.config.EVNEX_COGNITO_USER_POOL_ID,
        clientId: this.config.EVNEX_COGNITO_CLIENT_ID,
      });
    this.onTokenUpdate = options.onTokenUpdate;
    this.verifyTokens = options.verifyTokens ?? true;
    this.currentTokens = options.tokens;
  }

  /** The current token set, if any. */
  get tokens(): TokenSet | undefined {
    return this.currentTokens;
  }

  /**
   * Begin interactive sign-in. Resolves to a `TokenSet` on immediate
   * success, or an `AuthChallenge` that must be answered via
   * `respondToChallenge`.
   *
   * @throws {InvalidCredentialsError} the credentials were rejected
   * @throws {import("../errors.js").PasswordChangeRequiredError} Cognito
   *   requires a password change before sign-in (thrown directly by the
   *   adapter — see `cognito.ts`'s module docstring)
   */
  async startAuthentication(
    username: string,
    password: string,
  ): Promise<TokenSet | AuthChallenge> {
    return this.lock.runExclusive(async () => {
      this.username = username;
      let result: CognitoAuthResult;
      try {
        result = await this.cognito.authenticate({ username, password });
      } catch (err) {
        // Any Cognito ClientError during sign-in is InvalidCredentialsError
        // (PLAN.md §3.2). PasswordChangeRequiredError and the
        // DEVICE_SRP_AUTH EvnexAuthError are thrown directly by the adapter
        // (not as CognitoError) and propagate untouched.
        if (err instanceof CognitoError) {
          throw new InvalidCredentialsError(err.message, { cause: err });
        }
        throw err;
      }
      return this.finishAuthResult(result, username);
    });
  }

  /**
   * Answer an authentication challenge (e.g. with a 6-digit MFA code).
   *
   * @throws {InvalidChallengeResponseError} the code was rejected; the same
   *   challenge may be retried with a new code
   * @throws {ChallengeExpiredError} the challenge session lapsed; call
   *   `startAuthentication` again
   * @throws {EvnexAuthError} the challenge type is not supported
   */
  async respondToChallenge(
    challenge: AuthChallenge,
    response: string,
  ): Promise<TokenSet | AuthChallenge> {
    return this.lock.runExclusive(async () => {
      this.username = challenge.username;
      const respond = this.challengeResponder(challenge.name);
      let result: CognitoAuthResult;
      try {
        result = await respond({
          username: challenge.username,
          session: challenge.session,
          code: response.trim(),
        });
      } catch (err) {
        if (err instanceof CognitoError) {
          throw mapChallengeError(err);
        }
        throw err;
      }
      return this.finishAuthResult(result, challenge.username);
    });
  }

  /** Pick the adapter method that answers a given challenge type. */
  private challengeResponder(name: string): ChallengeResponder {
    if (name === CHALLENGE_SOFTWARE_TOKEN_MFA) {
      return this.cognito.respondToSoftwareTokenMfaChallenge;
    }
    if (name === CHALLENGE_SMS_MFA) {
      return this.cognito.respondToSmsMfaChallenge;
    }
    throw new EvnexAuthError(
      `Unsupported authentication challenge ${JSON.stringify(name)}`,
    );
  }

  /**
   * Turn an adapter auth result into the public `TokenSet | AuthChallenge`
   * shape, verifying and publishing freshly issued tokens along the way.
   * Shared by `startAuthentication` and `respondToChallenge`; both call this
   * from inside their own locked section.
   */
  private async finishAuthResult(
    result: CognitoAuthResult,
    username: string,
  ): Promise<TokenSet | AuthChallenge> {
    if (result.kind === "challenge") {
      return new AuthChallenge({
        name: result.challenge.challengeName,
        session: result.challenge.session,
        username,
        parameters: result.challenge.parameters,
      });
    }
    await this.verifyIssuedTokens(result.tokens);
    const tokens = this.tokensFromCognito(result.tokens);
    await this.publishTokens(tokens);
    return tokens;
  }

  /**
   * Return a valid access token, refreshing the session if required.
   *
   * Reads `this.currentTokens` lock-free: `storeTokens` only ever replaces
   * it with a single reference assignment, and only after persistence, so a
   * concurrent reader here can never observe a partially-updated token set.
   *
   * @throws {ReauthenticationRequiredError} no usable session exists
   */
  async getAccessToken(): Promise<string> {
    const tokens = this.currentTokens;
    if (tokens === undefined || tokens.accessToken === undefined) {
      const refreshed = await this.forceRefresh({
        staleAccessToken: tokens?.accessToken,
      });
      return this.requireAccessToken(refreshed);
    }
    if (tokens.expiresAt !== undefined) {
      const now = Date.now();
      if (now >= tokens.expiresAt.getTime() - EXPIRY_SKEW_MS) {
        const refreshed = await this.forceRefresh({
          staleAccessToken: tokens.accessToken,
        });
        return this.requireAccessToken(refreshed);
      }
    }
    return tokens.accessToken;
  }

  private requireAccessToken(tokens: TokenSet): string {
    if (tokens.accessToken === undefined) {
      throw new ReauthenticationRequiredError(
        "The refreshed session did not include an access token",
      );
    }
    return tokens.accessToken;
  }

  /** Refresh unconditionally. */
  async forceRefresh(): Promise<TokenSet>;
  /** Single-flight refresh — see the class-level TODO note. */
  async forceRefresh(options: ForceRefreshOptions): Promise<TokenSet>;
  /**
   * Obtain fresh tokens using the refresh token.
   *
   * Single-flight: pass the access token that was rejected (possibly
   * `undefined` for a session that never had one) as `staleAccessToken`, and
   * callers that lost the race return the already-rotated token set without
   * refreshing again. Omit the argument entirely to refresh unconditionally.
   *
   * @throws {ReauthenticationRequiredError} no refresh token, or Cognito
   *   rejected it, or the renewed tokens failed verification
   */
  async forceRefresh(options?: ForceRefreshOptions): Promise<TokenSet> {
    return this.lock.runExclusive(async () => {
      const current = this.currentTokens;
      const staleAccessToken =
        options === undefined ? ALWAYS_REFRESH : options.staleAccessToken;
      if (
        current !== undefined &&
        staleAccessToken !== ALWAYS_REFRESH &&
        current.accessToken !== staleAccessToken
      ) {
        // Another caller already won the race and rotated the tokens.
        return current;
      }

      if (current === undefined || current.refreshToken === undefined) {
        throw new ReauthenticationRequiredError(
          "No session tokens; interactive authentication is required",
        );
      }

      let cognitoTokens: CognitoTokens;
      try {
        cognitoTokens = await this.cognito.renewAccessToken({
          username: this.username ?? "",
          refreshToken: current.refreshToken,
        });
      } catch (err) {
        if (err instanceof CognitoError) {
          throw new ReauthenticationRequiredError(err.message, { cause: err });
        }
        throw err;
      }

      try {
        await this.verifyIssuedTokens(cognitoTokens);
      } catch (err) {
        // The renewed tokens failed verification; the session cannot be
        // trusted (matches Python's WarrantException -> Reauthentication
        // mapping in force_refresh). Network errors from fetchJwks
        // deliberately are not EvnexAuthError and propagate untouched: they
        // are transient and remain retryable.
        if (err instanceof EvnexAuthError) {
          throw new ReauthenticationRequiredError(err.message, { cause: err });
        }
        throw err;
      }

      const tokens = this.tokensFromCognito(cognitoTokens);
      await this.publishTokens(tokens);
      return tokens;
    });
  }

  /**
   * Run a Cognito user-pool call, recovering from server-side token
   * revocation with one refresh-and-retry. Exposed so `account.ts` (B2) can
   * run its own Cognito operations under the same lock and recovery policy.
   *
   * `operation` is given the resolved access token; it runs inside the
   * locked section. If Cognito rejects the token with
   * `NotAuthorizedException` — which `getAccessToken`'s local expiry check
   * cannot detect — the session is refreshed and the call retried exactly
   * once; a second failure propagates the underlying error for the caller's
   * own error mapping.
   *
   * `after`, if given, runs under the same lock as the successful call (so
   * e.g. `changePassword` can publish rotated tokens captured during it);
   * an error from `after` is not treated as a retry candidate, matching
   * Python (it runs outside the `NotAuthorizedException` recovery branch).
   *
   * `forceRefresh` acquires the same lock, so the refresh happens outside
   * the locked section: the loop alternates lock-held attempts with
   * unlocked refreshes rather than nesting the two (the lock is not
   * re-entrant).
   */
  async runUserPoolOp<T>(
    operation: (accessToken: string) => Promise<T>,
    options?: RunUserPoolOpOptions<T>,
  ): Promise<T> {
    let accessToken = await this.getAccessToken();
    let refreshedOnce = false;
    for (;;) {
      const step = await this.lock.runExclusive(
        async (): Promise<{ kind: "success"; value: T } | { kind: "retry" }> => {
          let result: T;
          try {
            result = await operation(accessToken);
          } catch (err) {
            if (
              !refreshedOnce &&
              err instanceof CognitoError &&
              err.name === "NotAuthorizedException"
            ) {
              return { kind: "retry" };
            }
            throw err;
          }
          if (options?.after !== undefined) {
            await options.after(result);
          }
          return { kind: "success", value: result };
        },
      );
      if (step.kind === "success") {
        return step.value;
      }
      refreshedOnce = true;
      const refreshed = await this.forceRefresh({ staleAccessToken: accessToken });
      accessToken = this.requireAccessToken(refreshed);
    }
  }

  /**
   * Verify a freshly obtained token pair against the pool's JWKS
   * (PLAN.md §3.4), when `verifyTokens` is enabled. Operates on the
   * adapter's raw `CognitoTokens` (both fields always present) rather than
   * a `TokenSet`, so there is no "was this field supplied" branch to cover.
   *
   * @throws {EvnexAuthError} verification failed; callers remap this to a
   *   more specific error for their own call site.
   */
  private async verifyIssuedTokens(tokens: CognitoTokens): Promise<void> {
    if (!this.verifyTokens) {
      return;
    }
    const jwks = await fetchJwks(this.config.EVNEX_COGNITO_USER_POOL_ID);
    await verifyJwt(tokens.accessToken, jwks);
    await verifyJwt(tokens.idToken, jwks);
  }

  /**
   * Cognito omits the refresh token from renewals unless pool rotation is
   * enabled; carry the current one forward rather than overwriting a live
   * refresh token with `undefined` (which would silently kill the
   * integration at the next access-token expiry).
   */
  private tokensFromCognito(tokens: CognitoTokens): TokenSet {
    return new TokenSet({
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      refreshToken: tokens.refreshToken ?? this.currentTokens?.refreshToken,
    });
  }

  /**
   * Persist a newly issued token set, then make it the current one.
   *
   * Ordering matters: `onTokenUpdate` completes before the assignment that
   * makes the tokens visible to other tasks (including `getAccessToken`'s
   * lock-free fast path), so a token set can never be used for a request
   * before the application has persisted it.
   *
   * The callback's failures are logged and swallowed on purpose: the tokens
   * are valid regardless, and a broken store must not take API access down
   * with it. The application can always re-read `.tokens`.
   *
   * Public (unlike Python's private `_store_tokens`) because `account.ts`
   * (B2)'s `changePassword` needs to publish tokens rotated as a side
   * effect of a user-pool call, from its `runUserPoolOp` `after` hook —
   * matching Python, where that ships under the same lock via `after=`
   * (PLAN.md §5 B2). **Must only ever be called from within a locked
   * section** — in practice, that means from inside a `runUserPoolOp`
   * `after` callback (which already runs inside this class's lock) — never
   * from arbitrary caller code, or the persist-before-publish ordering
   * guarantee no longer holds.
   */
  async publishTokens(tokens: TokenSet): Promise<void> {
    if (this.onTokenUpdate !== undefined) {
      try {
        await this.onTokenUpdate(tokens);
      } catch (err) {
        // Deliberate: a broken store must not take API access down; this
        // is the one place that failure is surfaced.
        console.error("evnex: onTokenUpdate callback failed:", err);
      }
    }
    this.currentTokens = tokens;
  }
}
