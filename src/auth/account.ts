/**
 * Account operations — ported from `evnex/auth.py`'s `EvnexAuth` account
 * half: `get_mfa_status`, `begin_totp_enrollment`, `confirm_totp_enrollment`,
 * `set_mfa_preference`, `change_password`, `start_password_reset`,
 * `confirm_password_reset`.
 *
 * `setMfaPreference` infers `preferred` when exactly one method is enabled,
 * and throws when both are enabled with no preference given. Both flags
 * false disables MFA entirely.
 *
 * Every Cognito user-pool call here goes through `session.runUserPoolOp`
 * (B1's `CognitoSession`), which supplies a valid access token and recovers
 * from server-side token revocation with one refresh-and-retry — that
 * refresh is published by `CognitoSession` itself (PLAN.md §5 B1 item 2),
 * with no help needed from this module.
 *
 * `changePassword` additionally mirrors a *second*, Python-specific source
 * of rotation: pycognito's `change_password` calls `check_token(renew=True)`
 * *before* touching the API, so if the session's access token has (locally)
 * expired since it was last checked, pycognito renews it first and the
 * rotated tokens must not be dropped. See that method's own comment for how
 * this port reproduces the *effect* without the same lock-nesting Python
 * uses (`after=`) — `runUserPoolOp`'s lock is not re-entrant, and this
 * module has no lock-free way to publish tokens from inside it; see this
 * file's bottom-of-file port note and the report to INT.
 *
 * `startPasswordReset` needs no signed-in session; it returns the masked
 * delivery destination, or `""` when the server reports none.
 */

import {
  ChallengeExpiredError,
  EvnexAuthError,
  InvalidChallengeResponseError,
  InvalidCredentialsError,
} from "../errors.js";
import type { EvnexConfig } from "../config.js";
import { CognitoError } from "./cognito.js";
import type { CognitoAdapter } from "./cognito.js";
import { TotpEnrollment } from "./mfa.js";
import type { MfaStatus } from "./mfa.js";
import type { ForceRefreshOptions, RunUserPoolOpOptions } from "./session.js";
import type { TokenSet } from "./tokens.js";

/**
 * The slice of `CognitoSession` (B1, `./session.ts`) account operations
 * need: the current tokens, running a user-pool call under the session's
 * lock and NotAuthorizedException recovery policy, and forcing a
 * single-flight refresh. A real `CognitoSession` instance satisfies this
 * structurally — this module never constructs one itself — which is what
 * lets this file's own tests substitute a lightweight fake instead of
 * standing up B1's full session lifecycle (PLAN.md §5 B2: "depends on B1's
 * `CognitoSession` interface only").
 */
export interface AccountSession {
  readonly tokens: TokenSet | undefined;
  runUserPoolOp<T>(
    operation: (accessToken: string) => Promise<T>,
    options?: RunUserPoolOpOptions<T>,
  ): Promise<T>;
  forceRefresh(options: ForceRefreshOptions): Promise<TokenSet>;
}

export interface AccountOperationsOptions {
  session: AccountSession;
  cognito: CognitoAdapter;
  config?: EvnexConfig | undefined;
}

export interface SetMfaPreferenceOptions {
  totp?: boolean;
  sms?: boolean;
  preferred?: string | undefined;
}

export interface ConfirmTotpEnrollmentOptions {
  deviceName?: string;
}

/**
 * PLAN.md §3.2: the same Cognito error name maps to a different
 * `Evnex*Error` depending on which account operation raised it. `mapSpecial`
 * lets a call site override the mapping for particular error names;
 * anything it declines (returns `undefined` for) falls back to
 * `EvnexAuthError`, carrying the Cognito error's own message. A non-
 * `CognitoError` (nothing this module's Cognito calls can actually throw,
 * but kept for defence-in-depth and symmetry with `cognito.ts`'s own
 * "these two propagate untouched" rule) is rethrown unchanged.
 */
function rethrowCognitoError(
  err: unknown,
  mapSpecial: (err: CognitoError) => Error | undefined = () => undefined,
): never {
  if (err instanceof CognitoError) {
    throw mapSpecial(err) ?? new EvnexAuthError(err.message, { cause: err });
  }
  throw err;
}

/** MFA and password management for the signed-in (or, for password reset, anonymous) account. */
export class AccountOperations {
  private readonly session: AccountSession;
  private readonly cognito: CognitoAdapter;

  constructor(options: AccountOperationsOptions) {
    this.session = options.session;
    this.cognito = options.cognito;
  }

  /** Report which MFA methods are enabled for the signed-in account. */
  async getMfaStatus(): Promise<MfaStatus> {
    try {
      return await this.session.runUserPoolOp(async (accessToken) => {
        const info = await this.cognito.getUser({ accessToken });
        return { enabled: info.mfaSettingList, preferred: info.preferredMfaSetting };
      });
    } catch (err) {
      rethrowCognitoError(err);
    }
  }

  /**
   * Start enrolling a (new) TOTP authenticator device. Completing enrollment
   * replaces any previously registered TOTP device.
   */
  async beginTotpEnrollment(): Promise<TotpEnrollment> {
    try {
      const secret = await this.session.runUserPoolOp(async (accessToken) => {
        const { secretCode } = await this.cognito.associateSoftwareToken({ accessToken });
        return secretCode;
      });
      return new TotpEnrollment(secret);
    } catch (err) {
      rethrowCognitoError(err);
    }
  }

