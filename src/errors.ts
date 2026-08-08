/**
 * Typed errors raised by the EVNEX client — ported from `evnex/errors.py`.
 *
 * All authentication problems derive from EvnexAuthError; catch that to
 * handle "the session is not usable" generically, or a subclass to react to
 * a specific condition.
 *
 * TODO(A1): implement. Every class sets `this.name` explicitly (so it
 * survives minification) and supports `cause` via the standard `ErrorOptions`
 * second constructor argument.
 *
 * Note: Python's deprecated `NotAuthorizedException` module-level
 * `__getattr__` alias is deliberately NOT ported — see PLAN.md §2.4. It is
 * scheduled for removal in python-evnex 0.8.0 and has no idiomatic TS form.
 * Record the omission in PARITY.md.
 */

/** Base for authentication and session lifecycle errors. */
export class EvnexAuthError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    throw new Error("TODO(A1)");
  }
}

/** The username or password was rejected. */
export class InvalidCredentialsError extends EvnexAuthError {}

/** The session cannot be renewed; interactive authentication is needed. */
export class ReauthenticationRequiredError extends EvnexAuthError {}

/** The short-lived challenge session lapsed; restart authentication. */
export class ChallengeExpiredError extends EvnexAuthError {}

/** A new password must be set before this account can sign in. */
export class PasswordChangeRequiredError extends EvnexAuthError {}

/** The challenge response (e.g. MFA code) was rejected; retry is possible. */
export class InvalidChallengeResponseError extends EvnexAuthError {}

/**
 * A required client configuration value is missing or invalid.
 *
 * Deterministic and never worth retrying (e.g. no organisation id could be
 * resolved for an org-scoped call).
 */
export class EvnexConfigurationError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    throw new Error("TODO(A1)");
  }
}

/** Wraps a `z.ZodError` raised while parsing an API response. */
export class EvnexValidationError extends Error {
  readonly cause: unknown;

  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    throw new Error("TODO(A1)");
  }
}

/** Base for the auth-error hierarchy. Superclass, not raised directly. */
export class EvnexError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    throw new Error("TODO(A1)");
  }
}
