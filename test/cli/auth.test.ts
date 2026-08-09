/**
 * Tests for the `auth` command group (PLAN.md §5 C2) — mirrors the
 * behaviour tests in `tests/test_cli.py`: `TestLogout`,
 * `TestPasswordMismatch`, `test_confirm_no_prefer_sets_prefer_false`, and
 * `test_confirm_defaults_to_preferring`, plus `signedInAuth`'s own
 * cache-hit / reauthentication / challenge-loop logic.
 *
 * `TestLoadTokens` and `TestOtpCommand` / `test_challenge_code_prompts_on_stderr`
 * are already exercised end to end by `tokenCache.test.ts` and `otp.test.ts`
 * respectively (both 100% covered) — `signedInAuth` only *composes* those
 * modules, so this file checks that composition, not their internals again.
 *
 * `EvnexAuth` (src/auth/index.ts) is a real, independently-tested
 * implementation (PLAN.md §5 F0) with its own Cognito wiring; mocking it
 * here keeps this file's tests about *this* module's orchestration
 * (cache load/save, the challenge loop, prompt sequencing, exit codes)
 * rather than re-driving a full sign-in through a fake Cognito backend.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthChallenge } from "../../src/auth/challenge.js";
import { TotpEnrollment } from "../../src/auth/mfa.js";
import { TokenSet } from "../../src/auth/tokens.js";
import { ReauthenticationRequiredError } from "../../src/errors.js";
import { dispatch } from "../../src/cli/parser.js";
import type { Command } from "../../src/cli/parser.js";
import type * as AuthIndexModule from "../../src/auth/index.js";
import { runCli } from "../support/cli.js";
import { FakeStdin, installFakeStdin } from "./fakeStdin.js";

// ---------------------------------------------------------------------------
// EvnexAuth mock — a small scripted fake behind the real module's other
// exports (isAuthChallenge, AuthChallenge, TokenSet, TotpEnrollment, ...),
// which stay real so `instanceof`/type-guard checks inside auth.ts still work.
// ---------------------------------------------------------------------------

const script = vi.hoisted(() => ({
  getAccessToken: vi.fn(async (): Promise<string> => {
    throw new Error("getAccessToken not scripted");
  }),
  startAuthentication: vi.fn(
    async (_username: string, _password: string): Promise<unknown> => {
      throw new Error("startAuthentication not scripted");
    },
  ),
  respondToChallenge: vi.fn(
    async (_challenge: unknown, _code: string): Promise<unknown> => {
      throw new Error("respondToChallenge not scripted");
    },
  ),
  getMfaStatus: vi.fn(
    async (): Promise<{ enabled: readonly string[]; preferred: string | undefined }> => ({
      enabled: [],
      preferred: undefined,
    }),
  ),
  beginTotpEnrollment: vi.fn(async (): Promise<unknown> => {
    throw new Error("beginTotpEnrollment not scripted");
  }),
  confirmTotpEnrollment: vi.fn(
    async (_code: string, _options?: unknown): Promise<void> => {},
  ),
  setMfaPreference: vi.fn(async (_options?: unknown): Promise<void> => {}),
  changePassword: vi.fn(async (_current: string, _next: string): Promise<void> => {}),
  startPasswordReset: vi.fn(async (_username: string): Promise<string> => ""),
  confirmPasswordReset: vi.fn(
    async (_username: string, _code: string, _next: string): Promise<void> => {},
  ),
  constructed: [] as unknown[],
}));

vi.mock("../../src/auth/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof AuthIndexModule>();

  class FakeEvnexAuth {
    tokens: unknown;
    constructor(options: Record<string, unknown> = {}) {
      this.tokens = options["tokens"];
      script.constructed.push(options);
    }
    async getAccessToken(): Promise<string> {
      return script.getAccessToken();
    }
    async startAuthentication(username: string, password: string): Promise<unknown> {
      const result = await script.startAuthentication(username, password);
      if (!actual.isAuthChallenge(result)) this.tokens = result;
      return result;
    }
    async respondToChallenge(challenge: unknown, code: string): Promise<unknown> {
      const result = await script.respondToChallenge(challenge, code);
      if (!actual.isAuthChallenge(result)) this.tokens = result;
      return result;
    }
    async getMfaStatus(): Promise<unknown> {
      return script.getMfaStatus();
    }
    async beginTotpEnrollment(): Promise<unknown> {
      return script.beginTotpEnrollment();
    }
    async confirmTotpEnrollment(code: string, options?: unknown): Promise<void> {
      return script.confirmTotpEnrollment(code, options);
    }
    async setMfaPreference(options?: unknown): Promise<void> {
      return script.setMfaPreference(options);
    }
    async changePassword(current: string, next: string): Promise<void> {
      return script.changePassword(current, next);
    }
    async startPasswordReset(username: string): Promise<string> {
      return script.startPasswordReset(username);
    }
    async confirmPasswordReset(
      username: string,
      code: string,
      next: string,
    ): Promise<void> {
      return script.confirmPasswordReset(username, code, next);
    }
  }

  return { ...actual, EvnexAuth: FakeEvnexAuth };
});

const qrMock = vi.hoisted(() => ({ showQr: vi.fn(async (): Promise<void> => {}) }));
vi.mock("../../src/cli/qr.js", () => ({ showQr: qrMock.showQr }));

const { createAuthCommand, signedInAuth } =
  await import("../../src/cli/commands/auth.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A `FakeStdin` that delivers queued lines the instant a new `"data"`
 * listener is attached (`EventEmitter`'s `newListener` fires synchronously
 * before the listener is added), so a handler's several sequential prompts
 * each get their scripted answer without the test needing to guess how many
 * microtask ticks separate them. */
