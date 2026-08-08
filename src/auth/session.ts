/**
 * Session lifecycle — ported from `evnex/auth.py`'s `EvnexAuth` session half:
 * `start_authentication`, `respond_to_challenge`, `get_access_token`,
 * `force_refresh`, `_store_tokens`, `_run_user_pool_op`, `_tokens_from_cognito`.
 *
 * TODO(B1): implement. Three properties must survive the port intact
 * (PLAN.md §5 B1):
 *
 * 1. Single-flight refresh: `forceRefresh({ staleAccessToken })` returns the
 *    already-rotated tokens without a second network call when another task
 *    won the race. Calling `forceRefresh()` with **no** argument at all
 *    means "always refresh unconditionally" — distinct from passing
 *    `{ staleAccessToken: undefined }`, which means "the session never had
 *    an access token; refresh unless it already rotated past that". A
 *    nullish check on `staleAccessToken` is NOT a valid substitute for this
 *    distinction (the Python `_ALWAYS_REFRESH` sentinel); branch on whether
 *    the options argument was passed at all.
 * 2. Persist-before-publish: `storeTokens` awaits `onTokenUpdate` **before**
 *    assigning the new tokens. Callback failures are logged and swallowed.
 * 3. `runUserPoolOp` recovery: on a Cognito `NotAuthorizedException`, refresh
 *    once (outside the locked section — the lock is not re-entrant) and
 *    retry exactly once.
 *
 * `EXPIRY_SKEW` is 30 seconds and refreshes proactively.
 */

import type { EvnexConfig } from "../config.js";
import type { CognitoAdapter } from "./cognito.js";
import type { AuthChallenge } from "./challenge.js";
import type { TokenSet } from "./tokens.js";

export type TokenUpdateCallback = (tokens: TokenSet) => Promise<void>;

export interface CognitoSessionOptions {
  tokens?: TokenSet | undefined;
  onTokenUpdate?: TokenUpdateCallback | undefined;
  config?: EvnexConfig | undefined;
  /** Injection point for tests; built from `config` when omitted. */
  cognito?: CognitoAdapter | undefined;
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
   * during `operation` (e.g. rotated tokens) can be published atomically.
   */
  after?: (result: T) => Promise<void>;
}

/** Manages Cognito sign-in, MFA challenge response, and session renewal. */
export class CognitoSession {
  constructor(options?: CognitoSessionOptions) {
    throw new Error("TODO(B1)");
  }

  /** The current token set, if any. */
  get tokens(): TokenSet | undefined {
    throw new Error("TODO(B1)");
  }

  /**
   * Begin interactive sign-in. Resolves to a `TokenSet` on immediate
   * success, or an `AuthChallenge` that must be answered via
   * `respondToChallenge`.
   *
   * @throws {import("../errors.js").InvalidCredentialsError}
   * @throws {import("../errors.js").PasswordChangeRequiredError}
   */
  async startAuthentication(
    username: string,
    password: string,
  ): Promise<TokenSet | AuthChallenge> {
    throw new Error("TODO(B1)");
  }

  /**
   * Answer an authentication challenge (e.g. with a 6-digit MFA code).
   *
   * @throws {import("../errors.js").InvalidChallengeResponseError}
   * @throws {import("../errors.js").ChallengeExpiredError}
   */
  async respondToChallenge(
    challenge: AuthChallenge,
    response: string,
  ): Promise<TokenSet | AuthChallenge> {
    throw new Error("TODO(B1)");
  }

  /**
   * Return a valid access token, refreshing the session if required.
   *
   * @throws {import("../errors.js").ReauthenticationRequiredError}
   */
  async getAccessToken(): Promise<string> {
    throw new Error("TODO(B1)");
  }

  /** Refresh unconditionally. */
  async forceRefresh(): Promise<TokenSet>;
  /** Single-flight refresh — see the class-level TODO note. */
  async forceRefresh(options: ForceRefreshOptions): Promise<TokenSet>;
  async forceRefresh(options?: ForceRefreshOptions): Promise<TokenSet> {
    throw new Error("TODO(B1)");
  }

  /**
   * Run a Cognito user-pool call, recovering from server-side token
   * revocation with one refresh-and-retry. Exposed so `account.ts` (B2) can
   * run its own Cognito operations under the same lock and recovery policy.
   */
  async runUserPoolOp<T>(
    operation: (accessToken: string) => Promise<T>,
    options?: RunUserPoolOpOptions<T>,
  ): Promise<T> {
    throw new Error("TODO(B1)");
  }
}
