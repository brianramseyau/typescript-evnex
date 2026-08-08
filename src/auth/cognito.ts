/**
 * Narrow Cognito adapter — the `pycognito` surface used by `evnex/auth.py`,
 * ported per PLAN.md §3.1 / §3.2 onto `@aws-sdk/client-cognito-identity-provider`.
 *
 * Deliberately the only module that knows how tokens are obtained. It leaks
 * no `@aws-sdk/*` types past this file — every exported signature here uses
 * only plain data — which is what makes the §8 risk-1 escape hatch cheap: if
 * live SRP ever needs to fall back to `amazon-cognito-identity-js`, only this
 * file changes. That swap would additionally need a small in-memory
 * `ICognitoStorage` shim, since that library defaults to `localStorage`,
 * which does not exist server-side (PLAN.md §10.7).
 *
 * Uses A5's `createSrpClient` for the SRP handshake inside `authenticate`.
 * SDK errors are mapped per PLAN.md §3.2 into `CognitoError`, carrying the
 * Cognito exception `name` and `message` verbatim; callers (session.ts /
 * account.ts) do their own further, call-site-dependent mapping to the
 * `Evnex*Error` hierarchy from that `{ name, message }` — this module does
 * not flatten it.
 *
 * Two conditions are the exception to that rule, because Python's
 * `pycognito` surfaces them as actual exceptions rather than error codes,
 * and this module restores that "exception, not data" shape rather than
 * pushing SDK-specific string sentinels downstream:
 *  - `NEW_PASSWORD_REQUIRED` (`ChallengeName`, not a `ClientError` in SDK
 *    v3 — PLAN.md §3.4) throws `PasswordChangeRequiredError` directly.
 *  - `DEVICE_SRP_AUTH` (Cognito device tracking, PLAN.md §3.4 / §8 risk 2,
 *    not implemented here) throws `EvnexAuthError` directly, naming the
 *    limitation.
 * Both are therefore *not* `CognitoError`s; callers should let them
 * propagate rather than trying to re-map them by name.
 */

import {
  AssociateSoftwareTokenCommand,
  ChangePasswordCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ForgotPasswordCommand,
  GetUserCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SetUserMFAPreferenceCommand,
  VerifySoftwareTokenCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type {
  InitiateAuthCommandOutput,
  RespondToAuthChallengeCommandOutput,
} from "@aws-sdk/client-cognito-identity-provider";

import { EvnexAuthError, EvnexConfigurationError, PasswordChangeRequiredError } from "../errors.js";
import { createSrpClient } from "./srp.js";

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
  }
}

export interface CognitoAdapterOptions {
  userPoolId: string;
  clientId: string;
}

/**
 * The minimal shape of the AWS SDK's own `requestHandler` hook (the same
 * seam every generated client accepts as `{ requestHandler }`), redeclared
 * here rather than imported from `@smithy/types` / `@aws-sdk/*` so this
 * stays a self-typed hook and not an SDK type in this module's exports.
 *
 * Test-only: lets `createCognitoAdapter`'s tests stub the SDK's transport
 * directly (PLAN.md §5 A6 acceptance — "stubbing the SDK's own
 * `requestHandler`, first-party, no mocking library") instead of hitting
 * the network. Production callers never pass this.
 */
