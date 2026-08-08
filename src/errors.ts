/**
 * Typed errors raised by the EVNEX client — ported from `evnex/errors.py`.
 *
 * All authentication problems derive from EvnexAuthError; catch that to
 * handle "the session is not usable" generically, or a subclass to react to
 * a specific condition. Everything the library raises derives from
 * EvnexError, which has no direct Python analogue: python-evnex's
 * EvnexAuthError/EvnexConfigurationError each extend ValueError separately,
 * and JS has no equivalent shared base worth reusing, so this port
 * introduces EvnexError as the unifying root (PLAN.md §2.4).
 *
 * Every class sets `this.name` explicitly (so it survives minification)
 * and supports `cause` via the standard `ErrorOptions` second constructor
 * argument.
 *
 * Note: Python's deprecated `NotAuthorizedException` module-level
 * `__getattr__` alias is deliberately NOT ported — see PLAN.md §2.4. It is
 * scheduled for removal in python-evnex 0.8.0 and has no idiomatic TS form.
 * Record the omission in PARITY.md.
 */

/** Root of every error this library raises. */
export class EvnexError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EvnexError";
  }
}

/** Base for authentication and session lifecycle errors. */
export class EvnexAuthError extends EvnexError {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EvnexAuthError";
  }
}

/** The username or password was rejected. */
export class InvalidCredentialsError extends EvnexAuthError {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidCredentialsError";
  }
}

/** The session cannot be renewed; interactive authentication is needed. */
export class ReauthenticationRequiredError extends EvnexAuthError {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReauthenticationRequiredError";
  }
}

/** The short-lived challenge session lapsed; restart authentication. */
export class ChallengeExpiredError extends EvnexAuthError {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChallengeExpiredError";
  }
}

/** A new password must be set before this account can sign in. */
export class PasswordChangeRequiredError extends EvnexAuthError {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PasswordChangeRequiredError";
  }
}

/** The challenge response (e.g. MFA code) was rejected; retry is possible. */
export class InvalidChallengeResponseError extends EvnexAuthError {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidChallengeResponseError";
  }
}

/**
 * A required client configuration value is missing or invalid.
 *
 * Deterministic and never worth retrying (e.g. no organisation id could be
 * resolved for an org-scoped call).
 */
export class EvnexConfigurationError extends EvnexError {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EvnexConfigurationError";
  }
}

/** Wraps a `z.ZodError` raised while parsing an API response, on `cause`. */
export class EvnexValidationError extends EvnexError {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EvnexValidationError";
  }
}