class ScriptedStdin extends FakeStdin {
  private readonly queue: string[] = [];

  constructor(isTTY = false) {
    super(isTTY);
    this.on("newListener", (event: string) => {
      if (event !== "data" || this.queue.length === 0) return;
      // Non-null: `this.queue.length === 0` returned above already.
      const next = this.queue.shift()!;
      queueMicrotask(() => this.push(next));
    });
  }

  enqueue(line: string): this {
    this.queue.push(`${line}\n`);
    return this;
  }
}

let stdin: ScriptedStdin;
let restoreStdin: () => void;

function root(): Command {
  return { name: "evnex", help: "root", children: [createAuthCommand()] };
}

function run(argv: readonly string[]) {
  return runCli((a) => dispatch(root(), a), ["auth", ...argv]);
}

let tmpDir: string;

async function cachePath(): Promise<string> {
  return join(tmpDir, "tokens.json");
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "evnex-auth-test-"));
  stdin = new ScriptedStdin(false);
  restoreStdin = installFakeStdin(stdin);
  delete process.env["EVNEX_CLIENT_USERNAME"];
  delete process.env["EVNEX_CLIENT_PASSWORD"];
  script.constructed.length = 0;
  for (const fn of Object.values(script)) {
    if (typeof (fn as { mockClear?: () => void }).mockClear === "function") {
      (fn as { mockClear: () => void }).mockClear();
    }
  }
  qrMock.showQr.mockClear();
});

afterEach(async () => {
  restoreStdin();
  delete process.env["EVNEX_CLIENT_USERNAME"];
  delete process.env["EVNEX_CLIENT_PASSWORD"];
  await rm(tmpDir, { recursive: true, force: true });
});

const challenge = new AuthChallenge({
  name: "SOFTWARE_TOKEN_MFA",
  session: "session-token",
  username: "alice@example.com",
});

function issuedTokens(): TokenSet {
  return new TokenSet({
    accessToken: "access-1",
    idToken: "id-1",
    refreshToken: "refresh-1",
  });
}

// ---------------------------------------------------------------------------
// Command tree wiring
// ---------------------------------------------------------------------------