export interface CognitoTestTransport {
  handle(request: unknown): Promise<{
    response: { statusCode: number; headers?: Record<string, string>; body?: unknown };
  }>;
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

/** `ap-southeast-2_zWnqo6ASv` -> `ap-southeast-2` (PLAN.md §3.1). */
function regionFromPoolId(userPoolId: string): string {
  const separatorIndex = userPoolId.indexOf("_");
  if (separatorIndex === -1) {
    throw new EvnexConfigurationError(
      `Not a valid Cognito user pool id (expected "<region>_<pool-id>"): ${userPoolId}`,
    );
  }
  return userPoolId.slice(0, separatorIndex);
}

/**
 * Wrap any error the SDK throws as a `CognitoError`, preserving its name
 * and message verbatim (PLAN.md §3.2) so the caller can do its own
 * call-site-dependent mapping.
 */
// The AWS SDK always throws Error instances, even when its own
// requestHandler throws a non-Error value (`asSdkError` in
// @smithy/core/retry normalises it first). The `err instanceof Error`
// check below is therefore always true in practice; the whole function is
// marked unreachable-branch rather than picking apart which half, since
// this v8 coverage provider only ignores by line range, not by branch.
/* v8 ignore start -- see comment above: `err` is always an Error in practice */
function toCognitoError(err: unknown): CognitoError {
  if (err instanceof Error) {
    return new CognitoError(err.name, err.message, { cause: err });
  }
  return new CognitoError("UnknownError", String(err));
}
/* v8 ignore stop */

const SRP_CHALLENGE_NAME = "PASSWORD_VERIFIER";

interface SrpChallengeParameters {
  salt: string;
  srpB: string;
  secretBlock: string;
  userIdForSrp: string;
}

/**
 * Pull the SRP parameters Cognito returns from `InitiateAuth(USER_SRP_AUTH)`
 * out of its `PASSWORD_VERIFIER` challenge, or throw a `CognitoError` if the
 * response does not look like that (PLAN.md §3.3).
 */
function extractSrpChallengeParameters(response: InitiateAuthCommandOutput): SrpChallengeParameters {
  if (response.ChallengeName !== SRP_CHALLENGE_NAME) {
    throw new CognitoError(
      "UnexpectedChallenge",
      `Expected a ${SRP_CHALLENGE_NAME} challenge from InitiateAuth, got ${response.ChallengeName ?? "no challenge"}`,
    );
  }
  const parameters = response.ChallengeParameters;
  const salt = parameters?.["SALT"];
  const srpB = parameters?.["SRP_B"];
  const secretBlock = parameters?.["SECRET_BLOCK"];
  const userIdForSrp = parameters?.["USER_ID_FOR_SRP"];
  if (!salt || !srpB || !secretBlock || !userIdForSrp) {
    throw new CognitoError(
      "InvalidServerResponse",
      "Cognito's PASSWORD_VERIFIER challenge was missing required SRP parameters",
    );
  }
  return { salt, srpB, secretBlock, userIdForSrp };
}

/**
 * Convert a Cognito auth-challenge response (from `RespondToAuthChallenge`)
 * into plain `CognitoAuthResult` data — except for the two challenge types
 * that behave as exceptions in Python's `pycognito` (see the module
 * docstring), which are thrown directly instead of being handed back as a
 * generic challenge.
 */
function toAuthResult(response: RespondToAuthChallengeCommandOutput): CognitoAuthResult {
  const result = response.AuthenticationResult;
  if (result) {
    if (!result.AccessToken || !result.IdToken) {
      throw new CognitoError(
        "InvalidServerResponse",
        "Cognito returned an authentication result without an access or id token",
      );
    }
    const tokens: CognitoTokens = { accessToken: result.AccessToken, idToken: result.IdToken };
    if (result.RefreshToken) {
      tokens.refreshToken = result.RefreshToken;
    }
    return { kind: "tokens", tokens };
  }

  const challengeName = response.ChallengeName;
  if (!challengeName) {
    throw new CognitoError(
      "InvalidServerResponse",
      "Cognito returned neither an authentication result nor a challenge",
    );
  }
  // PLAN.md §3.4: not a ClientError in SDK v3 — pycognito's
  // ForceChangePasswordException has no direct equivalent, so it must be
  // detected here explicitly.
  if (challengeName === "NEW_PASSWORD_REQUIRED") {
    throw new PasswordChangeRequiredError(
      "Cognito requires a password change before this account can sign in",
    );
  }
  // PLAN.md §3.4 / §8 risk 2: device tracking, which this port does not
  // implement. Raise a clear, named error rather than returning an opaque
  // challenge the caller has no way to answer.
  if (challengeName === "DEVICE_SRP_AUTH") {
    throw new EvnexAuthError(
      "Cognito requested a DEVICE_SRP_AUTH challenge: device tracking is enabled on this " +
        "user pool, and this port does not implement Cognito device authentication " +
        "(see PLAN.md §3.4, §8 risk 2). Disable device tracking on the pool, or extend " +
        "src/auth/cognito.ts to support it.",
    );
  }
  const session = response.Session;
  if (!session) {
    throw new CognitoError(
      "InvalidServerResponse",
      "Cognito returned a challenge without a session",
    );
  }
  return {
    kind: "challenge",
    challenge: {
      challengeName,
      session,
      parameters: response.ChallengeParameters ?? {},
    },
  };
}

export function createCognitoAdapter(
  options: CognitoAdapterOptions,
  testTransport?: CognitoTestTransport,
): CognitoAdapter {
  const region = regionFromPoolId(options.userPoolId);
  const poolName = options.userPoolId.slice(options.userPoolId.indexOf("_") + 1);

  const client = new CognitoIdentityProviderClient({
    region,
    ...(testTransport ? { requestHandler: testTransport } : {}),
    // None of the eleven operations below ever need AWS SigV4 request
    // signing (PLAN.md §0.1) — they are either unauthenticated
    // (InitiateAuth, RespondToAuthChallenge, ForgotPassword,
    // ConfirmForgotPassword) or authenticated with the user's own Cognito
    // access token (GetUser, ChangePassword, AssociateSoftwareToken,
    // VerifySoftwareToken, SetUserMFAPreference). Supplying static
    // placeholder credentials means client construction and every call
    // below never depends on, or waits on, the ambient AWS credential
    // provider chain (env vars, shared config files, EC2/ECS instance
    // metadata, ...) — which is exactly why `amazon-cognito-identity-js`
    // can do the same thing from a browser holding no AWS credentials at
    // all. This process's environment happens to have real-looking
    // AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY set for unrelated reasons;
    // this client must not pick those up, and this option is what
    // guarantees that.
    credentials: { accessKeyId: "unused", secretAccessKey: "unused" },
  });

  return {
    async authenticate({ username, password }) {
      const srp = createSrpClient(poolName);
      let initiateResponse: InitiateAuthCommandOutput;
      try {
        initiateResponse = await client.send(
          new InitiateAuthCommand({
            AuthFlow: "USER_SRP_AUTH",
            ClientId: options.clientId,
            AuthParameters: { USERNAME: username, SRP_A: srp.srpA },
          }),
        );
      } catch (err) {
        throw toCognitoError(err);
      }

      const { salt, srpB, secretBlock, userIdForSrp } = extractSrpChallengeParameters(initiateResponse);
      const session = initiateResponse.Session;
      if (!session) {
        throw new CognitoError(
          "InvalidServerResponse",
          "Cognito's PASSWORD_VERIFIER challenge was missing a session",
        );
      }

      const { signature, timestamp } = srp.computeChallengeResponse({
        srpB,
        salt,
        secretBlock,
        username: userIdForSrp,
        password,
      });

      let respondResponse: RespondToAuthChallengeCommandOutput;
      try {
        respondResponse = await client.send(
          new RespondToAuthChallengeCommand({
            ChallengeName: SRP_CHALLENGE_NAME,
            ClientId: options.clientId,
            Session: session,
            ChallengeResponses: {
              USERNAME: userIdForSrp,
              PASSWORD_CLAIM_SECRET_BLOCK: secretBlock,
              PASSWORD_CLAIM_SIGNATURE: signature,
              TIMESTAMP: timestamp,
            },
          }),
        );
      } catch (err) {
        throw toCognitoError(err);
      }
      return toAuthResult(respondResponse);
    },

    async respondToSoftwareTokenMfaChallenge({ username, session, code }) {
      let response: RespondToAuthChallengeCommandOutput;
      try {
        response = await client.send(
          new RespondToAuthChallengeCommand({
            ChallengeName: "SOFTWARE_TOKEN_MFA",
            ClientId: options.clientId,
            Session: session,
            ChallengeResponses: { USERNAME: username, SOFTWARE_TOKEN_MFA_CODE: code },
          }),
        );
      } catch (err) {
        throw toCognitoError(err);
      }
      return toAuthResult(response);
    },

    async respondToSmsMfaChallenge({ username, session, code }) {
      let response: RespondToAuthChallengeCommandOutput;
      try {
        response = await client.send(
          new RespondToAuthChallengeCommand({
            ChallengeName: "SMS_MFA",
            ClientId: options.clientId,
            Session: session,
            ChallengeResponses: { USERNAME: username, SMS_MFA_CODE: code },
          }),
        );
      } catch (err) {
        throw toCognitoError(err);
      }
      return toAuthResult(response);
    },

    async renewAccessToken({ username, refreshToken }) {
      let response: InitiateAuthCommandOutput;
      try {
        response = await client.send(
          new InitiateAuthCommand({
            AuthFlow: "REFRESH_TOKEN_AUTH",
            ClientId: options.clientId,
            AuthParameters: { USERNAME: username, REFRESH_TOKEN: refreshToken },
          }),
        );
      } catch (err) {
        throw toCognitoError(err);
      }
      const result = response.AuthenticationResult;
      if (!result?.AccessToken || !result.IdToken) {
        throw new CognitoError("InvalidServerResponse", "Cognito did not return refreshed tokens");
      }
      const tokens: CognitoTokens = { accessToken: result.AccessToken, idToken: result.IdToken };
      if (result.RefreshToken) {
        tokens.refreshToken = result.RefreshToken;
      }
      return tokens;
    },

    async getUser({ accessToken }) {
      try {
        const response = await client.send(new GetUserCommand({ AccessToken: accessToken }));
        return {
          mfaSettingList: response.UserMFASettingList ?? [],
          preferredMfaSetting: response.PreferredMfaSetting,
        };
      } catch (err) {
        throw toCognitoError(err);
      }
    },

    async associateSoftwareToken({ accessToken }) {
      let response;
      try {
        response = await client.send(new AssociateSoftwareTokenCommand({ AccessToken: accessToken }));
      } catch (err) {
        throw toCognitoError(err);
      }
      if (!response.SecretCode) {
        throw new CognitoError("InvalidServerResponse", "Cognito did not return a TOTP secret");
      }
      return { secretCode: response.SecretCode };
    },

    async verifySoftwareToken({ accessToken, code, deviceName }) {
      try {
        const response = await client.send(
          new VerifySoftwareTokenCommand({
            AccessToken: accessToken,
            UserCode: code,
            FriendlyDeviceName: deviceName,
          }),
        );
        return { status: response.Status ?? "" };
      } catch (err) {
        throw toCognitoError(err);
      }
    },

    async setUserMfaPreference({ accessToken, smsMfa, softwareTokenMfa, preferred }) {
      try {
        await client.send(
          new SetUserMFAPreferenceCommand({
            AccessToken: accessToken,
            SMSMfaSettings: { Enabled: smsMfa, PreferredMfa: preferred === "SMS" },
            SoftwareTokenMfaSettings: {
              Enabled: softwareTokenMfa,
              PreferredMfa: preferred === "SOFTWARE_TOKEN",
            },
          }),
        );
      } catch (err) {
        throw toCognitoError(err);
      }
    },

    async changePassword({ accessToken, previousPassword, proposedPassword }) {
      try {
        await client.send(
          new ChangePasswordCommand({
            AccessToken: accessToken,
            PreviousPassword: previousPassword,
            ProposedPassword: proposedPassword,
          }),
        );
      } catch (err) {
        throw toCognitoError(err);
      }
    },

    async forgotPassword({ username }) {
      try {
        const response = await client.send(
          new ForgotPasswordCommand({ ClientId: options.clientId, Username: username }),
        );
        return { destination: response.CodeDeliveryDetails?.Destination ?? "" };
      } catch (err) {
        throw toCognitoError(err);
      }
    },

    async confirmForgotPassword({ username, code, newPassword }) {
      try {
        await client.send(
          new ConfirmForgotPasswordCommand({
            ClientId: options.clientId,
            Username: username,
            ConfirmationCode: code,
            Password: newPassword,
          }),
        );
      } catch (err) {
        throw toCognitoError(err);
      }
    },
  };
}
