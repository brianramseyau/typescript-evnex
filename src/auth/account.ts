/**
 * Account operations — ported from `evnex/auth.py`'s `EvnexAuth` account
 * half: `get_mfa_status`, `begin_totp_enrollment`, `confirm_totp_enrollment`,
 * `set_mfa_preference`, `change_password`, `start_password_reset`,
 * `confirm_password_reset`.
 *
 * TODO(B2): implement.
 *
 * `setMfaPreference` infers `preferred` when exactly one method is enabled,
 * and throws when both are enabled with no preference given. Both flags
 * false disables MFA entirely.
 *
 * `changePassword` must capture token rotation the underlying call can
 * trigger as a side effect: publish the rotated set via the same lock as the
 * call (`CognitoSession.runUserPoolOp`'s `after` hook), never drop it.
 *
 * `startPasswordReset` needs no signed-in session; it returns the masked
 * delivery destination, or `""` when the server reports none.
 */

import type { EvnexConfig } from "../config.js";
import type { CognitoAdapter } from "./cognito.js";
import type { MfaStatus, TotpEnrollment } from "./mfa.js";
import type { CognitoSession } from "./session.js";

export interface AccountOperationsOptions {
  session: CognitoSession;
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

/** MFA and password management for the signed-in (or, for password reset, anonymous) account. */
export class AccountOperations {
  constructor(options: AccountOperationsOptions) {
    throw new Error("TODO(B2)");
  }

  /** Report which MFA methods are enabled for the signed-in account. */
  async getMfaStatus(): Promise<MfaStatus> {
    throw new Error("TODO(B2)");
  }

  /**
   * Start enrolling a (new) TOTP authenticator device. Completing enrollment
   * replaces any previously registered TOTP device.
   */
  async beginTotpEnrollment(): Promise<TotpEnrollment> {
    throw new Error("TODO(B2)");
  }

  /**
   * Verify a code from the newly enrolled authenticator device. Registers
   * the device but does not turn MFA on for the account; call
   * `setMfaPreference({ totp: true })` as well when first enabling MFA.
   *
   * @throws {import("../errors.js").InvalidChallengeResponseError}
   */
  async confirmTotpEnrollment(
    code: string,
    options?: ConfirmTotpEnrollmentOptions,
  ): Promise<void> {
    throw new Error("TODO(B2)");
  }

  /**
   * Enable, disable, or reprioritise MFA methods for the account.
   *
   * @throws {Error} both methods are enabled but no preferred one is given
   */
  async setMfaPreference(options: SetMfaPreferenceOptions = {}): Promise<void> {
    throw new Error("TODO(B2)");
  }

  /**
   * Change the password of the signed-in account.
   *
   * @throws {import("../errors.js").InvalidCredentialsError}
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    throw new Error("TODO(B2)");
  }

  /**
   * Begin the forgot-password flow, sending a reset code to the user. Needs
   * no session. Complete the reset with `confirmPasswordReset`.
   */
  async startPasswordReset(username: string): Promise<string> {
    throw new Error("TODO(B2)");
  }

  /**
   * Complete the forgot-password flow with the emailed/texted code.
   *
   * @throws {import("../errors.js").InvalidChallengeResponseError}
   * @throws {import("../errors.js").ChallengeExpiredError}
   */
  async confirmPasswordReset(
    username: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    throw new Error("TODO(B2)");
  }
}
