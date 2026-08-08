/**
 * Tests for src/auth/cognito.ts (PLAN.md §5 A6).
 *
 * Every Cognito operation is exercised by stubbing the AWS SDK's own
 * `requestHandler` — first-party, no mocking library — via
 * `createCognitoAdapter`'s test-only second parameter
 * (`CognitoTestTransport`). SRP maths (A5's `src/auth/srp.ts`) is mocked:
 * A6 codes against A5's stub signature and must not wait for it to land.
 */

import { Readable } from "node:stream";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("../../src/auth/srp.js", () => {
  const computeChallengeResponse = vi.fn(
    (_params: {
      srpB: string;
      salt: string;
      secretBlock: string;
      username: string;
      password: string;
      timestamp?: Date;
    }) => ({
      signature: "stub-signature",
      timestamp: "Tue Jan 2 15:04:05 UTC 2024",
    }),
  );
  const createSrpClient = vi.fn((poolName: string) => ({
    srpA: `stub-srp-a-for-${poolName}`,
    computeChallengeResponse,
  }));
  return { createSrpClient, __computeChallengeResponse: computeChallengeResponse };
});

import type {
  CognitoAdapter,
  CognitoAdapterOptions,
  CognitoAuthResult,
  CognitoChallenge,
  CognitoTestTransport,
  CognitoTokens,
  CognitoUserInfo,
} from "../../src/auth/cognito.js";
import { CognitoError, createCognitoAdapter } from "../../src/auth/cognito.js";
import { createSrpClient } from "../../src/auth/srp.js";
import {
  EvnexAuthError,
  EvnexConfigurationError,
  PasswordChangeRequiredError,
} from "../../src/errors.js";

const POOL_ID = "ap-southeast-2_zWnqo6ASv";
const CLIENT_ID = "test-client-id";

