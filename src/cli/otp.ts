/**
 * `--otp` / `--otp-command` resolution — ported from `_challenge_code` in
 * `evnex/cli/_auth.py`.
 *
 * - `--otp` is single-use: consumed (cleared) on first read.
 * - `--otp-command` shells out (`node:child_process` `exec`, the `spawn` +
 *   shell analogue of Python's `asyncio.create_subprocess_shell`), trims
 *   stdout, exits 1 on a non-zero status or empty output, and relays the
 *   child's stderr.
 * - Otherwise prompts on stderr for a 6-digit code.
 */

import { exec } from "node:child_process";
import type { ExecException } from "node:child_process";
import { promisify } from "node:util";
import type { AuthChallenge } from "../auth/challenge.js";
import { promptLine } from "./prompt.js";

const execAsync = promisify(exec);

/** The subset of parsed CLI flags this module reads (and mutates: `otp` is cleared after use). */
export interface OtpSource {
  otp: string | undefined;
  otpCommand: string | undefined;
}

/** `child_process.exec`'s rejection carries `stdout`/`stderr` even though `ExecException` doesn't declare them. */
interface ExecError extends ExecException {
  readonly stdout: string;
  readonly stderr: string;
}

function isExecError(error: unknown): error is ExecError {
  return (
    error instanceof Error &&
    typeof (error as Partial<ExecError>).stdout === "string" &&
    typeof (error as Partial<ExecError>).stderr === "string"
  );
}

async function runOtpCommand(command: string): Promise<string> {
  let stdout: string;
  try {
    // Discarded on success, exactly like the Python original: stderr from a
    // *successful* run (e.g. a tool's informational chatter) is not
    // relayed, only stderr from a failing one (below).
    ({ stdout } = await execAsync(command));
  } catch (error) {
    if (!isExecError(error)) throw error;
    if (error.stderr.trim()) {
      process.stderr.write(`${error.stderr.replace(/\s+$/, "")}\n`);
    }
    process.stderr.write(`--otp-command failed (exit ${error.code ?? "unknown"})\n`);
    return process.exit(1);
  }

  const code = stdout.trim();
  if (!code) {
    process.stderr.write("--otp-command produced no code\n");
    return process.exit(1);
  }
  process.stderr.write("Code obtained from --otp-command\n");
  return code;
}

/** Resolve the code to answer `challenge` with, from `--otp`, `--otp-command`, or a prompt. */
export async function resolveChallengeCode(
  source: OtpSource,
  challenge: AuthChallenge,
): Promise<string> {
  if (source.otp !== undefined) {
    const code = source.otp;
    source.otp = undefined; // a code is single-use
    return code;
  }

  if (source.otpCommand !== undefined) {
    return await runOtpCommand(source.otpCommand);
  }

  return await promptLine(`Enter the 6-digit code (${challenge.name}): `);
}
