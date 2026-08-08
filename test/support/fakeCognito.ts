/**
 * Offline stand-in for pycognito's `Cognito` — ported from `tests/conftest.py`'s
 * `FakeCognito` (PLAN.md §5 A9), but built as a **fake implementation of A6's
 * adapter interface** (`src/auth/cognito.ts`'s `CognitoAdapter`) rather than an
 * SDK mock. A6 exports no `@aws-sdk/*` type past that adapter boundary, so
 * everything above it (B1's `CognitoSession`, B2's `AccountOperations`, and
 * everything that composes them) is testable entirely offline with this class
 * — no AWS SDK, no network. A6's own tests stub one level lower, via the SDK's
 * `requestHandler`; that is not this file's job.
 *
 * Every method is a plain, reassignable instance property (not a prototype
 * method) — the direct analogue of Python's `MagicMock(side_effect=...)`.
 * Script a failure or a different result for one call by reassigning the
 * property directly:
 *
 * ```ts
 * const cognito = new FakeCognito();
 * cognito.authenticate = async () => {
 *   throw new CognitoError("NotAuthorizedException", "Incorrect username or password.");
 * };
 * ```
 *
 * Two behaviours from the Python fixture are load-bearing and preserved
 * exactly:
 *
 * 1. **Token-serial rotation.** Every successful issuance/rotation bumps a
 *    shared counter and stamps it into both tokens (`access-N` / `id-N`), so
 *    tests can assert *which* call produced the tokens in play (e.g. "the
 *    retried request used access-2, not access-1").
 * 2. **Refresh responses omit the refresh token.** `renewAccessToken` (the
 *    `REFRESH_TOKEN_AUTH` analogue) never returns a `refreshToken` — Cognito
 *    only returns one on renewal when pool rotation is enabled, which this
 *    pool does not have. This is precisely the case `TokenSet`'s
 *    carry-forward logic (A7) exists to handle: the caller must carry the
 *    *previous* refresh token forward rather than overwriting it with
 *    `undefined`. `authenticate` and the two challenge-response methods, by
 *    contrast, always return a fresh `refreshToken` ("refresh-0"), matching
 *    Cognito's behaviour on a brand new sign-in.
 */

import type {
  CognitoAdapter,
  CognitoAuthResult,
  CognitoTokens,
  CognitoUserInfo,
} from "../../src/auth/cognito.js";

export class FakeCognito implements CognitoAdapter {
  private serial = 0;

  /** The most recently issued/rotated access token, mirroring `pycognito.Cognito.access_token`. */
  accessToken: string | undefined;
  idToken: string | undefined;
  refreshToken: string | undefined;

  authenticate = (_params: {
    username: string;
    password: string;
  }): Promise<CognitoAuthResult> =>
    Promise.resolve({ kind: "tokens" as const, tokens: this.issueTokens() });

  respondToSoftwareTokenMfaChallenge = (_params: {
    username: string;
    session: string;
    code: string;
  }): Promise<CognitoAuthResult> =>
    Promise.resolve({ kind: "tokens" as const, tokens: this.issueTokens() });

  respondToSmsMfaChallenge = (_params: {
    username: string;
    session: string;
    code: string;
  }): Promise<CognitoAuthResult> =>
    Promise.resolve({ kind: "tokens" as const, tokens: this.issueTokens() });

  renewAccessToken = (_params: {
    username: string;
    refreshToken: string;
  }): Promise<CognitoTokens> => Promise.resolve(this.rotateTokens());

  getUser = (_params: { accessToken: string }): Promise<CognitoUserInfo> =>
    Promise.resolve({
      mfaSettingList: ["SOFTWARE_TOKEN_MFA"],
      preferredMfaSetting: "SOFTWARE_TOKEN_MFA",
    });

  associateSoftwareToken = (_params: {
    accessToken: string;
  }): Promise<{ secretCode: string }> => Promise.resolve({ secretCode: "FAKESECRETBASE32" });

  verifySoftwareToken = (_params: {
    accessToken: string;
    code: string;
    deviceName: string;
  }): Promise<{ status: string }> => Promise.resolve({ status: "SUCCESS" });

  setUserMfaPreference = (_params: {
    accessToken: string;
    smsMfa: boolean;
    softwareTokenMfa: boolean;
    preferred: string | undefined;
  }): Promise<void> => Promise.resolve();

  changePassword = (_params: {
    accessToken: string;
    previousPassword: string;
    proposedPassword: string;
  }): Promise<void> => Promise.resolve();

  forgotPassword = (_params: { username: string }): Promise<{ destination: string }> =>
    Promise.resolve({ destination: "b***@e***" });

  confirmForgotPassword = (_params: {
    username: string;
    code: string;
    newPassword: string;
  }): Promise<void> => Promise.resolve();

  /**
   * Issue newly-serialed tokens carrying a fresh refresh token — the
   * behaviour behind `authenticate` and the two MFA-challenge-response
   * methods (Python's `_issue_tokens`). Public so a test's own override can
   * still participate in serial rotation, e.g. a scripted
   * challenge-then-success sequence.
   */
  issueTokens(): CognitoTokens {
    this.serial += 1;
    this.accessToken = `access-${this.serial}`;
    this.idToken = `id-${this.serial}`;
    this.refreshToken = "refresh-0";
    return {
      accessToken: this.accessToken,
      idToken: this.idToken,
      refreshToken: this.refreshToken,
    };
  }

  /**
   * Rotate to newly-serialed tokens with **no** refresh token — the
   * behaviour behind `renewAccessToken` (Python's `_rotate_tokens`), and the
   * case `TokenSet`'s carry-forward logic exists for. Public for the same
   * reason as {@link issueTokens}.
   */
  rotateTokens(): CognitoTokens {
    this.serial += 1;
    this.accessToken = `access-${this.serial}`;
    this.idToken = `id-${this.serial}`;
    this.refreshToken = undefined;
    return {
      accessToken: this.accessToken,
      idToken: this.idToken,
      refreshToken: undefined,
    };
  }
}