  /**
   * Verify a code from the newly enrolled authenticator device. Registers
   * the device but does not turn MFA on for the account; call
   * `setMfaPreference({ totp: true })` as well when first enabling MFA.
   *
   * @throws {InvalidChallengeResponseError} the code was rejected
   */
  async confirmTotpEnrollment(
    code: string,
    options: ConfirmTotpEnrollmentOptions = {},
  ): Promise<void> {
    const deviceName = options.deviceName ?? "";
    let verified: boolean;
    try {
      verified = await this.session.runUserPoolOp(async (accessToken) => {
        const { status } = await this.cognito.verifySoftwareToken({
          accessToken,
          code: code.trim(),
          deviceName,
        });
        return status === "SUCCESS";
      });
    } catch (err) {
      rethrowCognitoError(err, (e) =>
        e.name === "CodeMismatchException" || e.name === "EnableSoftwareTokenMFAException"
          ? new InvalidChallengeResponseError(e.message, { cause: e })
          : undefined,
      );
    }
    if (!verified) {
      throw new InvalidChallengeResponseError("The code was not accepted");
    }
  }

  /**
   * Enable, disable, or reprioritise MFA methods for the account.
   *
   * With both flags `false`, MFA is disabled entirely (where the user pool
   * allows it). `preferred` is `"SMS"` or `"SOFTWARE_TOKEN"`; it may be
   * omitted when only one method is enabled.
   *
   * @throws {Error} both methods are enabled but no preferred one is given —
   *   a preference is required to break the tie (mirrors Python's plain
   *   `ValueError`, not part of the `Evnex*Error` hierarchy)
   */
  async setMfaPreference(options: SetMfaPreferenceOptions = {}): Promise<void> {
    const totp = options.totp ?? false;
    const sms = options.sms ?? false;
    let preferred = options.preferred;
    if (preferred === undefined && totp !== sms) {
      preferred = totp ? "SOFTWARE_TOKEN" : "SMS";
    }
    if (totp && sms && preferred === undefined) {
      throw new Error(
        "preferred is required when enabling both TOTP and SMS MFA; " +
          'pass preferred: "SOFTWARE_TOKEN" or preferred: "SMS"',
      );
    }

    try {
      await this.session.runUserPoolOp((accessToken) =>
        this.cognito.setUserMfaPreference({
          accessToken,
          smsMfa: sms,
          softwareTokenMfa: totp,
          preferred,
        }),
      );
    } catch (err) {
      rethrowCognitoError(err);
    }
  }

  /**
   * Change the password of the signed-in account.
   *
   * @throws {InvalidCredentialsError} the current password was wrong
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    try {
      // Mirror pycognito's change_password, which runs check_token(renew=True)
      // *before* calling the Cognito API: if the session's current access
      // token is already locally expired (its own JWT `exp` claim, with no
      // skew — the same narrow race `getAccessToken`'s EXPIRY_SKEW mostly
      // closes but doesn't fully, since nothing re-checks between there and
      // here), renew proactively rather than attempt the password change
      // with a dead token, and so the rotation is published rather than
      // silently kept local to this call.
      //
      // This can't ride `runUserPoolOp`'s `after` hook the way Python's
      // `_publish` does: `after` runs *inside* `CognitoSession`'s lock
      // (RunUserPoolOpOptions's own doc comment), and `forceRefresh`
      // acquires that same non-reentrant lock — calling it from `after`
      // would deadlock. Doing it here, just before `runUserPoolOp` starts,
      // keeps the refresh (and the publish it performs) outside any lock
      // `runUserPoolOp` itself is holding, at the cost of strict atomicity
      // with the password-change call itself. Flagged to INT: a lock-free
      // "publish already-obtained tokens" primitive on `CognitoSession`
      // would let this move inside `after`, matching Python's exact
      // locking granularity.
      const current = this.session.tokens;
      if (
        current?.accessToken !== undefined &&
        current.expiresAt !== undefined &&
        current.expiresAt.getTime() <= Date.now()
      ) {
        await this.session.forceRefresh({ staleAccessToken: current.accessToken });
      }

      await this.session.runUserPoolOp(async (accessToken) => {
        await this.cognito.changePassword({
          accessToken,
          previousPassword: currentPassword,
          proposedPassword: newPassword,
        });
      });
    } catch (err) {
      rethrowCognitoError(err, (e) =>
        e.name === "NotAuthorizedException"
          ? new InvalidCredentialsError(e.message, { cause: e })
          : undefined,
      );
    }
  }

  /**
   * Begin the forgot-password flow, sending a reset code to the user. Needs
   * no session. Complete the reset with `confirmPasswordReset`.
   */
  async startPasswordReset(username: string): Promise<string> {
    try {
      const { destination } = await this.cognito.forgotPassword({ username });
      return destination;
    } catch (err) {
      rethrowCognitoError(err);
    }
  }

  /**
   * Complete the forgot-password flow with the emailed/texted code.
   *
   * @throws {InvalidChallengeResponseError} the reset code was wrong
   * @throws {ChallengeExpiredError} the reset code expired
   */
  async confirmPasswordReset(username: string, code: string, newPassword: string): Promise<void> {
    try {
      await this.cognito.confirmForgotPassword({ username, code: code.trim(), newPassword });
    } catch (err) {
      rethrowCognitoError(err, (e) => {
        if (e.name === "CodeMismatchException") {
          return new InvalidChallengeResponseError(e.message, { cause: e });
        }
        if (e.name === "ExpiredCodeException") {
          return new ChallengeExpiredError(e.message, { cause: e });
        }
        return undefined;
      });
    }
  }
}
