/**
 * Tests for `src/auth/account.ts` — mirrors python-evnex's
 * `tests/test_auth.py::TestMfaManagement` and `::TestPasswordManagement`,
 * plus original coverage for behaviour this port added (PLAN.md §5 B2):
 * the both-methods-enabled-without-preference throw, and the token
 * rotation `changePassword` must capture rather than silently drop.
 *
 * `AccountOperations` depends on B1's `CognitoSession` through the narrow
 * `AccountSession` interface `account.ts` declares for exactly this purpose
 * (PLAN.md §5 B2: "depends on B1's `CognitoSession` interface only — code
 * against the F0 stub, do not wait"). `FakeAccountSession` below is a
 * lightweight, from-scratch implementation of that interface — not a mock of
 * B1's still-`TODO` `CognitoSession` class — so these tests run fully
 * offline and do not depend on B1's work landing first.
 */

import { describe, expect, it } from "vitest";
import { AccountOperations } from "../../src/auth/account.js";
import type { AccountSession } from "../../src/auth/account.js";
import { CognitoError } from "../../src/auth/cognito.js";
import type { ForceRefreshOptions } from "../../src/auth/session.js";
import { TokenSet } from "../../src/auth/tokens.js";
import {
  ChallengeExpiredError,
  EvnexAuthError,
  InvalidChallengeResponseError,
  InvalidCredentialsError,
  ReauthenticationRequiredError,
} from "../../src/errors.js";
import { FakeCognito } from "../support/fakeCognito.js";

// -- FakeAccountSession -------------------------------------------------------

/**
 * A from-scratch `AccountSession` rather than the real `CognitoSession`, so
 * these tests pin `account.ts` alone. `runUserPoolOp` just
 * invokes `operation` with the current access token — no lock, no retry —
 * since that recovery policy is B1's own module to test; this file only
 * needs to prove `account.ts` uses the session correctly.
 *
 * `forceRefresh` simulates what a real `CognitoSession.forceRefresh` does on
 * a genuine refresh: it publishes new tokens by replacing `.tokens`, so a
 * test can observe whether a later call (e.g. `changePassword`'s own
 * `runUserPoolOp`) actually sees the rotated access token, proving it was
 * used rather than silently dropped.
 */
class FakeAccountSession implements AccountSession {
  tokens: TokenSet | undefined;
  runUserPoolOpCalls = 0;
  forceRefreshCalls: ForceRefreshOptions[] = [];

  constructor(tokens?: TokenSet) {
    this.tokens = tokens;
  }

  runUserPoolOp = async <T>(operation: (accessToken: string) => Promise<T>): Promise<T> => {
    this.runUserPoolOpCalls += 1;
    const accessToken = this.tokens?.accessToken ?? "access-0";
    return operation(accessToken);
  };

