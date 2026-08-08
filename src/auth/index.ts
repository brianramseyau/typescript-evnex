/**
 * The `EvnexAuth` facade — ported from `evnex/auth.py`'s `EvnexAuth` class.
 *
 * This is a **real implementation**, not a stub: pure delegation to
 * `CognitoSession` (`./session.js`, B1) and `AccountOperations`
 * (`./account.js`, B2). It is the seam that keeps B1 and B2 from colliding,
 * so F0 implements it directly rather than leaving it as a `TODO(...)`
 * stub (PLAN.md §5 F0 deliverable 4).
 *
 * Because it delegates to modules that are themselves still `TODO(...)`
 * stubs, every method here throws at runtime until B1 and B2 land — that is
 * expected and correct; this file's own tests mock its collaborators.
 */

import { EvnexConfig } from "../config.js";
import { AccountOperations } from "./account.js";
import type {
  ConfirmTotpEnrollmentOptions,
  SetMfaPreferenceOptions,
} from "./account.js";
import type { AuthChallenge } from "./challenge.js";
import { createCognitoAdapter } from "./cognito.js";
import type { CognitoAdapter } from "./cognito.js";
import type { MfaStatus, TotpEnrollment } from "./mfa.js";
import { CognitoSession } from "./session.js";
import type { ForceRefreshOptions, TokenUpdateCallback } from "./session.js";
import type { TokenSet } from "./tokens.js";

export { AuthChallenge, isAuthChallenge } from "./challenge.js";
export { TotpEnrollment } from "./mfa.js";
export type { MfaStatus } from "./mfa.js";
export { TokenSet } from "./tokens.js";
export type { TokenSetJSON } from "./tokens.js";
export type { ForceRefreshOptions, TokenUpdateCallback } from "./session.js";
export type {
  ConfirmTotpEnrollmentOptions,
  SetMfaPreferenceOptions,
} from "./account.js";

export interface EvnexAuthOptions {
  /** Resume a previous session; a refresh token alone is enough. */
  tokens?: TokenSet | undefined;
  /**
   * Called with every newly issued token set. Guaranteed to complete before
   * any request uses the new tokens (PLAN.md §2.3 / §5 B1).
   */
  onTokenUpdate?: TokenUpdateCallback | undefined;
  config?: EvnexConfig | undefined;
  /** Injection point for tests; built from `config` when omitted. */
  cognito?: CognitoAdapter | undefined;
}

/**
 * Manages sign-in, MFA, and session renewal for an EVNEX account.
 *
 * Sign in interactively with `startAuthentication()` (answering any
 * `AuthChallenge` via `respondToChallenge()`), or resume a previous session
 * by passing `tokens` — a refresh token alone is enough. Expired sessions
 * renew automatically; provide `onTokenUpdate` to persist each newly issued
 * token set. Credentials themselves are never stored.
 */
export class EvnexAuth {
  private readonly session: CognitoSession;
  private readonly account: AccountOperations;

  constructor(options: EvnexAuthOptions = {}) {
    const config = options.config ?? new EvnexConfig();
    const cognito =
      options.cognito ??
      createCognitoAdapter({
        userPoolId: config.EVNEX_COGNITO_USER_POOL_ID,
        clientId: config.EVNEX_COGNITO_CLIENT_ID,
      });
    this.session = new CognitoSession({
      tokens: options.tokens,
      onTokenUpdate: options.onTokenUpdate,
      config,
      cognito,
    });
    this.account = new AccountOperations({ session: this.session, cognito, config });
  }

  /** The current token set, if any. */
  get tokens(): TokenSet | undefined {
    return this.session.tokens;
  }

  /**
   * Begin interactive sign-in with the user's credentials. Resolves to a
   * `TokenSet` on immediate success, or an `AuthChallenge` (see
   * `isAuthChallenge`) that must be answered via `respondToChallenge()`.
   */
  async startAuthentication(
    username: string,
    password: string,
  ): Promise<TokenSet | AuthChallenge> {
    return this.session.startAuthentication(username, password);
  }

  /** Answer an authentication challenge (e.g. with a 6-digit MFA code). */
  async respondToChallenge(
    challenge: AuthChallenge,
    response: string,
  ): Promise<TokenSet | AuthChallenge> {
    return this.session.respondToChallenge(challenge, response);
  }

  /** Return a valid access token, refreshing the session if required. */
  async getAccessToken(): Promise<string> {
    return this.session.getAccessToken();
  }

  /** Obtain fresh tokens using the refresh token. See `CognitoSession.forceRefresh`. */
  async forceRefresh(options?: ForceRefreshOptions): Promise<TokenSet> {
    return options === undefined
      ? this.session.forceRefresh()
      : this.session.forceRefresh(options);
  }

  /** Report which MFA methods are enabled for the signed-in account. */
  async getMfaStatus(): Promise<MfaStatus> {
    return this.account.getMfaStatus();
  }

  /** Start enrolling a (new) TOTP authenticator device. */
  async beginTotpEnrollment(): Promise<TotpEnrollment> {
    return this.account.beginTotpEnrollment();
  }

  /** Verify a code from the newly enrolled authenticator device. */
  async confirmTotpEnrollment(
    code: string,
    options?: ConfirmTotpEnrollmentOptions,
  ): Promise<void> {
    return this.account.confirmTotpEnrollment(code, options);
  }

  /** Enable, disable, or reprioritise MFA methods for the account. */
  async setMfaPreference(options?: SetMfaPreferenceOptions): Promise<void> {
    return this.account.setMfaPreference(options);
  }

  /** Change the password of the signed-in account. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.account.changePassword(currentPassword, newPassword);
  }

  /** Begin the forgot-password flow. Returns the masked delivery destination. */
  async startPasswordReset(username: string): Promise<string> {
    return this.account.startPasswordReset(username);
  }

  /** Complete the forgot-password flow with the emailed/texted code. */
  async confirmPasswordReset(
    username: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    return this.account.confirmPasswordReset(username, code, newPassword);
  }
}