describe("createAuthCommand", () => {
  it("declares login, logout, status, change-password, reset-password, and mfa", () => {
    const auth = createAuthCommand();
    expect(auth.children?.map((c) => c.name)).toEqual([
      "login",
      "logout",
      "status",
      "change-password",
      "reset-password",
      "mfa",
    ]);
  });

  it("declares mfa's enable, disable, enroll, confirm children", () => {
    const mfa = createAuthCommand().children?.find((c) => c.name === "mfa");
    expect(mfa?.children?.map((c) => c.name)).toEqual([
      "enable",
      "disable",
      "enroll",
      "confirm",
    ]);
  });

  it("logout only takes --token-cache, matching Python's TestLogout wiring", async () => {
    const accepted = await run(["logout", "--token-cache", await cachePath()]);
    expect(accepted.exitCode).toBe(0);

    const rejected = await run(["logout", "--otp", "123456"]);
    expect(rejected.exitCode).toBe(2);
    expect(rejected.stderr).toContain("Unknown option '--otp'");
  });

  it("reset-password rejects the session flags entirely (none declared)", async () => {
    process.env["EVNEX_CLIENT_USERNAME"] = "alice@example.com";
    const result = await run(["reset-password", "--token-cache", await cachePath()]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown option '--token-cache'");
  });

  it("mfa confirm requires the totp-code positional", async () => {
    const result = await run(["mfa", "confirm"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("the following arguments are required: totp-code");
  });
});

// ---------------------------------------------------------------------------
// signedInAuth
// ---------------------------------------------------------------------------

describe("signedInAuth", () => {
  it("returns immediately on a still-valid cached session, without prompting", async () => {
    const cache = await cachePath();
    await writeFile(
      cache,
      JSON.stringify({
        access_token: "access-0",
        id_token: "id-0",
        refresh_token: "refresh-0",
        expires_at: null,
      }),
    );
    script.getAccessToken.mockResolvedValueOnce("access-0");

    const auth = await signedInAuth({ positionals: [], tokenCache: cache });

    expect(script.getAccessToken).toHaveBeenCalledTimes(1);
    expect(script.startAuthentication).not.toHaveBeenCalled();
    expect(auth.tokens).toBeDefined();
  });

  it("propagates a non-reauth error from getAccessToken uncaught", async () => {
    const cache = await cachePath();
    await writeFile(
      cache,
      JSON.stringify({
        access_token: "a",
        id_token: "i",
        refresh_token: "r",
        expires_at: null,
      }),
    );
    script.getAccessToken.mockRejectedValueOnce(new Error("boom"));

    await expect(signedInAuth({ positionals: [], tokenCache: cache })).rejects.toThrow(
      "boom",
    );
  });

  it("falls back to interactive sign-in on ReauthenticationRequiredError, using env credentials", async () => {
    const cache = await cachePath();
    await writeFile(
      cache,
      JSON.stringify({
        access_token: "a",
        id_token: "i",
        refresh_token: "r",
        expires_at: null,
      }),
    );
    script.getAccessToken.mockRejectedValueOnce(
      new ReauthenticationRequiredError("expired"),
    );
    script.startAuthentication.mockResolvedValueOnce(issuedTokens());
    process.env["EVNEX_CLIENT_USERNAME"] = "alice@example.com";
    process.env["EVNEX_CLIENT_PASSWORD"] = "hunter2";

    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });

    const auth = await signedInAuth({ positionals: [], tokenCache: cache });

    expect(stderrChunks.join("")).toContain("Cached session expired; signing in again");
    expect(stderrChunks.join("")).toContain(
      `Signed in as alice@example.com; session cached at ${cache}`,
    );
    expect(script.startAuthentication).toHaveBeenCalledWith(
      "alice@example.com",
      "hunter2",
    );
    expect(auth.tokens).toBeDefined();
    vi.restoreAllMocks();
  });

  it("prompts for username and password when no cache and no env vars are present", async () => {
    const cache = await cachePath(); // does not exist yet
    script.startAuthentication.mockResolvedValueOnce(issuedTokens());
    stdin.enqueue("bob@example.com").enqueue("s3cret");

    const auth = await signedInAuth({ positionals: [], tokenCache: cache });

    expect(script.startAuthentication).toHaveBeenCalledWith("bob@example.com", "s3cret");
    expect(auth.tokens).toBeDefined();
  });

  it("answers a challenge via --otp and loops until a TokenSet comes back", async () => {
    const cache = await cachePath();
    script.startAuthentication.mockResolvedValueOnce(challenge);
    script.respondToChallenge.mockResolvedValueOnce(issuedTokens());
    process.env["EVNEX_CLIENT_USERNAME"] = "alice@example.com";
    process.env["EVNEX_CLIENT_PASSWORD"] = "hunter2";

    const auth = await signedInAuth({
      positionals: [],
      tokenCache: cache,
      otp: "654321",
    });

    expect(script.respondToChallenge).toHaveBeenCalledWith(challenge, "654321");
    expect(auth.tokens).toBeDefined();
  });

  it("answers a challenge via an interactive prompt when no --otp is given", async () => {
    const cache = await cachePath();
    script.startAuthentication.mockResolvedValueOnce(challenge);
    script.respondToChallenge.mockResolvedValueOnce(issuedTokens());
    process.env["EVNEX_CLIENT_USERNAME"] = "alice@example.com";
    process.env["EVNEX_CLIENT_PASSWORD"] = "hunter2";
    stdin.enqueue("999999");

    const auth = await signedInAuth({ positionals: [], tokenCache: cache });

    expect(script.respondToChallenge).toHaveBeenCalledWith(challenge, "999999");
    expect(auth.tokens).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// auth login
// ---------------------------------------------------------------------------

describe("auth login", () => {
  it("signs in and caches tokens, printing nothing to stdout", async () => {
    const cache = await cachePath();
    script.startAuthentication.mockResolvedValueOnce(issuedTokens());
    process.env["EVNEX_CLIENT_USERNAME"] = "alice@example.com";
    process.env["EVNEX_CLIENT_PASSWORD"] = "hunter2";

    const result = await run(["login", "--token-cache", cache]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Signed in as alice@example.com");
  });
});

// ---------------------------------------------------------------------------
// auth logout — mirrors Python's TestLogout
// ---------------------------------------------------------------------------

describe("auth logout", () => {
  it("removes a present cache and reports it", async () => {
    const cache = await cachePath();
    await writeFile(cache, "{}");

    const result = await run(["logout", "--token-cache", cache]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`Removed cached session at ${cache}\n`);
  });

  it("reports nothing to do when the cache is missing", async () => {
    const cache = await cachePath();

    const result = await run(["logout", "--token-cache", cache]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("No cached session\n");
  });
});

// ---------------------------------------------------------------------------
// auth status
// ---------------------------------------------------------------------------

describe("auth status", () => {
  function base64url(value: string): string {
    return Buffer.from(value, "utf8").toString("base64url");
  }

  function jwtWithPayload(payloadJson: string): string {
    return `${base64url("{}")}.${base64url(payloadJson)}.sig`;
  }

  async function statusWithTokens(tokens: TokenSet) {
    const cache = await cachePath();
    script.getAccessToken.mockResolvedValueOnce("access-0");
    script.constructed.push({ tokens });
    // Prime the fake's `tokens` getter by resuming from a cache file that
    // decodes to exactly `tokens` (round-tripping via TokenSet's own JSON
    // shape keeps this independent of the fake's internals).
    await writeFile(cache, JSON.stringify(tokens.toJSON()));
    return run(["status", "--token-cache", cache]);
  }

  it("shows 'unknown (no identity token cached)' when there is no id token", async () => {
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", refreshToken: "r" }),
    );
    expect(result.stdout).toContain("Signed in as: unknown (no identity token cached)");
  });

  it("prefers the email claim", async () => {
    const idToken = jwtWithPayload(
      JSON.stringify({ email: "carol@example.com", "cognito:username": "carol" }),
    );
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", idToken, refreshToken: "r" }),
    );
    expect(result.stdout).toContain("Signed in as: carol@example.com");
  });

  it("falls back to cognito:username when there is no email claim", async () => {
    const idToken = jwtWithPayload(JSON.stringify({ "cognito:username": "carol" }));
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", idToken, refreshToken: "r" }),
    );
    expect(result.stdout).toContain("Signed in as: carol");
  });

  it("reports 'unknown' when the id token has neither claim", async () => {
    const idToken = jwtWithPayload(JSON.stringify({ sub: "abc" }));
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", idToken, refreshToken: "r" }),
    );
    expect(result.stdout).toContain("Signed in as: unknown\n");
  });

  it("reports 'unknown' for a structurally malformed id token", async () => {
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", idToken: "not-a-jwt", refreshToken: "r" }),
    );
    expect(result.stdout).toContain("Signed in as: unknown\n");
  });

  it("reports 'unknown' when the payload segment is not valid JSON", async () => {
    const idToken = `${base64url("{}")}.not-base64url-json.sig`;
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", idToken, refreshToken: "r" }),
    );
    expect(result.stdout).toContain("Signed in as: unknown\n");
  });

  it("reports 'unknown' when the payload decodes to non-object JSON", async () => {
    const idToken = jwtWithPayload("42");
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", idToken, refreshToken: "r" }),
    );
    expect(result.stdout).toContain("Signed in as: unknown\n");
  });

  it("prints the access token expiry when present", async () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", refreshToken: "r", expiresAt }),
    );
    expect(result.stdout).toContain(`Access token expires: ${expiresAt.toISOString()}`);
  });

  it("omits the expiry line when there is none", async () => {
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", refreshToken: "r" }),
    );
    expect(result.stdout).not.toContain("Access token expires");
  });

  it("prints the token cache path", async () => {
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", refreshToken: "r" }),
    );
    expect(result.stdout).toContain("Token cache:");
  });

  it("reports MFA disabled when no methods are enabled", async () => {
    script.getMfaStatus.mockResolvedValueOnce({ enabled: [], preferred: undefined });
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", refreshToken: "r" }),
    );
    expect(result.stdout).toContain("MFA: disabled");
  });

  it("lists enabled MFA methods, marking the preferred one", async () => {
    script.getMfaStatus.mockResolvedValueOnce({
      enabled: ["SOFTWARE_TOKEN_MFA", "SMS_MFA"],
      preferred: "SOFTWARE_TOKEN_MFA",
    });
    const result = await statusWithTokens(
      new TokenSet({ accessToken: "a", refreshToken: "r" }),
    );
    expect(result.stdout).toContain("MFA methods:");
    expect(result.stdout).toContain("  SOFTWARE_TOKEN_MFA (preferred)");
    expect(result.stdout).toContain("  SMS_MFA\n");
  });
});