  forceRefresh = async (options: ForceRefreshOptions): Promise<TokenSet> => {
    this.forceRefreshCalls.push(options);
    const serial = this.forceRefreshCalls.length;
    const rotated = new TokenSet({
      accessToken: `access-rotated-${serial}`,
      idToken: `id-rotated-${serial}`,
      refreshToken: this.tokens?.refreshToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    this.tokens = rotated;
    return rotated;
  };
}

function client_error(code: string, message = "nope"): CognitoError {
  return new CognitoError(code, message);
}

function makeAccount(options: { tokens?: TokenSet; cognito?: FakeCognito } = {}): {
  account: AccountOperations;
  session: FakeAccountSession;
  cognito: FakeCognito;
} {
  const session = new FakeAccountSession(options.tokens);
  const cognito = options.cognito ?? new FakeCognito();
  const account = new AccountOperations({ session, cognito });
  return { account, session, cognito };
}

const RESUMED_TOKENS = new TokenSet({
  accessToken: "access-0",
  idToken: "id-0",
  refreshToken: "refresh-0",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
});

// -- TestMfaManagement ---------------------------------------------------------

describe("AccountOperations.getMfaStatus", () => {
  // Mirrors test_mfa_status.
  it("reports enabled methods and the preferred one", async () => {
    const { account } = makeAccount({ tokens: RESUMED_TOKENS });

    const status = await account.getMfaStatus();

    expect(status.enabled).toEqual(["SOFTWARE_TOKEN_MFA"]);
    expect(status.preferred).toBe("SOFTWARE_TOKEN_MFA");
  });

  it("runs through the session's runUserPoolOp", async () => {
    const { account, session } = makeAccount({ tokens: RESUMED_TOKENS });

    await account.getMfaStatus();

    expect(session.runUserPoolOpCalls).toBe(1);
  });

  // Mirrors test_persistent_revocation_propagates_after_one_retry's error
  // surface (the retry itself is CognitoSession's own concern).
  it("maps any other Cognito error to EvnexAuthError", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    cognito.getUser = () => {
      throw client_error("NotAuthorizedException", "Access Token has been revoked");
    };

    await expect(account.getMfaStatus()).rejects.toThrow(EvnexAuthError);
    await expect(account.getMfaStatus()).rejects.toThrow(/revoked/);
  });

  // A non-CognitoError escaping the session (e.g. CognitoSession's own
  // refresh-and-retry giving up) must propagate unchanged, not be
  // re-wrapped as an EvnexAuthError.
  it("lets a non-CognitoError from the session propagate unchanged", async () => {
    const { account, session } = makeAccount({ tokens: RESUMED_TOKENS });
    session.runUserPoolOp = async () => {
      throw new ReauthenticationRequiredError("no usable session");
    };

    await expect(account.getMfaStatus()).rejects.toThrow(ReauthenticationRequiredError);
  });
});

describe("AccountOperations.beginTotpEnrollment / confirmTotpEnrollment", () => {
  // Mirrors test_totp_enrollment_flow.
  it("returns the shared secret and confirms with a trimmed code", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    let verifyCall: { accessToken: string; code: string; deviceName: string } | undefined;
    cognito.verifySoftwareToken = (params) => {
      verifyCall = params;
      return Promise.resolve({ status: "SUCCESS" });
    };

    const enrollment = await account.beginTotpEnrollment();
    expect(enrollment.secret).toBe("FAKESECRETBASE32");

    await account.confirmTotpEnrollment(" 123456 ", { deviceName: "New phone" });

    expect(verifyCall).toEqual({
      accessToken: "access-0",
      code: "123456",
      deviceName: "New phone",
    });
  });

  it("defaults the device name to an empty string", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    let deviceName: string | undefined;
    cognito.verifySoftwareToken = (params) => {
      deviceName = params.deviceName;
      return Promise.resolve({ status: "SUCCESS" });
    };

    await account.confirmTotpEnrollment("123456");

    expect(deviceName).toBe("");
  });

  it("maps a Cognito error during association to EvnexAuthError", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    cognito.associateSoftwareToken = () => {
      throw client_error("LimitExceededException", "Attempt limit exceeded");
    };

    await expect(account.beginTotpEnrollment()).rejects.toThrow(EvnexAuthError);
  });

  // Mirrors test_confirm_with_wrong_code.
  it("maps CodeMismatchException to InvalidChallengeResponseError", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    cognito.verifySoftwareToken = () => {
      throw client_error("CodeMismatchException", "Code mismatch");
    };

    await expect(account.confirmTotpEnrollment("000000")).rejects.toThrow(
      InvalidChallengeResponseError,
    );
  });

  it("maps EnableSoftwareTokenMFAException to InvalidChallengeResponseError", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    cognito.verifySoftwareToken = () => {
      throw client_error("EnableSoftwareTokenMFAException", "Code mismatch");
    };

    await expect(account.confirmTotpEnrollment("000000")).rejects.toThrow(
      InvalidChallengeResponseError,
    );
  });

  it("maps any other Cognito error to EvnexAuthError", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    cognito.verifySoftwareToken = () => {
      throw client_error("TooManyRequestsException", "Slow down");
    };

    await expect(account.confirmTotpEnrollment("123456")).rejects.toThrow(EvnexAuthError);
  });

  it("rejects when Cognito reports the code was not verified", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    cognito.verifySoftwareToken = () => Promise.resolve({ status: "ERROR" });

    await expect(account.confirmTotpEnrollment("123456")).rejects.toThrow(
      /not accepted/,
    );
    await expect(account.confirmTotpEnrollment("123456")).rejects.toThrow(
      InvalidChallengeResponseError,
    );
  });
});

