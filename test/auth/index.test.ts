import { beforeEach, describe, expect, it, vi } from "vitest";

// EvnexAuth (src/auth/index.ts) is F0's one real implementation besides the
// barrel — pure delegation to CognitoSession (B1) and AccountOperations
// (B2), both still TODO(...) stubs. These tests mock every collaborator so
// the delegation logic itself — and only that logic — is under test.

vi.mock("../../src/config.js", () => {
  class EvnexConfig {
    EVNEX_BASE_URL = "https://example.test";
    EVNEX_COGNITO_USER_POOL_ID = "ap-southeast-2_test";
    EVNEX_COGNITO_CLIENT_ID = "test-client-id";
    EVNEX_ORG_ID = undefined;
  }
  return { EvnexConfig };
});

vi.mock("../../src/auth/cognito.js", () => {
  const marker = { id: "fake-cognito-adapter" };
  const createCognitoAdapter = vi.fn(() => marker);
  return { createCognitoAdapter };
});

vi.mock("../../src/auth/session.js", () => {
  class CognitoSession {
    static instances: CognitoSession[] = [];
    options: Record<string, unknown>;
    startAuthentication = vi.fn(async () => ({ kind: "tokens" }));
    respondToChallenge = vi.fn(async () => ({ kind: "tokens" }));
    getAccessToken = vi.fn(async () => "access-token");
    forceRefresh = vi.fn(async () => ({ accessToken: "refreshed" }));
    constructor(options: Record<string, unknown>) {
      this.options = options;
      CognitoSession.instances.push(this);
    }
    get tokens() {
      return this.options["tokens"];
    }
  }
  return { CognitoSession };
});

vi.mock("../../src/auth/account.js", () => {
  class AccountOperations {
    static instances: AccountOperations[] = [];
    options: Record<string, unknown>;
    getMfaStatus = vi.fn(async () => ({ enabled: [], preferred: undefined }));
    beginTotpEnrollment = vi.fn(async () => ({ secret: "abc" }));
    confirmTotpEnrollment = vi.fn(async () => undefined);
    setMfaPreference = vi.fn(async () => undefined);
    changePassword = vi.fn(async () => undefined);
    startPasswordReset = vi.fn(async () => "d***@example.com");
    confirmPasswordReset = vi.fn(async () => undefined);
    constructor(options: Record<string, unknown>) {
      this.options = options;
      AccountOperations.instances.push(this);
    }
  }
  return { AccountOperations };
});

const { EvnexConfig } = await import("../../src/config.js");
const { createCognitoAdapter } = await import("../../src/auth/cognito.js");
const { CognitoSession } = await import("../../src/auth/session.js");
const { AccountOperations } = await import("../../src/auth/account.js");
const { EvnexAuth } = await import("../../src/auth/index.js");

// These describe the shape of the mock classes above, independent of the
// real (still-TODO) CognitoSession / AccountOperations types, since those
// don't declare an `options` field for tests to inspect.
interface FakeSession {
  options: Record<string, unknown>;
  startAuthentication: ReturnType<typeof vi.fn>;
  respondToChallenge: ReturnType<typeof vi.fn>;
  getAccessToken: ReturnType<typeof vi.fn>;
  forceRefresh: ReturnType<typeof vi.fn>;
}
interface FakeAccount {
  options: Record<string, unknown>;
  getMfaStatus: ReturnType<typeof vi.fn>;
  beginTotpEnrollment: ReturnType<typeof vi.fn>;
  confirmTotpEnrollment: ReturnType<typeof vi.fn>;
  setMfaPreference: ReturnType<typeof vi.fn>;
  changePassword: ReturnType<typeof vi.fn>;
  startPasswordReset: ReturnType<typeof vi.fn>;
  confirmPasswordReset: ReturnType<typeof vi.fn>;
}

function lastSession(): FakeSession {
  const instances = (CognitoSession as unknown as { instances: FakeSession[] }).instances;
  const instance = instances.at(-1);
  if (!instance) throw new Error("no CognitoSession constructed");
  return instance;
}

function lastAccount(): FakeAccount {
  const instances = (AccountOperations as unknown as { instances: FakeAccount[] }).instances;
  const instance = instances.at(-1);
  if (!instance) throw new Error("no AccountOperations constructed");
  return instance;
}

beforeEach(() => {
  (CognitoSession as unknown as { instances: unknown[] }).instances = [];
  (AccountOperations as unknown as { instances: unknown[] }).instances = [];
  vi.clearAllMocks();
});

