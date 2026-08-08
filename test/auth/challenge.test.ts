import { describe, expect, it } from "vitest";
import { AuthChallenge, isAuthChallenge } from "../../src/auth/challenge.js";

const CHALLENGE_SOFTWARE_TOKEN_MFA = "SOFTWARE_TOKEN_MFA";

describe("AuthChallenge", () => {
  // Mirrors python-evnex's TestAuthChallenge.test_round_trips_through_dict.
  it("round-trips through to_dict/from_dict-equivalent JSON", () => {
    const challenge = new AuthChallenge({
      name: CHALLENGE_SOFTWARE_TOKEN_MFA,
      session: "s",
      username: "user@example.com",
      parameters: { FRIENDLY_DEVICE_NAME: "phone" },
    });

    const restored = AuthChallenge.fromJSON(challenge.toJSON());

    expect(restored).toEqual(challenge);
  });

  it("toJSON uses python-evnex's to_dict key names exactly", () => {
    const challenge = new AuthChallenge({
      name: CHALLENGE_SOFTWARE_TOKEN_MFA,
      session: "opaque-session",
      username: "user@example.com",
      parameters: { FRIENDLY_DEVICE_NAME: "phone" },
    });

    expect(challenge.toJSON()).toEqual({
      name: CHALLENGE_SOFTWARE_TOKEN_MFA,
      session: "opaque-session",
      username: "user@example.com",
      parameters: { FRIENDLY_DEVICE_NAME: "phone" },
    });
  });

  it("defaults parameters to an empty object when omitted", () => {
    const challenge = new AuthChallenge({
      name: "NEW_PASSWORD_REQUIRED",
      session: "s",
      username: "u",
    });

    expect(challenge.parameters).toEqual({});
    expect(challenge.toJSON().parameters).toEqual({});
  });

  it("fromJSON defaults parameters to an empty object when absent", () => {
    const restored = AuthChallenge.fromJSON({
      name: "NEW_PASSWORD_REQUIRED",
      session: "s",
      username: "u",
    } as never);

    expect(restored.parameters).toEqual({});
  });

  it("is immutable", () => {
    const challenge = new AuthChallenge({
      name: "SOFTWARE_TOKEN_MFA",
      session: "s",
      username: "u",
    });

    expect(Object.isFrozen(challenge)).toBe(true);
    expect(Object.isFrozen(challenge.parameters)).toBe(true);
    expect(() => {
      (challenge as { name: string }).name = "changed";
    }).toThrow();
  });

  it("does not alias the caller's parameters object", () => {
    const params = { a: "1" };
    const challenge = new AuthChallenge({
      name: "SOFTWARE_TOKEN_MFA",
      session: "s",
      username: "u",
      parameters: params,
    });

    params["a"] = "mutated";
    expect(challenge.parameters["a"]).toBe("1");
  });
});

describe("isAuthChallenge", () => {
  it("is true for an AuthChallenge instance", () => {
    const challenge = new AuthChallenge({ name: "n", session: "s", username: "u" });
    expect(isAuthChallenge(challenge)).toBe(true);
  });

  it("is false for anything else, including a look-alike object", () => {
    expect(isAuthChallenge({ name: "n", session: "s", username: "u" })).toBe(false);
    expect(isAuthChallenge(undefined)).toBe(false);
    expect(isAuthChallenge(null)).toBe(false);
    expect(isAuthChallenge("AuthChallenge")).toBe(false);
  });
});
