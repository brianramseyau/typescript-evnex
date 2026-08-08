/**
 * MFA enrollment and status — ported from `evnex/auth.py`'s `TotpEnrollment`
 * and `MfaStatus` (frozen dataclasses).
 */

// Python's urllib.parse.quote() (default safe="/") leaves unreserved
// characters (letters, digits, "_.-~") and "/" untouched and percent-encodes
// everything else as uppercase hex over the UTF-8 bytes. This does NOT match
// encodeURIComponent, which additionally leaves "!*'()" unescaped and DOES
// escape "/" — checked empirically against CPython 3.11:
//   quote("a!b")   -> "a%21b"   encodeURIComponent("a!b")   -> "a!b"
//   quote("a/b")   -> "a/b"     encodeURIComponent("a/b")   -> "a%2Fb"
// so provisioningUri needs its own encoder rather than reusing the built-in.
const PYTHON_QUOTE_ALWAYS_SAFE = new Set<string>(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~",
);

function pythonQuote(value: string, safe = "/"): string {
  const safeChars = new Set(PYTHON_QUOTE_ALWAYS_SAFE);
  for (const ch of safe) {
    safeChars.add(ch);
  }
  const bytes = Buffer.from(value, "utf8");
  let out = "";
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (byte < 128 && safeChars.has(ch)) {
      out += ch;
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export class TotpEnrollment {
  readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
    Object.freeze(this);
  }

  /**
   * An otpauth:// URI for QR rendering or a password manager's OTP field.
   * Matches the label/issuer conventions of EVNEX's own enrollment.
   * Percent-encodes exactly as Python's `urllib.parse.quote()` does.
   */
  provisioningUri(accountName: string, issuer = "Evnex"): string {
    return (
      `otpauth://totp/${pythonQuote(accountName)}` +
      `?secret=${this.secret}&issuer=${pythonQuote(issuer)}`
    );
  }
}

/** The MFA methods currently enabled for an account. */
export interface MfaStatus {
  readonly enabled: readonly string[];
  readonly preferred: string | undefined;
}
