import { describe, expect, it } from "vitest";
import { FakeCognito } from "./fakeCognito.js";

describe("FakeCognito", () => {
  it("authenticate issues serialed tokens with a refresh token", async () => {
    const cognito = new FakeCognito();

    const result = await cognito.authenticate({ username: "u", password: "p" });

    expect(result).toEqual({
      kind: "tokens",
      tokens: { accessToken: "access-1", idToken: "id-1", refreshToken: "refresh-0" },
    });
  });

  it("the token serial is shared across issuing methods and keeps incrementing", async () => {
    const cognito = new FakeCognito();

    await cognito.authenticate({ username: "u", password: "p" });
    const second = await cognito.respondToSoftwareTokenMfaChallenge({
      username: "u",
      session: "s",
      code: "123456",
    });
    const third = await cognito.respondToSmsMfaChallenge({
      username: "u",
      session: "s",
      code: "123456",
    });

    expect(second.kind).toBe("tokens");
    expect(third.kind).toBe("tokens");
    if (second.kind === "tokens" && third.kind === "tokens") {
      expect(second.tokens.accessToken).toBe("access-2");
      expect(third.tokens.accessToken).toBe("access-3");
    }
  });

  it("renewAccessToken rotates the serial but omits the refresh token", async () => {
    const cognito = new FakeCognito();
    await cognito.authenticate({ username: "u", password: "p" }); // access-1 / refresh-0

    const rotated = await cognito.renewAccessToken({
      username: "u",
      refreshToken: "refresh-0",
    });

    expect(rotated).toEqual({ accessToken: "access-2", idToken: "id-2", refreshToken: undefined });
    expect("refreshToken" in rotated).toBe(true);
    expect(rotated.refreshToken).toBeUndefined();
  });

  it("getUser reports the default enabled MFA method", async () => {
    const cognito = new FakeCognito();

    const info = await cognito.getUser({ accessToken: "access-1" });

    expect(info).toEqual({
      mfaSettingList: ["SOFTWARE_TOKEN_MFA"],
      preferredMfaSetting: "SOFTWARE_TOKEN_MFA",
    });
  });

  it("associateSoftwareToken / verifySoftwareToken / forgotPassword return fixed fake values", async () => {
    const cognito = new FakeCognito();

    await expect(cognito.associateSoftwareToken({ accessToken: "a" })).resolves.toEqual({
      secretCode: "FAKESECRETBASE32",
    });
    await expect(
      cognito.verifySoftwareToken({ accessToken: "a", code: "123456", deviceName: "phone" }),
    ).resolves.toEqual({ status: "SUCCESS" });
    await expect(cognito.forgotPassword({ username: "u" })).resolves.toEqual({
      destination: "b***@e***",
    });
  });

  it("setUserMfaPreference, changePassword, and confirmForgotPassword resolve with no value", async () => {
    const cognito = new FakeCognito();

    await expect(
      cognito.setUserMfaPreference({
        accessToken: "a",
        smsMfa: false,
        softwareTokenMfa: true,
        preferred: "SOFTWARE_TOKEN",
      }),
    ).resolves.toBeUndefined();
    await expect(
      cognito.changePassword({ accessToken: "a", previousPassword: "old", proposedPassword: "new" }),
    ).resolves.toBeUndefined();
    await expect(
      cognito.confirmForgotPassword({ username: "u", code: "123456", newPassword: "new" }),
    ).resolves.toBeUndefined();
  });

  it("a test can override any method to script a failure, mirroring MagicMock(side_effect=...)", async () => {
    const cognito = new FakeCognito();
    cognito.authenticate = () => Promise.reject(new Error("NotAuthorizedException"));

    await expect(cognito.authenticate({ username: "u", password: "wrong" })).rejects.toThrow(
      "NotAuthorizedException",
    );
  });

  it("issueTokens/rotateTokens are exposed so a scripted override can still participate in serial rotation", async () => {
    const cognito = new FakeCognito();
    let calls = 0;
    cognito.authenticate = () => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          kind: "challenge",
          challenge: { challengeName: "SOFTWARE_TOKEN_MFA", session: "s", parameters: {} },
        });
      }
      return Promise.resolve({ kind: "tokens", tokens: cognito.issueTokens() });
    };

    const first = await cognito.authenticate({ username: "u", password: "p" });
    const second = await cognito.authenticate({ username: "u", password: "p" });

    expect(first.kind).toBe("challenge");
    expect(second).toEqual({
      kind: "tokens",
      tokens: { accessToken: "access-1", idToken: "id-1", refreshToken: "refresh-0" },
    });
  });
});
