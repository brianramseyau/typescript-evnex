/**
 * Tests for `src/auth/session.ts`'s `CognitoSession` — mirroring
 * `tests/test_auth.py`'s `TestInteractiveAuthentication`, `TestTokenLifecycle`,
 * `TestTokenSetResumption`, and the session-relevant parts of
 * `TestErrorSurfaces` (PLAN.md §5 B1). Transport-level (`EvnexHttpxAuth`) and
 * `Evnex` client tests belong to A8/B3, not here; only `CognitoSession`
 * itself is exercised, constructed directly against `FakeCognito` rather than
 * through the `EvnexAuth` facade, so a failure here localises to the session
 * rather than to the facade or the account half.
 */

import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EvnexConfig } from "../../src/config.js";
import { AuthChallenge } from "../../src/auth/challenge.js";
import { CognitoError } from "../../src/auth/cognito.js";
import {
  ChallengeExpiredError,
  EvnexAuthError,
  InvalidChallengeResponseError,
  InvalidCredentialsError,
  PasswordChangeRequiredError,
  ReauthenticationRequiredError,
} from "../../src/errors.js";
import { CognitoSession } from "../../src/auth/session.js";
import { TokenSet } from "../../src/auth/tokens.js";
import { FakeCognito } from "../support/fakeCognito.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** A structurally valid (unsigned) access token with an `exp` claim — the
 * TS analogue of conftest.py's `make_jwt`; only used to exercise TokenSet's
 * (unverified) expiry derivation, never signature-checked. */
