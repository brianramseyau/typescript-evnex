import { describe, it, expect } from "vitest";
import {
  EvnexError,
  EvnexAuthError,
  InvalidCredentialsError,
  ReauthenticationRequiredError,
  ChallengeExpiredError,
  PasswordChangeRequiredError,
  InvalidChallengeResponseError,
  EvnexConfigurationError,
  EvnexValidationError,
} from "../src/errors.js";

describe("Error hierarchy", () => {
  it("EvnexError is the root", () => {
    const err = new EvnexError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EvnexError);
    expect(err.name).toBe("EvnexError");
    expect(err.message).toBe("test");
  });

  it("EvnexAuthError extends EvnexError", () => {
    const err = new EvnexAuthError("test");
    expect(err).toBeInstanceOf(EvnexError);
    expect(err).toBeInstanceOf(EvnexAuthError);
    expect(err.name).toBe("EvnexAuthError");
  });

  it("InvalidCredentialsError extends EvnexAuthError", () => {
    const err = new InvalidCredentialsError("test");
    expect(err).toBeInstanceOf(EvnexError);
    expect(err).toBeInstanceOf(EvnexAuthError);
    expect(err).toBeInstanceOf(InvalidCredentialsError);
    expect(err.name).toBe("InvalidCredentialsError");
  });

  it("ReauthenticationRequiredError extends EvnexAuthError", () => {
    const err = new ReauthenticationRequiredError("test");
    expect(err).toBeInstanceOf(EvnexError);
    expect(err).toBeInstanceOf(EvnexAuthError);
    expect(err).toBeInstanceOf(ReauthenticationRequiredError);
    expect(err.name).toBe("ReauthenticationRequiredError");
  });

  it("ChallengeExpiredError extends EvnexAuthError", () => {
    const err = new ChallengeExpiredError("test");
    expect(err).toBeInstanceOf(EvnexError);
    expect(err).toBeInstanceOf(EvnexAuthError);
    expect(err).toBeInstanceOf(ChallengeExpiredError);
    expect(err.name).toBe("ChallengeExpiredError");
  });

  it("PasswordChangeRequiredError extends EvnexAuthError", () => {
    const err = new PasswordChangeRequiredError("test");
    expect(err).toBeInstanceOf(EvnexError);
    expect(err).toBeInstanceOf(EvnexAuthError);
    expect(err).toBeInstanceOf(PasswordChangeRequiredError);
    expect(err.name).toBe("PasswordChangeRequiredError");
  });

  it("InvalidChallengeResponseError extends EvnexAuthError", () => {
    const err = new InvalidChallengeResponseError("test");
    expect(err).toBeInstanceOf(EvnexError);
    expect(err).toBeInstanceOf(EvnexAuthError);
    expect(err).toBeInstanceOf(InvalidChallengeResponseError);
    expect(err.name).toBe("InvalidChallengeResponseError");
  });

  it("EvnexConfigurationError extends EvnexError", () => {
    const err = new EvnexConfigurationError("test");
    expect(err).toBeInstanceOf(EvnexError);
    expect(err).toBeInstanceOf(EvnexConfigurationError);
    expect(err.name).toBe("EvnexConfigurationError");
  });

  it("EvnexValidationError extends EvnexError", () => {
    const err = new EvnexValidationError("test");
    expect(err).toBeInstanceOf(EvnexError);
    expect(err).toBeInstanceOf(EvnexValidationError);
    expect(err.name).toBe("EvnexValidationError");
  });

  it("error names survive minification by being explicitly set", () => {
    const err = new InvalidCredentialsError("test");
    expect(err.name).toBe("InvalidCredentialsError");
    // Even if the class name were minified, the instance name should remain
    expect(Object.getOwnPropertyDescriptor(err, "name")).toBeDefined();
  });

  it("supports cause via ErrorOptions", () => {
    const cause = new Error("original");
    const err = new EvnexAuthError("wrapper", { cause });
    expect(err.cause).toBe(cause);
  });

  it("all auth errors can be caught as EvnexAuthError", () => {
    const errors: EvnexAuthError[] = [
      new InvalidCredentialsError("test"),
      new ReauthenticationRequiredError("test"),
      new ChallengeExpiredError("test"),
      new PasswordChangeRequiredError("test"),
      new InvalidChallengeResponseError("test"),
    ];

    errors.forEach((err) => {
      expect(err).toBeInstanceOf(EvnexAuthError);
      expect(err).toBeInstanceOf(EvnexError);
    });
  });

  it("all errors can be caught as EvnexError", () => {
    const errors: EvnexError[] = [
      new EvnexAuthError("test"),
      new InvalidCredentialsError("test"),
      new EvnexConfigurationError("test"),
      new EvnexValidationError("test"),
    ];

    errors.forEach((err) => {
      expect(err).toBeInstanceOf(EvnexError);
    });
  });

  it("error messages are preserved", () => {
    const msg = "specific error message";
    expect(new EvnexError(msg).message).toBe(msg);
    expect(new EvnexAuthError(msg).message).toBe(msg);
    expect(new InvalidCredentialsError(msg).message).toBe(msg);
  });

  it("empty message is allowed", () => {
    const err = new EvnexError();
    expect(err.message).toBe("");
  });
});
