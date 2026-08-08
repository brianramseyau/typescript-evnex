/**
 * Narrow Cognito adapter — the `pycognito` surface used by `evnex/auth.py`,
 * ported per PLAN.md §3.1 / §3.2 onto `@aws-sdk/client-cognito-identity-provider`.
 *
 * Deliberately the only module that knows how tokens are obtained. It leaks
 * no `@aws-sdk/*` types past this file — every exported signature here uses
 * only plain data — which is what makes the §8 risk-1 escape hatch cheap: if
 * live SRP ever needs to fall back to `amazon-cognito-identity-js`, only this
 * file changes.
 *
 * TODO(A6): implement, using A5's `createSrpClient` for the SRP handshake
 * inside `authenticate`. Map SDK errors per PLAN.md §3.2 into `CognitoError`;
 * callers (session.ts / account.ts) do their own further mapping to the
 * `Evnex*Error` hierarchy from the `{ name, message }` this carries.
 */

/** A resolved Cognito token issuance. */
export interface CognitoTokens {
  accessToken: string;
  idToken: string;
  /**
   * Cognito omits the refresh token from renewals unless pool rotation is
   * enabled — absent here in that case, never an empty string.
   */
  refreshToken?: string;
}

/** A Cognito authentication challenge (e.g. `SOFTWARE_TOKEN_MFA`, `SMS_MFA`). */
export interface CognitoChallenge {
  challengeName: string;
  session: string;
  parameters: Record<string, string>;
}

export type CognitoAuthResult =
  | { kind: "tokens"; tokens: CognitoTokens }
  | { kind: "challenge"; challenge: CognitoChallenge };

export interface CognitoUserInfo {
  mfaSettingList: readonly string[];
  preferredMfaSetting: string | undefined;
}

/**
 * A Cognito-reported error, carrying the exception name (e.g.
 * `"NotAuthorizedException"`, `"CodeMismatchException"`) so the caller can
 * apply its own call-site-dependent mapping (PLAN.md §3.2 — the same
 * Cognito error name maps to different `Evnex*Error` types depending on
 * which operation raised it).
 */
export class CognitoError extends Error {
  constructor(name: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = name;
    throw new Error("TODO(A6)");
  }
}

export interface CognitoAdapterOptions {
  userPoolId: string;
  clientId: string;
}

/**
 * The eleven Cognito operations `evnex/auth.py` performs via `pycognito`
 * (PLAN.md §3.1), exposed as plain async methods. No `@aws-sdk/*` type may
 * appear in this interface.
 */
export interface CognitoAdapter {
  /**
   * Full `USER_SRP_AUTH` handshake (`InitiateAuth` then
   * `RespondToAuthChallenge` with `PASSWORD_VERIFIER`) for one username and
   * password. Resolves to tokens on immediate success, or a challenge (e.g.
   * MFA) that must be answered via `respondToSoftwareTokenMfaChallenge` /
   * `respondToSmsMfaChallenge`.
   */
  authenticate(params: { username: string; password: string }): Promise<CognitoAuthResult>;

  respondToSoftwareTokenMfaChallenge(params: {
    username: string;
    session: string;
    code: string;
  }): Promise<CognitoAuthResult>;

  respondToSmsMfaChallenge(params: {
    username: string;
    session: string;
    code: string;
  }): Promise<CognitoAuthResult>;

  /** `REFRESH_TOKEN_AUTH`. */
  renewAccessToken(params: {
    username: string;
    refreshToken: string;
  }): Promise<CognitoTokens>;

  getUser(params: { accessToken: string }): Promise<CognitoUserInfo>;

  /** Returns the shared TOTP secret to load into an authenticator app. */
  associateSoftwareToken(params: { accessToken: string }): Promise<{ secretCode: string }>;

  verifySoftwareToken(params: {
    accessToken: string;
    code: string;
    deviceName: string;
  }): Promise<{ status: string }>;

  setUserMfaPreference(params: {
    accessToken: string;
    smsMfa: boolean;
    softwareTokenMfa: boolean;
    preferred: string | undefined;
  }): Promise<void>;

  changePassword(params: {
    accessToken: string;
    previousPassword: string;
    proposedPassword: string;
  }): Promise<void>;

  /** Returns a human-readable delivery destination, or `""` if unreported. */
  forgotPassword(params: { username: string }): Promise<{ destination: string }>;

  confirmForgotPassword(params: {
    username: string;
    code: string;
    newPassword: string;
  }): Promise<void>;
}

export function createCognitoAdapter(options: CognitoAdapterOptions): CognitoAdapter {
  throw new Error("TODO(A6)");
}