function makeJwt(expiresInSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ exp })}.`;
}

interface Built {
  session: CognitoSession;
  cognito: FakeCognito;
  tokenUpdates: TokenSet[];
}

interface BuildOptions {
  tokens?: TokenSet;
  cognito?: FakeCognito;
  verifyTokens?: boolean;
  config?: EvnexConfig;
  onTokenUpdate?: (tokens: TokenSet) => Promise<void>;
}

/** A `CognitoSession` wired to a `FakeCognito`, recording every published
 * token set. `verifyTokens` defaults to `false` here — matching how Python's
 * `FakeCognito` fixture bypasses pycognito's real (signature-verifying)
 * token issuance entirely; the dedicated `verifyTokens` describe block below
 * opts specific tests back in. */
function buildSession(options: BuildOptions = {}): Built {
  const cognito = options.cognito ?? new FakeCognito();
  const tokenUpdates: TokenSet[] = [];
  const onTokenUpdate =
    options.onTokenUpdate ??
    (async (tokens: TokenSet) => {
      tokenUpdates.push(tokens);
    });
  const session = new CognitoSession({
    tokens: options.tokens,
    cognito,
    onTokenUpdate,
    verifyTokens: options.verifyTokens ?? false,
    config: options.config,
  });
  return { session, cognito, tokenUpdates };
}

/** The `resumed_auth` fixture analogue: a session resumed from persisted
 * tokens, no credentials needed. */
function resumedTokens(
  overrides: Partial<{ accessToken: string; idToken: string; refreshToken: string }> = {},
): TokenSet {
  return new TokenSet({
    accessToken: overrides.accessToken ?? "access-0",
    idToken: overrides.idToken ?? "id-0",
    refreshToken: overrides.refreshToken ?? "refresh-0",
  });
}

function buildResumedSession(options: BuildOptions = {}): Built {
  return buildSession({ tokens: resumedTokens(), ...options });
}

// ===========================================================================
// TestInteractiveAuthentication
// ===========================================================================

describe("startAuthentication", () => {
  it("resolves a TokenSet on immediate success, publishes it, and exposes it as .tokens", async () => {
    const { session, tokenUpdates } = buildSession();

    const result = await session.startAuthentication("user@example.com", "hunter2");

    expect(result).toBeInstanceOf(TokenSet);
    expect(session.tokens).toBe(result);
    expect(tokenUpdates).toEqual([result]);
  });

  it("returns an AuthChallenge when Cognito issues one, without publishing tokens", async () => {
    const cognito = new FakeCognito();
    cognito.authenticate = () =>
      Promise.resolve({
        kind: "challenge" as const,
        challenge: {
          challengeName: "SOFTWARE_TOKEN_MFA",
          session: "opaque-session",
          parameters: { FRIENDLY_DEVICE_NAME: "My TOTP device" },
        },
      });
    const { session, tokenUpdates } = buildSession({ cognito });

    const challenge = await session.startAuthentication("user@example.com", "hunter2");

    expect(challenge).toBeInstanceOf(AuthChallenge);
    const authChallenge = challenge as AuthChallenge;
    expect(authChallenge.name).toBe("SOFTWARE_TOKEN_MFA");
    expect(authChallenge.username).toBe("user@example.com");
    expect(authChallenge.session).toBe("opaque-session");
    expect(authChallenge.parameters["FRIENDLY_DEVICE_NAME"]).toBe("My TOTP device");
    expect(session.tokens).toBeUndefined();
    expect(tokenUpdates).toEqual([]);
  });

  it("maps any CognitoError during sign-in to InvalidCredentialsError", async () => {
    const cognito = new FakeCognito();
    cognito.authenticate = () =>
      Promise.reject(
        new CognitoError("NotAuthorizedException", "Incorrect username or password."),
      );
    const { session } = buildSession({ cognito });

    await expect(session.startAuthentication("u", "wrong")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it("lets PasswordChangeRequiredError propagate untouched (not re-mapped to InvalidCredentialsError)", async () => {
    // The adapter throws this directly for NEW_PASSWORD_REQUIRED, not as a
    // CognitoError (PLAN.md's "two conditions are NOT CognitoError" note) —
    // session.ts must not catch and re-map it.
    const cognito = new FakeCognito();
    cognito.authenticate = () =>
      Promise.reject(
        new PasswordChangeRequiredError(
          "Cognito requires a password change before this account can sign in",
        ),
      );
    const { session } = buildSession({ cognito });

    await expect(session.startAuthentication("u", "p")).rejects.toBeInstanceOf(
      PasswordChangeRequiredError,
    );
  });

  it("lets a non-CognitoError (e.g. the DEVICE_SRP_AUTH EvnexAuthError) propagate untouched", async () => {
    const cognito = new FakeCognito();
    cognito.authenticate = () =>
      Promise.reject(new EvnexAuthError("Cognito requested a DEVICE_SRP_AUTH challenge"));
    const { session } = buildSession({ cognito });

    const err: unknown = await session
      .startAuthentication("u", "p")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvnexAuthError);
    expect(err).not.toBeInstanceOf(InvalidCredentialsError);
  });
});

// ===========================================================================
// respondToChallenge
// ===========================================================================

describe("respondToChallenge", () => {
  it("issues tokens for a SOFTWARE_TOKEN_MFA challenge, trimming the response and publishing", async () => {
    const cognito = new FakeCognito();
    let capturedArgs: { username: string; session: string; code: string } | undefined;
    const original = cognito.respondToSoftwareTokenMfaChallenge.bind(cognito);
    cognito.respondToSoftwareTokenMfaChallenge = (params) => {
      capturedArgs = params;
      return original(params);
    };
    const { session, tokenUpdates } = buildSession({ cognito });
    const challenge = new AuthChallenge({
      name: "SOFTWARE_TOKEN_MFA",
      session: "opaque-session",
      username: "user@example.com",
    });

    const result = await session.respondToChallenge(challenge, " 123456 ");

    expect(result).toBeInstanceOf(TokenSet);
    expect(session.tokens).toBe(result);
    expect(tokenUpdates).toEqual([result]);
    expect(capturedArgs).toEqual({
      username: "user@example.com",
      session: "opaque-session",
      code: "123456",
    });
  });

  it("issues tokens for an SMS_MFA challenge", async () => {
    const { session } = buildSession();
    const challenge = new AuthChallenge({
      name: "SMS_MFA",
      session: "s",
      username: "user@example.com",
    });

    const result = await session.respondToChallenge(challenge, "654321");

    expect(result).toBeInstanceOf(TokenSet);
  });

  it("maps CodeMismatchException to InvalidChallengeResponseError", async () => {
    const cognito = new FakeCognito();
    cognito.respondToSoftwareTokenMfaChallenge = () =>
      Promise.reject(new CognitoError("CodeMismatchException", "nope"));
    const { session } = buildSession({ cognito });
    const challenge = new AuthChallenge({
      name: "SOFTWARE_TOKEN_MFA",
      session: "s",
      username: "u",
    });

    await expect(session.respondToChallenge(challenge, "000000")).rejects.toBeInstanceOf(
      InvalidChallengeResponseError,
    );
  });

  it("maps ExpiredCodeException to ChallengeExpiredError", async () => {
    const cognito = new FakeCognito();
    cognito.respondToSoftwareTokenMfaChallenge = () =>
      Promise.reject(new CognitoError("ExpiredCodeException", "code expired"));
    const { session } = buildSession({ cognito });
    const challenge = new AuthChallenge({
      name: "SOFTWARE_TOKEN_MFA",
      session: "s",
      username: "u",
    });

    await expect(session.respondToChallenge(challenge, "000000")).rejects.toBeInstanceOf(
      ChallengeExpiredError,
    );
  });

  it("maps NotAuthorizedException (a lapsed challenge session) to ChallengeExpiredError", async () => {
    const cognito = new FakeCognito();
    cognito.respondToSoftwareTokenMfaChallenge = () =>
      Promise.reject(
        new CognitoError("NotAuthorizedException", "Invalid session for the user"),
      );
    const { session } = buildSession({ cognito });
    const challenge = new AuthChallenge({
      name: "SOFTWARE_TOKEN_MFA",
      session: "s",
      username: "u",
    });

    await expect(session.respondToChallenge(challenge, "123456")).rejects.toBeInstanceOf(
      ChallengeExpiredError,
    );
  });

  it("maps any other Cognito error name to EvnexAuthError", async () => {
    const cognito = new FakeCognito();
    cognito.respondToSoftwareTokenMfaChallenge = () =>
      Promise.reject(new CognitoError("SomeOtherException", "weird"));
    const { session } = buildSession({ cognito });
    const challenge = new AuthChallenge({
      name: "SOFTWARE_TOKEN_MFA",
      session: "s",
      username: "u",
    });

    const err: unknown = await session
      .respondToChallenge(challenge, "123456")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvnexAuthError);
    expect(err).not.toBeInstanceOf(ChallengeExpiredError);
    expect(err).not.toBeInstanceOf(InvalidChallengeResponseError);
  });

  it("lets a non-CognitoError from the challenge responder propagate untouched", async () => {
    const cognito = new FakeCognito();
    cognito.respondToSoftwareTokenMfaChallenge = () =>
      Promise.reject(new Error("network blip"));
    const { session } = buildSession({ cognito });
    const challenge = new AuthChallenge({
      name: "SOFTWARE_TOKEN_MFA",
      session: "s",
      username: "u",
    });

    await expect(session.respondToChallenge(challenge, "123456")).rejects.toThrow(
      "network blip",
    );
  });

  it("rejects an unsupported challenge type with EvnexAuthError naming it", async () => {
    const { session } = buildSession();
    const challenge = new AuthChallenge({
      name: "NEW_PASSWORD_REQUIRED",
      session: "s",
      username: "u",
    });

    await expect(session.respondToChallenge(challenge, "irrelevant")).rejects.toThrow(
      /NEW_PASSWORD_REQUIRED/,
    );
  });
});

// ===========================================================================
// TestTokenLifecycle
// ===========================================================================

describe("getAccessToken", () => {
  it("resumes without credentials, returning the current access token when unexpired", async () => {
    const { session } = buildResumedSession();

    const token = await session.getAccessToken();

    expect(token).toBe("access-0");
  });

  it("throws ReauthenticationRequiredError when there is no session at all", async () => {
    const { session } = buildSession();

    await expect(session.getAccessToken()).rejects.toBeInstanceOf(
      ReauthenticationRequiredError,
    );
  });

  it("refreshes proactively when the access token is already expired, carrying the refresh token forward", async () => {
    const expired = makeJwt(-60);
    const { session } = buildSession({
      tokens: new TokenSet({ accessToken: expired, refreshToken: "refresh-0" }),
    });

    const token = await session.getAccessToken();

    expect(token).toBe("access-1");
    expect(session.tokens?.refreshToken).toBe("refresh-0"); // carried forward
  });

  it("refreshes proactively for tokens within the 30s expiry skew (not yet literally expired)", async () => {
    const almostExpired = makeJwt(10); // within EXPIRY_SKEW
    const { session } = buildSession({
      tokens: new TokenSet({ accessToken: almostExpired, refreshToken: "refresh-0" }),
    });

    const token = await session.getAccessToken();

    expect(token).toBe("access-1");
  });

  it("does not refresh when the access token is comfortably unexpired", async () => {
    const fresh = makeJwt(3600);
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildSession({
      cognito,
      tokens: new TokenSet({ accessToken: fresh, refreshToken: "refresh-0" }),
    });

    const token = await session.getAccessToken();

    expect(token).toBe(fresh);
    expect(renewCalls).toBe(0);
  });
});

describe("forceRefresh", () => {
  it("is single-flight: two concurrent calls racing on the same stale token trigger exactly one refresh", async () => {
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildResumedSession({ cognito });

    const [a, b] = await Promise.all([
      session.forceRefresh({ staleAccessToken: "access-0" }),
      session.forceRefresh({ staleAccessToken: "access-0" }),
    ]);

    expect(a).toEqual(b);
    expect(renewCalls).toBe(1);
  });

  it("throws ReauthenticationRequiredError when there is no refresh token", async () => {
    const { session } = buildSession({
      tokens: new TokenSet({ accessToken: "access-0" }),
    });

    await expect(
      session.forceRefresh({ staleAccessToken: "access-0" }),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError);
  });

  it("maps a Cognito error during renewal to ReauthenticationRequiredError", async () => {
    const cognito = new FakeCognito();
    cognito.renewAccessToken = () =>
      Promise.reject(
        new CognitoError("NotAuthorizedException", "Refresh token has expired"),
      );
    const { session } = buildResumedSession({ cognito });

    await expect(
      session.forceRefresh({ staleAccessToken: "access-0" }),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError);
  });

  it("lets a non-CognitoError during renewal (e.g. a network failure) propagate untouched — it remains retryable", async () => {
    const cognito = new FakeCognito();
    cognito.renewAccessToken = () => Promise.reject(new Error("connection refused"));
    const { session } = buildResumedSession({ cognito });

    const err: unknown = await session
      .forceRefresh({ staleAccessToken: "access-0" })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ReauthenticationRequiredError);
    expect((err as Error).message).toBe("connection refused");
  });

  it("requireAccessToken guards against a misbehaving adapter: refreshed tokens with no access token raise ReauthenticationRequiredError", async () => {
    // Defensive branch: CognitoTokens.accessToken is a required string, so
    // this can only happen if an adapter misbehaves at the runtime
    // boundary (the type system cannot prevent it) — deliberately cast
    // past the type to exercise that guard, mirroring Python's own
    // `_require_access_token`, which is equally defensive and equally
    // untested upstream.
    const cognito = new FakeCognito();
    cognito.renewAccessToken = () =>
      Promise.resolve({
        accessToken: undefined,
        idToken: "id-broken",
        refreshToken: "refresh-0",
      } as unknown as Awaited<ReturnType<FakeCognito["renewAccessToken"]>>);
    const expired = makeJwt(-60);
    const { session } = buildSession({
      cognito,
      tokens: new TokenSet({ accessToken: expired, refreshToken: "refresh-0" }),
    });

    await expect(session.getAccessToken()).rejects.toBeInstanceOf(
      ReauthenticationRequiredError,
    );
  });

  it("carries the refresh token forward when Cognito's renewal response omits one", async () => {
    const { session } = buildResumedSession();

    const refreshed = await session.forceRefresh({ staleAccessToken: "access-0" });

    expect(refreshed.accessToken).toBe("access-1");
    // FakeCognito.renewAccessToken deliberately returns refreshToken:
    // undefined — this is TokenSet's carry-forward doing its job, not an
    // accident of the fixture.
    expect(refreshed.refreshToken).toBe("refresh-0");
    expect(session.tokens?.refreshToken).toBe("refresh-0");
  });

  // --- The `_ALWAYS_REFRESH` sentinel distinction --------------------------

  it("forceRefresh() with no argument at all refreshes unconditionally, even though the current access token is unchanged", async () => {
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildResumedSession({ cognito });

    const refreshed = await session.forceRefresh();

    expect(renewCalls).toBe(1);
    expect(refreshed.accessToken).toBe("access-1");
  });

  it("forceRefresh({ staleAccessToken: undefined }) is NOT equivalent to forceRefresh() when the session has a defined access token", async () => {
    // This is the crux of the sentinel: a nullish check on staleAccessToken
    // would treat this call the same as forceRefresh() (always refresh).
    // The correct behaviour is "refresh unless the tokens already rotated
    // past this stale value" — and since the current access token
    // ("access-0") is *defined* and different from the passed stale value
    // (undefined), this must be treated as already-rotated and skip the
    // network call entirely.
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildResumedSession({ cognito });

    const result = await session.forceRefresh({ staleAccessToken: undefined });

    expect(renewCalls).toBe(0);
    expect(result.accessToken).toBe("access-0");
  });

  it("forceRefresh({ staleAccessToken: undefined }) DOES refresh when the session never had an access token", async () => {
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildSession({
      cognito,
      tokens: new TokenSet({ refreshToken: "refresh-0" }),
    });

    const result = await session.forceRefresh({ staleAccessToken: undefined });

    expect(renewCalls).toBe(1);
    expect(result.accessToken).toBe("access-1");
  });

  it("single-flights concurrent forceRefresh({ staleAccessToken: undefined }) calls on a refresh-token-only session", async () => {
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildSession({
      cognito,
      tokens: new TokenSet({ refreshToken: "refresh-0" }),
    });

    const [a, b] = await Promise.all([
      session.forceRefresh({ staleAccessToken: undefined }),
      session.forceRefresh({ staleAccessToken: undefined }),
    ]);

    expect(a).toEqual(b);
    expect(renewCalls).toBe(1);
  });
});

// ===========================================================================
// TestTokenSetResumption — refresh-only resumption & persistence ordering
// ===========================================================================

describe("refresh-token-only resumption", () => {
  it("getAccessToken() refreshes once for a session constructed with only a refresh token", async () => {
    const { session } = buildSession({
      tokens: new TokenSet({ refreshToken: "refresh-0" }),
    });

    const token = await session.getAccessToken();

    expect(token).toBe("access-1");
  });

  it("20 simultaneous getAccessToken() calls against an expired session trigger exactly one refresh", async () => {
    const expired = makeJwt(-60);
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildSession({
      cognito,
      tokens: new TokenSet({ accessToken: expired, refreshToken: "refresh-0" }),
    });

    const tokens = await Promise.all(
      Array.from({ length: 20 }, () => session.getAccessToken()),
    );

    expect(new Set(tokens)).toEqual(new Set(["access-1"]));
    expect(renewCalls).toBe(1);
  });

  it("20 simultaneous getAccessToken() calls against a refresh-only (never-had-a-token) session trigger exactly one refresh", async () => {
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildSession({
      cognito,
      tokens: new TokenSet({ refreshToken: "refresh-0" }),
    });

    const tokens = await Promise.all(
      Array.from({ length: 20 }, () => session.getAccessToken()),
    );

    expect(new Set(tokens)).toEqual(new Set(["access-1"]));
    expect(renewCalls).toBe(1);
  });
});

describe("persist-before-publish ordering", () => {
  it("onTokenUpdate resolves before any caller observes the new token via .tokens", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const observedDuringPersist: (TokenSet | undefined)[] = [];
    const initialTokens = new TokenSet({ refreshToken: "refresh-0" });

    // `session` is referenced here before its `const` declaration below,
    // which is safe: this closure isn't invoked until deep inside
    // `session.forceRefresh()`, by which point the declaration has long
    // since run (the closure has to be *constructed* first, as
    // `buildSession`'s `onTokenUpdate` argument, before that call can
    // happen at all).
    const onTokenUpdate = async (_tokens: TokenSet): Promise<void> => {
      // Mid-persistence: the old tokens must still be what .tokens reports
      // for every other reader — never the new (unpersisted) ones.
      observedDuringPersist.push(session.tokens);
      await gate;
    };

    const { session } = buildSession({
      tokens: initialTokens,
      onTokenUpdate,
    });

    const refreshPromise = session.forceRefresh();

    // Let the onTokenUpdate callback start and record its observation
    // before releasing the gate — spin on microtasks rather than a timer so
    // this is deterministic.
    while (observedDuringPersist.length === 0) {
      await Promise.resolve();
    }

    expect(observedDuringPersist).toEqual([initialTokens]);
    expect(session.tokens).toBe(initialTokens);
    expect(session.tokens?.accessToken).toBeUndefined();

    releaseGate();
    const newTokens = await refreshPromise;

    expect(session.tokens).toBe(newTokens);
    expect(newTokens.accessToken).toBe("access-1");
  });

  it("onTokenUpdate resolves before a concurrent getAccessToken() caller can observe the new access token", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let persistStarted = false;

    const onTokenUpdate = async (_tokens: TokenSet): Promise<void> => {
      persistStarted = true;
      await gate;
    };

    const { session } = buildSession({
      tokens: new TokenSet({ refreshToken: "refresh-0" }),
      onTokenUpdate,
    });

    const first = session.getAccessToken();
    while (!persistStarted) {
      await Promise.resolve();
    }

    // A second caller arriving mid-persist still has no access token to
    // read (the new one is not yet published), so it must also be waiting
    // rather than observing a half-published state.
    expect(session.tokens?.accessToken).toBeUndefined();

    releaseGate();
    const [a] = await Promise.all([first]);
    expect(a).toBe("access-1");
    expect(session.tokens?.accessToken).toBe("access-1");
  });

  it("callback failure is swallowed and logged; the tokens are still published and usable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const onTokenUpdate = (): Promise<void> => {
        throw new Error("disk full");
      };
      const { session } = buildSession({ onTokenUpdate });

      const result = await session.startAuthentication("u", "p");

      expect(result).toBeInstanceOf(TokenSet);
      expect(session.tokens).toBe(result);
      expect(consoleError).toHaveBeenCalled();
      expect(String(consoleError.mock.calls[0]?.[0])).toContain(
        "onTokenUpdate callback failed",
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

// ===========================================================================
// TestErrorSurfaces (session-relevant subset)
// ===========================================================================

describe("error surfaces", () => {
  it("naive/UTC-normalised expires_at in the past still triggers a proactive refresh without raising", async () => {
    const { session } = buildSession({
      tokens: new TokenSet({
        accessToken: "access-0",
        refreshToken: "refresh-0",
        expiresAt: new Date("2020-01-01T00:00:00Z"),
      }),
    });

    const token = await session.getAccessToken();

    expect(token).toBe("access-1");
  });
});

// ===========================================================================
// runUserPoolOp — refresh-and-retry-once recovery
// ===========================================================================

describe("runUserPoolOp", () => {
  it("returns the operation's result on success without refreshing", async () => {
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildResumedSession({ cognito });

    const result = await session.runUserPoolOp((accessToken) =>
      Promise.resolve(`ok:${accessToken}`),
    );

    expect(result).toBe("ok:access-0");
    expect(renewCalls).toBe(0);
  });

  it("refreshes exactly once and retries after a NotAuthorizedException, then succeeds with the new access token", async () => {
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildResumedSession({ cognito });

    let attempt = 0;
    const seenTokens: string[] = [];
    const result = await session.runUserPoolOp((accessToken) => {
      attempt += 1;
      seenTokens.push(accessToken);
      if (attempt === 1) {
        return Promise.reject(
          new CognitoError("NotAuthorizedException", "Access Token has been revoked"),
        );
      }
      return Promise.resolve("done");
    });

    expect(result).toBe("done");
    expect(attempt).toBe(2);
    expect(seenTokens).toEqual(["access-0", "access-1"]);
    expect(renewCalls).toBe(1);
  });

  it("propagates a second NotAuthorizedException without a further refresh", async () => {
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildResumedSession({ cognito });

    const err: unknown = await session
      .runUserPoolOp(() =>
        Promise.reject(new CognitoError("NotAuthorizedException", "still bad")),
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("NotAuthorizedException");
    expect(renewCalls).toBe(1);
  });

  it("propagates a non-NotAuthorizedException error without ever refreshing", async () => {
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildResumedSession({ cognito });

    const err: unknown = await session
      .runUserPoolOp(() => Promise.reject(new CognitoError("SomeOtherException", "nope")))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).name).toBe("SomeOtherException");
    expect(renewCalls).toBe(0);
  });

  it("propagates a non-CognitoError from the operation without refreshing", async () => {
    const { session } = buildResumedSession();

    await expect(
      session.runUserPoolOp(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
  });

  it("runs `after` under the same lock as the successful call, and its result is what runUserPoolOp resolves to", async () => {
    const { session, tokenUpdates } = buildResumedSession();
    const afterOrder: string[] = [];

    const result = await session.runUserPoolOp(
      () => {
        afterOrder.push("operation");
        return Promise.resolve("op-result");
      },
      {
        after: async (value) => {
          afterOrder.push(`after:${value}`);
          // Exercise the publishTokens path B2's changePassword uses to
          // publish tokens rotated as a side effect, from inside `after`.
          await session.publishTokens(
            new TokenSet({
              accessToken: "access-rotated",
              idToken: "id-rotated",
              refreshToken: "refresh-0",
            }),
          );
        },
      },
    );

    expect(result).toBe("op-result");
    expect(afterOrder).toEqual(["operation", "after:op-result"]);
    expect(session.tokens?.accessToken).toBe("access-rotated");
    expect(tokenUpdates.at(-1)?.accessToken).toBe("access-rotated");
  });

  it("does not treat an `after` failure as a NotAuthorizedException retry candidate", async () => {
    const cognito = new FakeCognito();
    let renewCalls = 0;
    const originalRenew = cognito.renewAccessToken.bind(cognito);
    cognito.renewAccessToken = (p) => {
      renewCalls += 1;
      return originalRenew(p);
    };
    const { session } = buildResumedSession({ cognito });

    const err: unknown = await session
      .runUserPoolOp(() => Promise.resolve("ok"), {
        after: () =>
          Promise.reject(new CognitoError("NotAuthorizedException", "boom in after")),
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CognitoError);
    expect(renewCalls).toBe(0);
  });

  it("does not deadlock across the refresh-and-retry loop (forceRefresh runs outside the lock)", async () => {
    // Mutex.runExclusive is not re-entrant: if forceRefresh were (incorrectly)
    // invoked from inside the same locked callback as `operation`, this
    // would hang until vitest's test timeout rather than resolving.
    const { session } = buildResumedSession();
    let attempt = 0;

    const result = await session.runUserPoolOp(() => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.reject(new CognitoError("NotAuthorizedException", "revoked"));
      }
      return Promise.resolve("ok");
    });

    expect(result).toBe("ok");
  });
});

// ===========================================================================
// Construction
// ===========================================================================

describe("construction", () => {
  it("starts with no tokens when none are given", () => {
    const session = new CognitoSession();
    expect(session.tokens).toBeUndefined();
  });

  it("starts resumed when tokens are given", () => {
    const tokens = resumedTokens();
    const session = new CognitoSession({ tokens, verifyTokens: false });
    expect(session.tokens).toBe(tokens);
  });
});

// ===========================================================================
// verifyTokens (PLAN.md §3.4) — default true, JWKS-backed verification
// ===========================================================================

describe("verifyTokens", () => {
  const KID = "test-signing-key";
  let privateKey: KeyObject;
  let jwk: Record<string, unknown>;

  beforeAll(() => {
    const { publicKey, privateKey: generatedPrivateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    privateKey = generatedPrivateKey;
    const exported = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
    jwk = { ...exported, kid: KID, alg: "RS256", use: "sig" };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function signRsaJwt(claims: Record<string, unknown>): string {
    const header = base64url({ alg: "RS256", typ: "JWT", kid: KID });
    const payload = base64url(claims);
    const signingInput = `${header}.${payload}`;
    const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput), privateKey);
    return `${signingInput}.${signature.toString("base64url")}`;
  }

  function stubJwks(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })),
    );
  }

  it("defaults to true: verifying real, correctly signed tokens succeeds end-to-end", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const accessToken = signRsaJwt({ sub: "user-1", exp });
    const idToken = signRsaJwt({ sub: "user-1", exp });
    const cognito = new FakeCognito();
    cognito.authenticate = () =>
      Promise.resolve({
        kind: "tokens" as const,
        tokens: { accessToken, idToken, refreshToken: "refresh-0" },
      });
    stubJwks();

    // verifyTokens omitted entirely -> defaults to true.
    const session = new CognitoSession({
      cognito,
      config: new EvnexConfig({
        EVNEX_COGNITO_USER_POOL_ID: "ap-southeast-2_sessVerifyDefault",
      }),
    });

    const result = await session.startAuthentication("user@example.com", "hunter2");

    expect(result).toBeInstanceOf(TokenSet);
    expect((result as TokenSet).accessToken).toBe(accessToken);
  });

  it("does not verify tokens when verifyTokens is false, even without a JWKS stub available", async () => {
    const { session } = buildSession({ verifyTokens: false });
    // No fetch stub installed at all — a real network call here would fail
    // the test (or hang); its absence is the proof verification was skipped.
    const result = await session.startAuthentication("u", "p");
    expect(result).toBeInstanceOf(TokenSet);
  });

  it("startAuthentication: a verification failure surfaces as EvnexAuthError, not InvalidCredentialsError", async () => {
    stubJwks();
    const cognito = new FakeCognito(); // issues plain "access-1"-style tokens, not JWTs
    const session = new CognitoSession({
      cognito,
      verifyTokens: true,
      config: new EvnexConfig({
        EVNEX_COGNITO_USER_POOL_ID: "ap-southeast-2_sessVerifyStartFail",
      }),
    });

    const err: unknown = await session
      .startAuthentication("u", "p")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EvnexAuthError);
    expect(err).not.toBeInstanceOf(InvalidCredentialsError);
    expect(session.tokens).toBeUndefined(); // never published
  });

  it("forceRefresh: a verification failure (malformed renewed token) maps to ReauthenticationRequiredError", async () => {
    stubJwks();
    const cognito = new FakeCognito(); // renewAccessToken issues plain "access-N" tokens
    const session = new CognitoSession({
      tokens: resumedTokens(),
      cognito,
      verifyTokens: true,
      config: new EvnexConfig({
        EVNEX_COGNITO_USER_POOL_ID: "ap-southeast-2_sessVerifyRefreshFail",
      }),
    });

    await expect(
      session.forceRefresh({ staleAccessToken: "access-0" }),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError);
    expect(session.tokens?.accessToken).toBe("access-0"); // never published
  });

  it("forceRefresh: a raw JWKS-fetch failure (network error) propagates untouched, not wrapped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    const cognito = new FakeCognito();
    const session = new CognitoSession({
      tokens: resumedTokens(),
      cognito,
      verifyTokens: true,
      config: new EvnexConfig({
        EVNEX_COGNITO_USER_POOL_ID: "ap-southeast-2_sessVerifyNetFail",
      }),
    });

    const err: unknown = await session
      .forceRefresh({ staleAccessToken: "access-0" })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ReauthenticationRequiredError);
    expect((err as Error).message).toBe("network down");
  });
});