describe("EvnexAuth construction", () => {
  it("builds a default config and a Cognito adapter when none are given", () => {
    new EvnexAuth();

    expect(createCognitoAdapter).toHaveBeenCalledWith({
      userPoolId: "ap-southeast-2_test",
      clientId: "test-client-id",
    });
    const session = lastSession();
    expect(session.options["cognito"]).toEqual({ id: "fake-cognito-adapter" });
    expect(session.options["config"]).toBeInstanceOf(EvnexConfig);
  });

  it("passes tokens and onTokenUpdate through to CognitoSession", () => {
    const tokens = { accessToken: "a" };
    const onTokenUpdate = vi.fn();
    new EvnexAuth({ tokens: tokens as never, onTokenUpdate });

    const session = lastSession();
    expect(session.options["tokens"]).toBe(tokens);
    expect(session.options["onTokenUpdate"]).toBe(onTokenUpdate);
  });

  it("uses an explicitly supplied config and cognito adapter, skipping the defaults", () => {
    const config = new EvnexConfig();
    const cognito = { id: "explicit" };
    new EvnexAuth({ config, cognito: cognito as never });

    expect(createCognitoAdapter).not.toHaveBeenCalled();
    const session = lastSession();
    expect(session.options["config"]).toBe(config);
    expect(session.options["cognito"]).toBe(cognito);
  });

  it("constructs AccountOperations sharing the same session and cognito adapter", () => {
    new EvnexAuth();

    const session = lastSession();
    const account = lastAccount();
    expect(account.options["session"]).toBe(session);
    expect(account.options["cognito"]).toEqual({ id: "fake-cognito-adapter" });
  });
});

describe("EvnexAuth delegation", () => {
  it("tokens reads through to the session", () => {
    const auth = new EvnexAuth();
    const session = lastSession();
    session.options["tokens"] = { accessToken: "current" };

    expect(auth.tokens).toEqual({ accessToken: "current" });
  });

  it("startAuthentication delegates to the session", async () => {
    const auth = new EvnexAuth();
    const session = lastSession();

    const result = await auth.startAuthentication("user@example.com", "hunter2");

    expect(session.startAuthentication).toHaveBeenCalledWith(
      "user@example.com",
      "hunter2",
    );
    expect(result).toEqual({ kind: "tokens" });
  });

  it("respondToChallenge delegates to the session", async () => {
    const auth = new EvnexAuth();
    const session = lastSession();
    const challenge = { name: "SOFTWARE_TOKEN_MFA" };

    await auth.respondToChallenge(challenge as never, "123456");

    expect(session.respondToChallenge).toHaveBeenCalledWith(challenge, "123456");
  });

  it("getAccessToken delegates to the session", async () => {
    const auth = new EvnexAuth();
    const session = lastSession();

    await expect(auth.getAccessToken()).resolves.toBe("access-token");
    expect(session.getAccessToken).toHaveBeenCalledOnce();
  });

  it("forceRefresh with no argument calls the session's unconditional overload", async () => {
    const auth = new EvnexAuth();
    const session = lastSession();

    await auth.forceRefresh();

    expect(session.forceRefresh).toHaveBeenCalledWith();
  });

  it("forceRefresh with options forwards them to the session", async () => {
    const auth = new EvnexAuth();
    const session = lastSession();

    await auth.forceRefresh({ staleAccessToken: "stale" });

    expect(session.forceRefresh).toHaveBeenCalledWith({ staleAccessToken: "stale" });
  });

  it("getMfaStatus delegates to account operations", async () => {
    const auth = new EvnexAuth();
    const account = lastAccount();

    await auth.getMfaStatus();

    expect(account.getMfaStatus).toHaveBeenCalledOnce();
  });

  it("beginTotpEnrollment delegates to account operations", async () => {
    const auth = new EvnexAuth();
    const account = lastAccount();

    await auth.beginTotpEnrollment();

    expect(account.beginTotpEnrollment).toHaveBeenCalledOnce();
  });

  it("confirmTotpEnrollment delegates to account operations", async () => {
    const auth = new EvnexAuth();
    const account = lastAccount();

    await auth.confirmTotpEnrollment("123456", { deviceName: "New phone" });

    expect(account.confirmTotpEnrollment).toHaveBeenCalledWith("123456", {
      deviceName: "New phone",
    });
  });

  it("setMfaPreference delegates to account operations", async () => {
    const auth = new EvnexAuth();
    const account = lastAccount();

    await auth.setMfaPreference({ totp: true });

    expect(account.setMfaPreference).toHaveBeenCalledWith({ totp: true });
  });

  it("changePassword delegates to account operations", async () => {
    const auth = new EvnexAuth();
    const account = lastAccount();

    await auth.changePassword("old", "new");

    expect(account.changePassword).toHaveBeenCalledWith("old", "new");
  });

  it("startPasswordReset delegates to account operations", async () => {
    const auth = new EvnexAuth();
    const account = lastAccount();

    await expect(auth.startPasswordReset("user@example.com")).resolves.toBe(
      "d***@example.com",
    );
    expect(account.startPasswordReset).toHaveBeenCalledWith("user@example.com");
  });

  it("confirmPasswordReset delegates to account operations", async () => {
    const auth = new EvnexAuth();
    const account = lastAccount();

    await auth.confirmPasswordReset("user@example.com", "000000", "new-password");

    expect(account.confirmPasswordReset).toHaveBeenCalledWith(
      "user@example.com",
      "000000",
      "new-password",
    );
  });
});
