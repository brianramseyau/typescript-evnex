/**
 * MFA enrollment and status — ported from `evnex/auth.py`'s `TotpEnrollment`
 * and `MfaStatus` (frozen dataclasses).
 *
 * TODO(A7): implement.
 */

export class TotpEnrollment {
  readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
    throw new Error("TODO(A7)");
  }

  /**
   * An otpauth:// URI for QR rendering or a password manager's OTP field.
   * Matches the label/issuer conventions of EVNEX's own enrollment. Must
   * percent-encode exactly as Python's `urllib.parse.quote()` does.
   */
  provisioningUri(accountName: string, issuer = "Evnex"): string {
    throw new Error("TODO(A7)");
  }
}

/** The MFA methods currently enabled for an account. */
export interface MfaStatus {
  readonly enabled: readonly string[];
  readonly preferred: string | undefined;
}