interface CapturedHttpRequest {
  hostname: string;
  path: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

interface CapturedRequest {
  hostname: string;
  path: string;
  target: string | undefined;
  body: unknown;
}

interface StubResponseSpec {
  statusCode: number;
  body: unknown;
}

/**
 * A minimal `CognitoTestTransport` that answers a fixed sequence of
 * responses (one per `client.send()` call the adapter makes) and records
 * every request it saw, decoded, for assertions.
 */
function createStubTransport(responses: StubResponseSpec[]): {
  transport: CognitoTestTransport;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  let index = 0;
  const transport: CognitoTestTransport = {
    handle: async (request: unknown) => {
      const req = request as CapturedHttpRequest;
      requests.push({
        hostname: req.hostname,
        path: req.path,
        target: req.headers["x-amz-target"],
        body: JSON.parse(Buffer.from(req.body).toString("utf8")) as unknown,
      });
      const spec = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (!spec) {
        throw new Error("test bug: no stub response configured");
      }
      return {
        response: {
          statusCode: spec.statusCode,
          headers: { "content-type": "application/x-amz-json-1.1" },
          body: Readable.from([Buffer.from(JSON.stringify(spec.body))]),
        },
      };
    },
  };
  return { transport, requests };
}

function makeAdapter(responses: StubResponseSpec[]): {
  adapter: CognitoAdapter;
  requests: CapturedRequest[];
} {
  const { transport, requests } = createStubTransport(responses);
  const adapter = createCognitoAdapter({ userPoolId: POOL_ID, clientId: CLIENT_ID }, transport);
  return { adapter, requests };
}

function clientError(name: string, message: string): StubResponseSpec {
  return { statusCode: 400, body: { __type: name, message } };
}

describe("createCognitoAdapter", () => {
  it("derives the region from the user pool id and posts to its regional endpoint", async () => {
    const { adapter, requests } = makeAdapter([
      { statusCode: 200, body: { CodeDeliveryDetails: { Destination: "a***@example.com" } } },
    ]);
    await adapter.forgotPassword({ username: "someone" });
    expect(requests[0]?.hostname).toBe("cognito-idp.ap-southeast-2.amazonaws.com");
    expect(requests[0]?.target).toBe("AWSCognitoIdentityProviderService.ForgotPassword");
  });

  it("constructs with no test transport (the production call shape used by auth/index.ts)", () => {
    const adapter = createCognitoAdapter({ userPoolId: POOL_ID, clientId: CLIENT_ID });
    expect(typeof adapter.authenticate).toBe("function");
    expect(typeof adapter.confirmForgotPassword).toBe("function");
  });

  it("rejects a user pool id with no region separator", () => {
    expect(() => createCognitoAdapter({ userPoolId: "not-a-pool-id", clientId: CLIENT_ID })).toThrow(
      EvnexConfigurationError,
    );
  });

  it("constructs and completes a real call with no ambient AWS credentials", async () => {
    const originalAccessKey = process.env["AWS_ACCESS_KEY_ID"];
    const originalSecretKey = process.env["AWS_SECRET_ACCESS_KEY"];
    delete process.env["AWS_ACCESS_KEY_ID"];
    delete process.env["AWS_SECRET_ACCESS_KEY"];
    try {
      const { adapter } = makeAdapter([
        { statusCode: 200, body: { CodeDeliveryDetails: { Destination: "a***@example.com" } } },
      ]);
      const result = await adapter.forgotPassword({ username: "someone" });
      expect(result.destination).toBe("a***@example.com");
    } finally {
      if (originalAccessKey === undefined) {
        delete process.env["AWS_ACCESS_KEY_ID"];
      } else {
        process.env["AWS_ACCESS_KEY_ID"] = originalAccessKey;
      }
      if (originalSecretKey === undefined) {
        delete process.env["AWS_SECRET_ACCESS_KEY"];
      } else {
        process.env["AWS_SECRET_ACCESS_KEY"] = originalSecretKey;
      }
    }
  });
});

describe("authenticate", () => {
  it("performs USER_SRP_AUTH then PASSWORD_VERIFIER and returns tokens (with refresh token)", async () => {
    const { adapter, requests } = makeAdapter([
      {
        statusCode: 200,
        body: {
          ChallengeName: "PASSWORD_VERIFIER",
          Session: "session-1",
          ChallengeParameters: {
            SALT: "salt-hex",
            SRP_B: "b-hex",
            SECRET_BLOCK: "secret-block",
            USER_ID_FOR_SRP: "user-id-for-srp",
          },
        },
      },
      {
        statusCode: 200,
        body: {
          AuthenticationResult: {
            AccessToken: "access-1",
            IdToken: "id-1",
            RefreshToken: "refresh-1",
          },
        },
      },
    ]);

    const result = await adapter.authenticate({ username: "alice", password: "hunter2" });

    expect(result).toEqual<CognitoAuthResult>({
      kind: "tokens",
      tokens: { accessToken: "access-1", idToken: "id-1", refreshToken: "refresh-1" },
    });

    expect(createSrpClient).toHaveBeenCalledWith("zWnqo6ASv");
    expect(requests[0]?.target).toBe("AWSCognitoIdentityProviderService.InitiateAuth");
    expect(requests[0]?.body).toMatchObject({
      AuthFlow: "USER_SRP_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: "alice", SRP_A: "stub-srp-a-for-zWnqo6ASv" },
    });
    expect(requests[1]?.target).toBe("AWSCognitoIdentityProviderService.RespondToAuthChallenge");
    expect(requests[1]?.body).toMatchObject({
      ChallengeName: "PASSWORD_VERIFIER",
      ClientId: CLIENT_ID,
      Session: "session-1",
      ChallengeResponses: {
        USERNAME: "user-id-for-srp",
        PASSWORD_CLAIM_SECRET_BLOCK: "secret-block",
        PASSWORD_CLAIM_SIGNATURE: "stub-signature",
        TIMESTAMP: "Tue Jan 2 15:04:05 UTC 2024",
      },
    });
  });

  it("returns tokens without a refresh token when Cognito omits it (rotation disabled)", async () => {
    const { adapter } = makeAdapter([
      {
        statusCode: 200,
        body: {
          ChallengeName: "PASSWORD_VERIFIER",
          Session: "s",
          ChallengeParameters: {
            SALT: "salt",
            SRP_B: "b",
            SECRET_BLOCK: "block",
            USER_ID_FOR_SRP: "uid",
          },
        },
      },
      { statusCode: 200, body: { AuthenticationResult: { AccessToken: "a", IdToken: "i" } } },
    ]);

    const result = await adapter.authenticate({ username: "alice", password: "p" });
    expect(result.kind).toBe("tokens");
    if (result.kind === "tokens") {
      expect(result.tokens.refreshToken).toBeUndefined();
      expect("refreshToken" in result.tokens).toBe(false);
    }
  });

  it("wraps a ClientError from InitiateAuth as a CognitoError with the SDK's name and message", async () => {
    const { adapter } = makeAdapter([
      clientError("NotAuthorizedException", "Incorrect username or password."),
    ]);
    const err = await adapter.authenticate({ username: "alice", password: "wrong" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("NotAuthorizedException");
    expect((err as CognitoError).message).toBe("Incorrect username or password.");
    expect((err as CognitoError).cause).toBeInstanceOf(Error);
  });

  it("throws CognitoError when InitiateAuth answers with an unexpected challenge", async () => {
    const { adapter } = makeAdapter([{ statusCode: 200, body: { ChallengeName: "SMS_MFA", Session: "s" } }]);
    const err = await adapter.authenticate({ username: "alice", password: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("UnexpectedChallenge");
    expect((err as CognitoError).message).toContain("SMS_MFA");
  });

  it("throws CognitoError when InitiateAuth answers with no challenge at all", async () => {
    const { adapter } = makeAdapter([{ statusCode: 200, body: {} }]);
    const err = await adapter.authenticate({ username: "alice", password: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("UnexpectedChallenge");
    expect((err as CognitoError).message).toContain("no challenge");
  });

  it.each(["SALT", "SRP_B", "SECRET_BLOCK", "USER_ID_FOR_SRP"])(
    "throws CognitoError when the PASSWORD_VERIFIER challenge is missing %s",
    async (missingKey) => {
      const parameters: Record<string, string> = {
        SALT: "salt",
        SRP_B: "b",
        SECRET_BLOCK: "block",
        USER_ID_FOR_SRP: "uid",
      };
      delete parameters[missingKey];
      const { adapter } = makeAdapter([
        { statusCode: 200, body: { ChallengeName: "PASSWORD_VERIFIER", Session: "s", ChallengeParameters: parameters } },
      ]);
      const err = await adapter.authenticate({ username: "alice", password: "p" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CognitoError);
      expect((err as CognitoError).name).toBe("InvalidServerResponse");
    },
  );

  it("throws CognitoError when the PASSWORD_VERIFIER challenge has no session", async () => {
    const { adapter } = makeAdapter([
      {
        statusCode: 200,
        body: {
          ChallengeName: "PASSWORD_VERIFIER",
          ChallengeParameters: { SALT: "s", SRP_B: "b", SECRET_BLOCK: "c", USER_ID_FOR_SRP: "u" },
        },
      },
    ]);
    const err = await adapter.authenticate({ username: "alice", password: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).message).toContain("session");
  });

  it("wraps a ClientError from RespondToAuthChallenge as a CognitoError", async () => {
    const { adapter } = makeAdapter([
      {
        statusCode: 200,
        body: {
          ChallengeName: "PASSWORD_VERIFIER",
          Session: "s",
          ChallengeParameters: { SALT: "s", SRP_B: "b", SECRET_BLOCK: "c", USER_ID_FOR_SRP: "u" },
        },
      },
      clientError("NotAuthorizedException", "Incorrect username or password."),
    ]);
    const err = await adapter.authenticate({ username: "alice", password: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("NotAuthorizedException");
  });

  it("throws PasswordChangeRequiredError directly on a NEW_PASSWORD_REQUIRED challenge (not a CognitoError)", async () => {
    const { adapter } = makeAdapter([
      {
        statusCode: 200,
        body: {
          ChallengeName: "PASSWORD_VERIFIER",
          Session: "s",
          ChallengeParameters: { SALT: "s", SRP_B: "b", SECRET_BLOCK: "c", USER_ID_FOR_SRP: "u" },
        },
      },
      { statusCode: 200, body: { ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "s2" } },
    ]);
    const err = await adapter.authenticate({ username: "alice", password: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PasswordChangeRequiredError);
    expect(err).not.toBeInstanceOf(CognitoError);
  });

  it("throws EvnexAuthError naming the limitation on a DEVICE_SRP_AUTH challenge (not a CognitoError)", async () => {
    const { adapter } = makeAdapter([
      {
        statusCode: 200,
        body: {
          ChallengeName: "PASSWORD_VERIFIER",
          Session: "s",
          ChallengeParameters: { SALT: "s", SRP_B: "b", SECRET_BLOCK: "c", USER_ID_FOR_SRP: "u" },
        },
      },
      { statusCode: 200, body: { ChallengeName: "DEVICE_SRP_AUTH", Session: "s2" } },
    ]);
    const err = await adapter.authenticate({ username: "alice", password: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvnexAuthError);
    expect(err).not.toBeInstanceOf(CognitoError);
    expect((err as Error).message).toMatch(/device tracking/i);
  });

  it("returns a generic MFA challenge as plain data, defaulting parameters to {} when absent", async () => {
    const { adapter } = makeAdapter([
      {
        statusCode: 200,
        body: {
          ChallengeName: "PASSWORD_VERIFIER",
          Session: "s",
          ChallengeParameters: { SALT: "s", SRP_B: "b", SECRET_BLOCK: "c", USER_ID_FOR_SRP: "u" },
        },
      },
      { statusCode: 200, body: { ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "session-mfa" } },
    ]);
    const result = await adapter.authenticate({ username: "alice", password: "p" });
    expect(result).toEqual<CognitoAuthResult>({
      kind: "challenge",
      challenge: { challengeName: "SOFTWARE_TOKEN_MFA", session: "session-mfa", parameters: {} },
    });
  });

  it("passes ChallengeParameters through on a generic challenge when present", async () => {
    const { adapter } = makeAdapter([
      {
        statusCode: 200,
        body: {
          ChallengeName: "PASSWORD_VERIFIER",
          Session: "s",
          ChallengeParameters: { SALT: "s", SRP_B: "b", SECRET_BLOCK: "c", USER_ID_FOR_SRP: "u" },
        },
      },
      {
        statusCode: 200,
        body: {
          ChallengeName: "SMS_MFA",
          Session: "session-sms",
          ChallengeParameters: { CODE_DELIVERY_DESTINATION: "+64…1234" },
        },
      },
    ]);
    const result = await adapter.authenticate({ username: "alice", password: "p" });
    expect(result).toEqual<CognitoAuthResult>({
      kind: "challenge",
      challenge: {
        challengeName: "SMS_MFA",
        session: "session-sms",
        parameters: { CODE_DELIVERY_DESTINATION: "+64…1234" },
      },
    });
  });

  it("throws CognitoError when a generic challenge response has no session", async () => {
    const { adapter } = makeAdapter([
      {
        statusCode: 200,
        body: {
          ChallengeName: "PASSWORD_VERIFIER",
          Session: "s",
          ChallengeParameters: { SALT: "s", SRP_B: "b", SECRET_BLOCK: "c", USER_ID_FOR_SRP: "u" },
        },
      },
      { statusCode: 200, body: { ChallengeName: "SOFTWARE_TOKEN_MFA" } },
    ]);
    const err = await adapter.authenticate({ username: "alice", password: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("InvalidServerResponse");
    expect((err as CognitoError).message).toContain("without a session");
  });

  it("throws CognitoError when the response has neither an authentication result nor a challenge", async () => {
    const { adapter } = makeAdapter([
      {
        statusCode: 200,
        body: {
          ChallengeName: "PASSWORD_VERIFIER",
          Session: "s",
          ChallengeParameters: { SALT: "s", SRP_B: "b", SECRET_BLOCK: "c", USER_ID_FOR_SRP: "u" },
        },
      },
      { statusCode: 200, body: {} },
    ]);
    const err = await adapter.authenticate({ username: "alice", password: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("InvalidServerResponse");
    expect((err as CognitoError).message).toContain("neither");
  });

  it("throws CognitoError when the authentication result is missing an access or id token", async () => {
    const { adapter } = makeAdapter([
      {
        statusCode: 200,
        body: {
          ChallengeName: "PASSWORD_VERIFIER",
          Session: "s",
          ChallengeParameters: { SALT: "s", SRP_B: "b", SECRET_BLOCK: "c", USER_ID_FOR_SRP: "u" },
        },
      },
      { statusCode: 200, body: { AuthenticationResult: { IdToken: "id-only" } } },
    ]);
    const err = await adapter.authenticate({ username: "alice", password: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("InvalidServerResponse");
  });
});

describe("respondToSoftwareTokenMfaChallenge", () => {
  it("sends SOFTWARE_TOKEN_MFA_CODE and returns tokens", async () => {
    const { adapter, requests } = makeAdapter([
      { statusCode: 200, body: { AuthenticationResult: { AccessToken: "a", IdToken: "i", RefreshToken: "r" } } },
    ]);
    const result = await adapter.respondToSoftwareTokenMfaChallenge({
      username: "alice",
      session: "sess",
      code: "123456",
    });
    expect(result).toEqual<CognitoAuthResult>({
      kind: "tokens",
      tokens: { accessToken: "a", idToken: "i", refreshToken: "r" },
    });
    expect(requests[0]?.body).toMatchObject({
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      Session: "sess",
      ChallengeResponses: { USERNAME: "alice", SOFTWARE_TOKEN_MFA_CODE: "123456" },
    });
  });

  it("wraps a rejected code as a CognitoError", async () => {
    const { adapter } = makeAdapter([clientError("CodeMismatchException", "Invalid code received.")]);
    const err = await adapter
      .respondToSoftwareTokenMfaChallenge({ username: "alice", session: "sess", code: "000000" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("CodeMismatchException");
  });
});

describe("respondToSmsMfaChallenge", () => {
  it("sends SMS_MFA_CODE and returns tokens", async () => {
    const { adapter, requests } = makeAdapter([
      { statusCode: 200, body: { AuthenticationResult: { AccessToken: "a", IdToken: "i" } } },
    ]);
    const result = await adapter.respondToSmsMfaChallenge({
      username: "alice",
      session: "sess",
      code: "654321",
    });
    expect(result.kind).toBe("tokens");
    expect(requests[0]?.body).toMatchObject({
      ChallengeName: "SMS_MFA",
      Session: "sess",
      ChallengeResponses: { USERNAME: "alice", SMS_MFA_CODE: "654321" },
    });
  });

  it("wraps an expired challenge as a CognitoError", async () => {
    const { adapter } = makeAdapter([clientError("ExpiredCodeException", "Session expired.")]);
    const err = await adapter
      .respondToSmsMfaChallenge({ username: "alice", session: "sess", code: "000000" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("ExpiredCodeException");
  });
});

describe("renewAccessToken", () => {
  it("performs REFRESH_TOKEN_AUTH and returns refreshed tokens (with a rotated refresh token)", async () => {
    const { adapter, requests } = makeAdapter([
      {
        statusCode: 200,
        body: { AuthenticationResult: { AccessToken: "a2", IdToken: "i2", RefreshToken: "r2" } },
      },
    ]);
    const tokens = await adapter.renewAccessToken({ username: "alice", refreshToken: "r1" });
    expect(tokens).toEqual<CognitoTokens>({ accessToken: "a2", idToken: "i2", refreshToken: "r2" });
    expect(requests[0]?.target).toBe("AWSCognitoIdentityProviderService.InitiateAuth");
    expect(requests[0]?.body).toMatchObject({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: "alice", REFRESH_TOKEN: "r1" },
    });
  });

  it("returns tokens without a refresh token when Cognito does not rotate it", async () => {
    const { adapter } = makeAdapter([
      { statusCode: 200, body: { AuthenticationResult: { AccessToken: "a2", IdToken: "i2" } } },
    ]);
    const tokens = await adapter.renewAccessToken({ username: "alice", refreshToken: "r1" });
    expect(tokens.refreshToken).toBeUndefined();
  });

  it("throws CognitoError when there is no authentication result at all", async () => {
    const { adapter } = makeAdapter([{ statusCode: 200, body: {} }]);
    const err = await adapter.renewAccessToken({ username: "alice", refreshToken: "r1" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("InvalidServerResponse");
  });

  it("throws CognitoError when the authentication result is missing the id token", async () => {
    const { adapter } = makeAdapter([
      { statusCode: 200, body: { AuthenticationResult: { AccessToken: "a2" } } },
    ]);
    const err = await adapter.renewAccessToken({ username: "alice", refreshToken: "r1" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
  });

  it("wraps a rejected refresh token as a CognitoError (caller maps to ReauthenticationRequiredError)", async () => {
    const { adapter } = makeAdapter([clientError("NotAuthorizedException", "Refresh Token has expired.")]);
    const err = await adapter.renewAccessToken({ username: "alice", refreshToken: "stale" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("NotAuthorizedException");
  });
});

describe("getUser", () => {
  it("reports enabled MFA methods and the preferred one", async () => {
    const { adapter, requests } = makeAdapter([
      {
        statusCode: 200,
        body: { UserMFASettingList: ["SOFTWARE_TOKEN_MFA", "SMS_MFA"], PreferredMfaSetting: "SOFTWARE_TOKEN_MFA" },
      },
    ]);
    const info = await adapter.getUser({ accessToken: "tok" });
    expect(info).toEqual<CognitoUserInfo>({
      mfaSettingList: ["SOFTWARE_TOKEN_MFA", "SMS_MFA"],
      preferredMfaSetting: "SOFTWARE_TOKEN_MFA",
    });
    expect(requests[0]?.target).toBe("AWSCognitoIdentityProviderService.GetUser");
    expect(requests[0]?.body).toMatchObject({ AccessToken: "tok" });
  });

  it("defaults to an empty list and undefined preference when MFA is unset", async () => {
    const { adapter } = makeAdapter([{ statusCode: 200, body: {} }]);
    const info = await adapter.getUser({ accessToken: "tok" });
    expect(info).toEqual<CognitoUserInfo>({ mfaSettingList: [], preferredMfaSetting: undefined });
  });

  it("wraps a rejected access token as a CognitoError", async () => {
    const { adapter } = makeAdapter([clientError("NotAuthorizedException", "Invalid Access Token")]);
    const err = await adapter.getUser({ accessToken: "bad" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("NotAuthorizedException");
  });
});

describe("associateSoftwareToken", () => {
  it("returns the shared TOTP secret", async () => {
    const { adapter, requests } = makeAdapter([{ statusCode: 200, body: { SecretCode: "JBSWY3DPEHPK3PXP" } }]);
    const result = await adapter.associateSoftwareToken({ accessToken: "tok" });
    expect(result).toEqual({ secretCode: "JBSWY3DPEHPK3PXP" });
    expect(requests[0]?.target).toBe("AWSCognitoIdentityProviderService.AssociateSoftwareToken");
  });

  it("throws CognitoError when Cognito does not return a secret", async () => {
    const { adapter } = makeAdapter([{ statusCode: 200, body: {} }]);
    const err = await adapter.associateSoftwareToken({ accessToken: "tok" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("InvalidServerResponse");
  });

  it("wraps a ClientError as a CognitoError", async () => {
    const { adapter } = makeAdapter([clientError("NotAuthorizedException", "Invalid Access Token")]);
    const err = await adapter.associateSoftwareToken({ accessToken: "bad" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
  });
});

describe("verifySoftwareToken", () => {
  it("returns the verification status", async () => {
    const { adapter, requests } = makeAdapter([{ statusCode: 200, body: { Status: "SUCCESS" } }]);
    const result = await adapter.verifySoftwareToken({
      accessToken: "tok",
      code: "123456",
      deviceName: "my-phone",
    });
    expect(result).toEqual({ status: "SUCCESS" });
    expect(requests[0]?.body).toMatchObject({
      AccessToken: "tok",
      UserCode: "123456",
      FriendlyDeviceName: "my-phone",
    });
  });

  it("defaults status to an empty string when Cognito omits it", async () => {
    const { adapter } = makeAdapter([{ statusCode: 200, body: {} }]);
    const result = await adapter.verifySoftwareToken({ accessToken: "tok", code: "123456", deviceName: "" });
    expect(result).toEqual({ status: "" });
  });

  it("wraps a rejected code as a CognitoError (caller maps to InvalidChallengeResponseError)", async () => {
    const { adapter } = makeAdapter([clientError("CodeMismatchException", "Invalid code received.")]);
    const err = await adapter
      .verifySoftwareToken({ accessToken: "tok", code: "000000", deviceName: "" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("CodeMismatchException");
  });
});

describe("setUserMfaPreference", () => {
  it("enables software token MFA as preferred", async () => {
    const { adapter, requests } = makeAdapter([{ statusCode: 200, body: {} }]);
    await adapter.setUserMfaPreference({
      accessToken: "tok",
      smsMfa: false,
      softwareTokenMfa: true,
      preferred: "SOFTWARE_TOKEN",
    });
    expect(requests[0]?.body).toMatchObject({
      SMSMfaSettings: { Enabled: false, PreferredMfa: false },
      SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
    });
  });

  it("enables SMS MFA as preferred", async () => {
    const { adapter, requests } = makeAdapter([{ statusCode: 200, body: {} }]);
    await adapter.setUserMfaPreference({
      accessToken: "tok",
      smsMfa: true,
      softwareTokenMfa: false,
      preferred: "SMS",
    });
    expect(requests[0]?.body).toMatchObject({
      SMSMfaSettings: { Enabled: true, PreferredMfa: true },
      SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
    });
  });

  it("disables MFA entirely with no preference", async () => {
    const { adapter, requests } = makeAdapter([{ statusCode: 200, body: {} }]);
    await adapter.setUserMfaPreference({
      accessToken: "tok",
      smsMfa: false,
      softwareTokenMfa: false,
      preferred: undefined,
    });
    expect(requests[0]?.body).toMatchObject({
      SMSMfaSettings: { Enabled: false, PreferredMfa: false },
      SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
    });
  });

  it("wraps a ClientError as a CognitoError", async () => {
    const { adapter } = makeAdapter([clientError("NotAuthorizedException", "Invalid Access Token")]);
    const err = await adapter
      .setUserMfaPreference({ accessToken: "bad", smsMfa: false, softwareTokenMfa: false, preferred: undefined })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
  });
});

describe("changePassword", () => {
  it("sends the previous and proposed password", async () => {
    const { adapter, requests } = makeAdapter([{ statusCode: 200, body: {} }]);
    await adapter.changePassword({ accessToken: "tok", previousPassword: "old", proposedPassword: "new" });
    expect(requests[0]?.body).toMatchObject({
      AccessToken: "tok",
      PreviousPassword: "old",
      ProposedPassword: "new",
    });
  });

  it("wraps a rejected current password as a CognitoError (caller maps to InvalidCredentialsError)", async () => {
    const { adapter } = makeAdapter([clientError("NotAuthorizedException", "Incorrect username or password.")]);
    const err = await adapter
      .changePassword({ accessToken: "tok", previousPassword: "wrong", proposedPassword: "new" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("NotAuthorizedException");
  });
});

describe("forgotPassword", () => {
  it("returns the delivery destination", async () => {
    const { adapter, requests } = makeAdapter([
      { statusCode: 200, body: { CodeDeliveryDetails: { Destination: "a***@example.com" } } },
    ]);
    const result = await adapter.forgotPassword({ username: "alice" });
    expect(result).toEqual({ destination: "a***@example.com" });
    expect(requests[0]?.body).toMatchObject({ ClientId: CLIENT_ID, Username: "alice" });
  });

  it("returns an empty string when Cognito reports no delivery destination", async () => {
    const { adapter } = makeAdapter([{ statusCode: 200, body: {} }]);
    const result = await adapter.forgotPassword({ username: "alice" });
    expect(result).toEqual({ destination: "" });
  });

  it("wraps a ClientError as a CognitoError", async () => {
    const { adapter } = makeAdapter([clientError("LimitExceededException", "Attempt limit exceeded")]);
    const err = await adapter.forgotPassword({ username: "alice" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("LimitExceededException");
  });
});

describe("confirmForgotPassword", () => {
  it("sends the confirmation code and new password", async () => {
    const { adapter, requests } = makeAdapter([{ statusCode: 200, body: {} }]);
    await adapter.confirmForgotPassword({ username: "alice", code: "123456", newPassword: "new-pw" });
    expect(requests[0]?.body).toMatchObject({
      ClientId: CLIENT_ID,
      Username: "alice",
      ConfirmationCode: "123456",
      Password: "new-pw",
    });
  });

  it("wraps a mismatched code as a CognitoError (caller maps to InvalidChallengeResponseError)", async () => {
    const { adapter } = makeAdapter([clientError("CodeMismatchException", "Invalid code received.")]);
    const err = await adapter
      .confirmForgotPassword({ username: "alice", code: "000000", newPassword: "new-pw" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("CodeMismatchException");
  });

  it("wraps an expired code as a CognitoError (caller maps to ChallengeExpiredError)", async () => {
    const { adapter } = makeAdapter([clientError("ExpiredCodeException", "Invalid code provided, please request a code again.")]);
    const err = await adapter
      .confirmForgotPassword({ username: "alice", code: "000000", newPassword: "new-pw" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("ExpiredCodeException");
  });
});

describe("CognitoError", () => {
  it("carries the Cognito exception name as its own name, and the message/cause verbatim", () => {
    const cause = new Error("wire error");
    const err = new CognitoError("SomeException", "Something went wrong", { cause });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SomeException");
    expect(err.message).toBe("Something went wrong");
    expect(err.cause).toBe(cause);
  });
});

describe("public surface leaks no @aws-sdk/* types", () => {
  it("CognitoTokens is exactly { accessToken, idToken, refreshToken? }", () => {
    expectTypeOf<CognitoTokens>().toEqualTypeOf<{
      accessToken: string;
      idToken: string;
      refreshToken?: string;
    }>();
  });

  it("CognitoChallenge is exactly { challengeName, session, parameters }", () => {
    expectTypeOf<CognitoChallenge>().toEqualTypeOf<{
      challengeName: string;
      session: string;
      parameters: Record<string, string>;
    }>();
  });

  it("CognitoUserInfo is exactly { mfaSettingList, preferredMfaSetting }", () => {
    expectTypeOf<CognitoUserInfo>().toEqualTypeOf<{
      mfaSettingList: readonly string[];
      preferredMfaSetting: string | undefined;
    }>();
  });

  it("CognitoAuthResult is exactly the tokens/challenge union", () => {
    expectTypeOf<CognitoAuthResult>().toEqualTypeOf<
      { kind: "tokens"; tokens: CognitoTokens } | { kind: "challenge"; challenge: CognitoChallenge }
    >();
  });

  it("every CognitoAdapter method resolves to plain data, not an SDK response type", () => {
    expectTypeOf<ReturnType<CognitoAdapter["authenticate"]>>().toEqualTypeOf<Promise<CognitoAuthResult>>();
    expectTypeOf<ReturnType<CognitoAdapter["respondToSoftwareTokenMfaChallenge"]>>().toEqualTypeOf<
      Promise<CognitoAuthResult>
    >();
    expectTypeOf<ReturnType<CognitoAdapter["respondToSmsMfaChallenge"]>>().toEqualTypeOf<
      Promise<CognitoAuthResult>
    >();
    expectTypeOf<ReturnType<CognitoAdapter["renewAccessToken"]>>().toEqualTypeOf<Promise<CognitoTokens>>();
    expectTypeOf<ReturnType<CognitoAdapter["getUser"]>>().toEqualTypeOf<Promise<CognitoUserInfo>>();
    expectTypeOf<ReturnType<CognitoAdapter["associateSoftwareToken"]>>().toEqualTypeOf<
      Promise<{ secretCode: string }>
    >();
    expectTypeOf<ReturnType<CognitoAdapter["verifySoftwareToken"]>>().toEqualTypeOf<Promise<{ status: string }>>();
    expectTypeOf<ReturnType<CognitoAdapter["setUserMfaPreference"]>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<ReturnType<CognitoAdapter["changePassword"]>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<ReturnType<CognitoAdapter["forgotPassword"]>>().toEqualTypeOf<Promise<{ destination: string }>>();
    expectTypeOf<ReturnType<CognitoAdapter["confirmForgotPassword"]>>().toEqualTypeOf<Promise<void>>();
  });

  it("createCognitoAdapter takes CognitoAdapterOptions and returns exactly CognitoAdapter", () => {
    // `toEqualTypeOf` is a structural *equality* check (not mere
    // assignability): if any field above had an AWS SDK response type
    // folded into it — e.g. pulling `AuthenticationResultType` in as-is
    // instead of the hand-written `CognitoTokens` literal — these
    // assertions would fail to compile, because SDK output types carry
    // extra optional fields (`ExpiresIn`, `TokenType`,
    // `NewDeviceMetadata`, `$metadata`, ...) these exact shapes have no
    // room for. That is the proof this module's exports are self-typed.
    expectTypeOf(createCognitoAdapter).parameter(0).toEqualTypeOf<CognitoAdapterOptions>();
    expectTypeOf(createCognitoAdapter).returns.toEqualTypeOf<CognitoAdapter>();
  });
});