// ---------------------------------------------------------------------------
// auth change-password — mirrors Python's TestPasswordMismatch (first case)
// ---------------------------------------------------------------------------

describe("auth change-password", () => {
  async function signedInCache(): Promise<string> {
    const cache = await cachePath();
    await writeFile(
      cache,
      JSON.stringify({
        access_token: "a",
        id_token: "i",
        refresh_token: "r",
        expires_at: null,
      }),
    );
    script.getAccessToken.mockResolvedValueOnce("a");
    return cache;
  }

  it("changes the password when the confirmation matches", async () => {
    const cache = await signedInCache();
    stdin.enqueue("current").enqueue("new-pw").enqueue("new-pw");

    const result = await run(["change-password", "--token-cache", cache]);

    expect(result.exitCode).toBe(0);
    expect(script.changePassword).toHaveBeenCalledWith("current", "new-pw");
    expect(result.stdout).toContain("Password changed");
  });

  it("exits 1 without changing the password when confirmation does not match", async () => {
    const cache = await signedInCache();
    stdin.enqueue("current").enqueue("new-one").enqueue("new-two");

    const result = await run(["change-password", "--token-cache", cache]);

    expect(result.exitCode).toBe(1);
    expect(script.changePassword).not.toHaveBeenCalled();
    expect(result.stderr.toLowerCase()).toContain("did not match");
  });
});

