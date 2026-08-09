import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveChallengeCode } from "../../src/cli/otp.js";
import type { OtpSource } from "../../src/cli/otp.js";
import { AuthChallenge } from "../../src/auth/challenge.js";
import { runCli } from "../support/cli.js";
import { FakeStdin, installFakeStdin } from "./fakeStdin.js";

const challenge = new AuthChallenge({
  name: "SOFTWARE_TOKEN_MFA",
  session: "session-token",
  username: "alice",
});

let stderr: string[];

beforeEach(() => {
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("--otp", () => {
  it("returns the code without touching stdin or --otp-command", async () => {
    const source: OtpSource = { otp: "654321", otpCommand: undefined };
    await expect(resolveChallengeCode(source, challenge)).resolves.toBe("654321");
  });

  it("is single-use: cleared after the first read", async () => {
    const source: OtpSource = { otp: "111111", otpCommand: undefined };
    await resolveChallengeCode(source, challenge);
    expect(source.otp).toBeUndefined();
  });

  it("falls through to the prompt on a second call, once consumed", async () => {
    const source: OtpSource = { otp: "111111", otpCommand: undefined };
    await resolveChallengeCode(source, challenge); // consumes it

    const stdin = new FakeStdin(false);
    const restore = installFakeStdin(stdin);
    try {
      const pending = resolveChallengeCode(source, challenge);
      stdin.push("222222\n");
      await expect(pending).resolves.toBe("222222");
    } finally {
      restore();
    }
  });
});

describe("--otp-command", () => {
  it("returns the trimmed stdout and notes the source on stderr", async () => {
    const source: OtpSource = { otp: undefined, otpCommand: "printf ' 123456 \\n'" };
    await expect(resolveChallengeCode(source, challenge)).resolves.toBe("123456");
    expect(stderr.join("")).toContain("Code obtained from --otp-command");
  });

  it("does not relay stderr from a successful run", async () => {
    const source: OtpSource = {
      otp: undefined,
      otpCommand: "echo noise 1>&2; printf '123456'",
    };
    await expect(resolveChallengeCode(source, challenge)).resolves.toBe("123456");
    expect(stderr.join("")).not.toContain("noise");
  });

  it("exits 1 and relays stderr on a non-zero exit", async () => {
    const source: OtpSource = {
      otp: undefined,
      otpCommand: "echo 'boom' 1>&2; exit 3",
    };
    const result = await runCli(async () => {
      await resolveChallengeCode(source, challenge);
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("boom");
    expect(result.stderr).toContain("--otp-command failed (exit 3)");
  });

  it("exits 1 without a stray blank line when the failing command produced no stderr", async () => {
    const source: OtpSource = { otp: undefined, otpCommand: "exit 2" };
    const result = await runCli(async () => {
      await resolveChallengeCode(source, challenge);
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("--otp-command failed (exit 2)\n");
  });

  it("exits 1 when the command succeeds but produces no code", async () => {
    const source: OtpSource = { otp: undefined, otpCommand: "true" };
    const result = await runCli(async () => {
      await resolveChallengeCode(source, challenge);
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--otp-command produced no code");
  });

  it("exits 1 when the command's output is only whitespace", async () => {
    const source: OtpSource = { otp: undefined, otpCommand: "printf '   \\n'" };
    const result = await runCli(async () => {
      await resolveChallengeCode(source, challenge);
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--otp-command produced no code");
  });
});

describe("prompt fallback", () => {
  it("prompts on stderr naming the challenge and reads the code from stdin", async () => {
    const source: OtpSource = { otp: undefined, otpCommand: undefined };
    const stdin = new FakeStdin(false);
    const restore = installFakeStdin(stdin);
    try {
      const pending = resolveChallengeCode(source, challenge);
      stdin.push("987654\n");
      await expect(pending).resolves.toBe("987654");
      expect(stderr.join("")).toBe(
        `Enter the 6-digit code (${challenge.name}): `,
      );
    } finally {
      restore();
    }
  });
});
