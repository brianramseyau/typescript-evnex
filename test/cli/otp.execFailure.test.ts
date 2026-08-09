/**
 * The `--otp-command` failure branches, which need `exec` itself to misbehave.
 *
 * `node:child_process` is mocked here rather than in `otp.test.ts` because the
 * mock has to be in place before `otp.ts` promisifies `exec` at module load,
 * and the rest of that suite wants the real thing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execMock = vi.fn();

vi.mock("node:child_process", () => ({
  exec: (command: string, callback: (...args: unknown[]) => void) =>
    execMock(command, callback),
}));

const { resolveChallengeCode } = await import("../../src/cli/otp.js");
const { AuthChallenge } = await import("../../src/auth/challenge.js");

const challenge = new AuthChallenge({
  name: "SOFTWARE_TOKEN_MFA",
  session: "session-token",
  username: "alice",
});

let stderr: string[];

beforeEach(() => {
  stderr = [];
  execMock.mockReset();
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("--otp-command when exec fails", () => {
  it("rethrows a rejection that is not an exec failure", async () => {
    // No stdout/stderr on the error, so it is not the shape `exec` produces —
    // the child never ran, and swallowing it would report a misleading
    // "command failed" instead of the real fault.
    execMock.mockImplementation((_command, callback: (...a: unknown[]) => void) => {
      callback(new Error("spawn machinery broke"));
    });

    await expect(
      resolveChallengeCode({ otp: undefined, otpCommand: "op item get X --otp" }, challenge),
    ).rejects.toThrow("spawn machinery broke");
    expect(stderr.join("")).toBe("");
  });

  it("reports an unknown exit when the child was killed by a signal", async () => {
    // A signalled child carries `signal` and a null `code`, so the exit status
    // has nothing to report.
    const error = Object.assign(new Error("killed"), {
      stdout: "",
      stderr: "",
      signal: "SIGTERM",
    });
    execMock.mockImplementation((_command, callback: (...a: unknown[]) => void) => {
      callback(error);
    });

    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("exited");
      }) as never);

    await expect(
      resolveChallengeCode({ otp: undefined, otpCommand: "otp-tool" }, challenge),
    ).rejects.toThrow("exited");
    expect(stderr.join("")).toContain("--otp-command failed (exit unknown)");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