describe("AccountOperations.setMfaPreference", () => {
  // Mirrors test_disable_mfa.
  it("disables MFA with both flags false (default, no arguments)", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    let call: unknown;
    cognito.setUserMfaPreference = (params) => {
      call = params;
      return Promise.resolve();
    };

    await account.setMfaPreference();

    expect(call).toEqual({
      accessToken: "access-0",
      smsMfa: false,
      softwareTokenMfa: false,
      preferred: undefined,
    });
  });

  // Mirrors test_single_method_is_preferred_automatically.
  it("infers SOFTWARE_TOKEN as preferred when only totp is enabled", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    let call: unknown;
    cognito.setUserMfaPreference = (params) => {
      call = params;
      return Promise.resolve();
    };

    await account.setMfaPreference({ totp: true });

    expect(call).toEqual({
      accessToken: "access-0",
      smsMfa: false,
      softwareTokenMfa: true,
      preferred: "SOFTWARE_TOKEN",
    });
  });

  it("infers SMS as preferred when only sms is enabled", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    let call: unknown;
    cognito.setUserMfaPreference = (params) => {
      call = params;
      return Promise.resolve();
    };

    await account.setMfaPreference({ sms: true });

    expect(call).toEqual({
      accessToken: "access-0",
      smsMfa: true,
      softwareTokenMfa: false,
      preferred: "SMS",
    });
  });

  // Mirrors test_both_methods_without_preferred_raises_valueerror.
  it("throws when both methods are enabled with no preferred given", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    let called = false;
    cognito.setUserMfaPreference = () => {
      called = true;
      return Promise.resolve();
    };

    await expect(account.setMfaPreference({ totp: true, sms: true })).rejects.toThrow(
      /preferred is required/,
    );

    // The misuse is caught by account.ts; Cognito is never reached.
    expect(called).toBe(false);
  });

  it("accepts an explicit preferred when both methods are enabled", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    let call: unknown;
    cognito.setUserMfaPreference = (params) => {
      call = params;
      return Promise.resolve();
    };

    await account.setMfaPreference({ totp: true, sms: true, preferred: "SMS" });

    expect(call).toEqual({
      accessToken: "access-0",
      smsMfa: true,
      softwareTokenMfa: true,
      preferred: "SMS",
    });
  });

  it("maps a Cognito error to EvnexAuthError", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    cognito.setUserMfaPreference = () => {
      throw client_error("InvalidParameterException", "Bad request");
    };

    await expect(account.setMfaPreference({ totp: true })).rejects.toThrow(EvnexAuthError);
  });
});

// -- TestPasswordManagement -----------------------------------------------------

describe("AccountOperations.changePassword", () => {
  // Mirrors test_change_password.
  it("changes the password using the current access token", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    let call: unknown;
    cognito.changePassword = (params) => {
      call = params;
      return Promise.resolve();
    };

    await account.changePassword("oldpass", "newpass");

    expect(call).toEqual({
      accessToken: "access-0",
      previousPassword: "oldpass",
      proposedPassword: "newpass",
    });
  });

  it("does not force a refresh when the session has no tokens yet", async () => {
    const { account, session } = makeAccount();

    await account.changePassword("oldpass", "newpass");

    expect(session.forceRefreshCalls).toEqual([]);
  });

  it("does not force a refresh when the access token has no known expiry", async () => {
    const tokens = new TokenSet({ accessToken: "access-0", idToken: "id-0" });
    const { account, session } = makeAccount({ tokens });

    await account.changePassword("oldpass", "newpass");

    expect(session.forceRefreshCalls).toEqual([]);
  });

  it("does not force a refresh when the access token has not expired", async () => {
    const { account, session } = makeAccount({ tokens: RESUMED_TOKENS });

    await account.changePassword("oldpass", "newpass");

    expect(session.forceRefreshCalls).toEqual([]);
  });

  // The token-rotation-capture case (PLAN.md §5 B2 acceptance): mirrors
  // pycognito's change_password running check_token(renew=True) before the
  // API call. Proves the rotated tokens are actually used for the call that
  // follows — not silently left unpublished.
  it("captures and publishes a token rotation when the access token has expired locally", async () => {
    const expiredTokens = new TokenSet({
      accessToken: "access-0",
      idToken: "id-0",
      refreshToken: "refresh-0",
      expiresAt: new Date(Date.now() - 1000),
    });
    const { account, session, cognito } = makeAccount({ tokens: expiredTokens });
    let call: { accessToken: string } | undefined;
    cognito.changePassword = (params) => {
      call = params;
      return Promise.resolve();
    };

    await account.changePassword("oldpass", "newpass");

    // The refresh was requested for exactly the stale token...
    expect(session.forceRefreshCalls).toEqual([{ staleAccessToken: "access-0" }]);
    // ...and the change-password call actually used the rotated token, not
    // the stale one: the rotation was published and consumed, not dropped.
    expect(call?.accessToken).toBe("access-rotated-1");
    expect(session.tokens?.accessToken).toBe("access-rotated-1");
  });

  // Mirrors test_change_password_wrong_current.
  it("maps NotAuthorizedException to InvalidCredentialsError", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    cognito.changePassword = () => {
      throw client_error("NotAuthorizedException", "Incorrect username or password.");
    };

    await expect(account.changePassword("wrongpass", "newpass")).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  // Mirrors test_change_password_invalid_new.
  it("maps any other Cognito error to EvnexAuthError", async () => {
    const { account, cognito } = makeAccount({ tokens: RESUMED_TOKENS });
    cognito.changePassword = () => {
      throw client_error("InvalidPasswordException", "Password does not conform to policy");
    };

    await expect(account.changePassword("oldpass", "weak")).rejects.toThrow(/conform/);
    await expect(account.changePassword("oldpass", "weak")).rejects.toThrow(EvnexAuthError);
  });
});