// ---------------------------------------------------------------------------
// auth reset-password — mirrors Python's TestPasswordMismatch (second case)
// ---------------------------------------------------------------------------

describe("auth reset-password", () => {
  it("resets the password when the confirmation matches, using a masked destination", async () => {
    process.env["EVNEX_CLIENT_USERNAME"] = "alice@example.com";
    script.startPasswordReset.mockResolvedValueOnce("a***@e***");
    stdin.enqueue("123456").enqueue("new-pw").enqueue("new-pw");

    const result = await run(["reset-password"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("A reset code was sent to a***@e***");
    expect(script.confirmPasswordReset).toHaveBeenCalledWith(
      "alice@example.com",
      "123456",
      "new-pw",
    );
    expect(result.stdout).toContain(
      "Password reset; sign in again with the new password",
    );
  });

  it("reports checking email when the server gives no destination", async () => {
    process.env["EVNEX_CLIENT_USERNAME"] = "alice@example.com";
    script.startPasswordReset.mockResolvedValueOnce("");
    stdin.enqueue("123456").enqueue("new-pw").enqueue("new-pw");

    const result = await run(["reset-password"]);

    expect(result.stdout).toContain("A reset code was sent; check your email");
  });

  it("prompts for username when EVNEX_CLIENT_USERNAME is unset", async () => {
    script.startPasswordReset.mockResolvedValueOnce("");
    stdin.enqueue("typed-user").enqueue("123456").enqueue("new-pw").enqueue("new-pw");

    await run(["reset-password"]);

    expect(script.startPasswordReset).toHaveBeenCalledWith("typed-user");
  });

  it("exits 1 without resetting when confirmation does not match", async () => {
    process.env["EVNEX_CLIENT_USERNAME"] = "alice@example.com";
    script.startPasswordReset.mockResolvedValueOnce("");
    stdin.enqueue("123456").enqueue("new-one").enqueue("new-two");

    const result = await run(["reset-password"]);

    expect(result.exitCode).toBe(1);
    expect(script.confirmPasswordReset).not.toHaveBeenCalled();
    expect(result.stderr.toLowerCase()).toContain("did not match");
  });
});

// ---------------------------------------------------------------------------
// auth mfa enable / enroll
// ---------------------------------------------------------------------------

describe("auth mfa enable", () => {
  async function signedInCache(): Promise<string> {
    const cache = await cachePath();
    await writeFile(
      cache,
      JSON.stringify({
        access_token: "a",
        id_token: "i",
        refresh_token: "r",
        expires_at: null,
      }),
    );
    script.getAccessToken.mockResolvedValueOnce("a");
    return cache;
  }

  it("enrolls, confirms, and sets TOTP as preferred", async () => {
    const cache = await signedInCache();
    script.beginTotpEnrollment.mockResolvedValueOnce(new TotpEnrollment("BASE32SECRET"));
    stdin.enqueue("123456");

    const result = await run([
      "mfa",
      "enable",
      "--token-cache",
      cache,
      "--device-name",
      "laptop",
      "--browser",
    ]);

    expect(result.exitCode).toBe(0);
    expect(script.confirmTotpEnrollment).toHaveBeenCalledWith("123456", {
      deviceName: "laptop",
    });
    expect(script.setMfaPreference).toHaveBeenCalledWith({ totp: true });
    expect(qrMock.showQr).toHaveBeenCalledWith(
      expect.stringContaining("otpauth://totp/"),
      { openBrowser: true },
    );
    expect(result.stdout).toContain("BASE32SECRET");
    expect(result.stdout).toContain(
      "TOTP device registered and set as the preferred MFA method",
    );
  });

  it("uses evnex-account as the enrollment label when no username is set", async () => {
    const cache = await signedInCache();
    script.beginTotpEnrollment.mockResolvedValueOnce(new TotpEnrollment("SECRET"));
    stdin.enqueue("123456");

    await run(["mfa", "enable", "--token-cache", cache]);

    expect(qrMock.showQr).toHaveBeenCalledWith(expect.stringContaining("evnex-account"), {
      openBrowser: false,
    });
  });

  it("uses EVNEX_CLIENT_USERNAME as the enrollment label when set", async () => {
    const cache = await signedInCache();
    process.env["EVNEX_CLIENT_USERNAME"] = "dana@example.com";
    script.beginTotpEnrollment.mockResolvedValueOnce(new TotpEnrollment("SECRET"));
    stdin.enqueue("123456");

    await run(["mfa", "enable", "--token-cache", cache]);

    expect(qrMock.showQr).toHaveBeenCalledWith(
      // "@" is percent-encoded by TotpEnrollment.provisioningUri's Python-quote-style encoder.
      expect.stringContaining("dana%40example.com"),
      { openBrowser: false },
    );
  });
});

describe("auth mfa enroll", () => {
  it("prints the enrollment details and the follow-up instruction, without confirming", async () => {
    const cache = await cachePath();
    await writeFile(
      cache,
      JSON.stringify({
        access_token: "a",
        id_token: "i",
        refresh_token: "r",
        expires_at: null,
      }),
    );
    script.getAccessToken.mockResolvedValueOnce("a");
    script.beginTotpEnrollment.mockResolvedValueOnce(new TotpEnrollment("SECRET2"));

    const result = await run(["mfa", "enroll", "--token-cache", cache]);

    expect(result.exitCode).toBe(0);
    expect(script.confirmTotpEnrollment).not.toHaveBeenCalled();
    expect(result.stdout).toContain("SECRET2");
    expect(result.stdout).toContain("Then run: evnex auth mfa confirm CODE");
    expect(qrMock.showQr).toHaveBeenCalledWith(expect.any(String), {
      openBrowser: false,
    });
  });
});

// ---------------------------------------------------------------------------
// auth mfa disable
// ---------------------------------------------------------------------------

describe("auth mfa disable", () => {
  it("disables MFA immediately with --yes, skipping the prompt", async () => {
    const cache = await cachePath();
    await writeFile(
      cache,
      JSON.stringify({
        access_token: "a",
        id_token: "i",
        refresh_token: "r",
        expires_at: null,
      }),
    );
    script.getAccessToken.mockResolvedValueOnce("a");

    const result = await run(["mfa", "disable", "--yes", "--token-cache", cache]);

    expect(result.exitCode).toBe(0);
    expect(script.setMfaPreference).toHaveBeenCalledWith(undefined);
    expect(result.stdout).toContain("MFA disabled");
  });

  it("disables MFA when the interactive prompt is accepted", async () => {
    const cache = await cachePath();
    await writeFile(
      cache,
      JSON.stringify({
        access_token: "a",
        id_token: "i",
        refresh_token: "r",
        expires_at: null,
      }),
    );
    script.getAccessToken.mockResolvedValueOnce("a");
    stdin.enqueue("y");

    const result = await run(["mfa", "disable", "--token-cache", cache]);

    expect(result.exitCode).toBe(0);
    expect(script.setMfaPreference).toHaveBeenCalledWith(undefined);
  });

  it("aborts with exit 1 and never signs in when the prompt is declined", async () => {
    stdin.enqueue("n");

    const result = await run(["mfa", "disable", "--token-cache", await cachePath()]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Aborted.");
    expect(script.constructed).toHaveLength(0);
    expect(script.setMfaPreference).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// auth mfa confirm — mirrors test_confirm_no_prefer_sets_prefer_false and
// test_confirm_defaults_to_preferring
// ---------------------------------------------------------------------------

describe("auth mfa confirm", () => {
  async function signedInCache(): Promise<string> {
    const cache = await cachePath();
    await writeFile(
      cache,
      JSON.stringify({
        access_token: "a",
        id_token: "i",
        refresh_token: "r",
        expires_at: null,
      }),
    );
    script.getAccessToken.mockResolvedValueOnce("a");
    return cache;
  }

  it("defaults to preferring: confirms and sets TOTP as the preferred method", async () => {
    const cache = await signedInCache();

    const result = await run(["mfa", "confirm", "123456", "--token-cache", cache]);

    expect(result.exitCode).toBe(0);
    expect(script.confirmTotpEnrollment).toHaveBeenCalledWith("123456", {
      deviceName: "",
    });
    expect(script.setMfaPreference).toHaveBeenCalledWith({ totp: true });
    expect(result.stdout).toContain(
      "TOTP device registered and set as the preferred MFA method",
    );
  });

  it("--no-prefer confirms without touching the MFA preference", async () => {
    const cache = await signedInCache();

    const result = await run([
      "mfa",
      "confirm",
      "123456",
      "--token-cache",
      cache,
      "--no-prefer",
    ]);

    expect(result.exitCode).toBe(0);
    expect(script.confirmTotpEnrollment).toHaveBeenCalledWith("123456", {
      deviceName: "",
    });
    expect(script.setMfaPreference).not.toHaveBeenCalled();
    expect(result.stdout).toContain("TOTP device registered (MFA preference unchanged)");
  });

  it("passes --device-name through to confirmTotpEnrollment", async () => {
    const cache = await signedInCache();

    await run([
      "mfa",
      "confirm",
      "123456",
      "--token-cache",
      cache,
      "--device-name",
      "phone",
    ]);

    expect(script.confirmTotpEnrollment).toHaveBeenCalledWith("123456", {
      deviceName: "phone",
    });
  });
});