describe("AccountOperations.startPasswordReset", () => {
  // Mirrors test_start_password_reset_returns_destination.
  it("returns the masked delivery destination and needs no session", async () => {
    const session = new FakeAccountSession();
    const cognito = new FakeCognito();
    const account = new AccountOperations({ session, cognito });

    const destination = await account.startPasswordReset("user@example.com");

    expect(destination).toBe("b***@e***");
    expect(session.runUserPoolOpCalls).toBe(0);
  });

  it('returns "" when the server reports no destination', async () => {
    const { account, cognito } = makeAccount();
    cognito.forgotPassword = () => Promise.resolve({ destination: "" });

    const destination = await account.startPasswordReset("user@example.com");

    expect(destination).toBe("");
  });

  it("maps a Cognito error to EvnexAuthError", async () => {
    const { account, cognito } = makeAccount();
    cognito.forgotPassword = () => {
      throw client_error("LimitExceededException", "Attempt limit exceeded");
    };

    await expect(account.startPasswordReset("user@example.com")).rejects.toThrow(
      EvnexAuthError,
    );
  });
});

describe("AccountOperations.confirmPasswordReset", () => {
  // Mirrors test_confirm_password_reset.
  it("confirms the reset with a trimmed code", async () => {
    const { account, cognito } = makeAccount();
    let call: unknown;
    cognito.confirmForgotPassword = (params) => {
      call = params;
      return Promise.resolve();
    };

    await account.confirmPasswordReset("user@example.com", " 123456 ", "newpass");

    expect(call).toEqual({
      username: "user@example.com",
      code: "123456",
      newPassword: "newpass",
    });
  });

  // Mirrors test_confirm_password_reset_wrong_code.
  it("maps CodeMismatchException to InvalidChallengeResponseError", async () => {
    const { account, cognito } = makeAccount();
    cognito.confirmForgotPassword = () => {
      throw client_error("CodeMismatchException", "Invalid verification code provided");
    };

    await expect(
      account.confirmPasswordReset("user@example.com", "000000", "newpass"),
    ).rejects.toThrow(InvalidChallengeResponseError);
  });

  // Mirrors test_confirm_password_reset_expired_code.
  it("maps ExpiredCodeException to ChallengeExpiredError", async () => {
    const { account, cognito } = makeAccount();
    cognito.confirmForgotPassword = () => {
      throw client_error("ExpiredCodeException", "Invalid code provided, please request a code again");
    };

    await expect(
      account.confirmPasswordReset("user@example.com", "123456", "newpass"),
    ).rejects.toThrow(ChallengeExpiredError);
  });

  // Mirrors test_confirm_password_reset_invalid_new.
  it("maps any other Cognito error to EvnexAuthError", async () => {
    const { account, cognito } = makeAccount();
    cognito.confirmForgotPassword = () => {
      throw client_error("InvalidPasswordException", "Password does not conform to policy");
    };

    await expect(
      account.confirmPasswordReset("user@example.com", "123456", "weak"),
    ).rejects.toThrow(/conform/);
  });
});
