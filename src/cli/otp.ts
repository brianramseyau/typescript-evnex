/**
 * `--otp` / `--otp-command` resolution — ported from `_challenge_code` in
 * `evnex/cli/_auth.py`.
 *
 * TODO(A10): implement.
 *
 * - `--otp` is single-use: consumed (cleared) on first read.
 * - `--otp-command` shells out, trims stdout, exits 1 on a non-zero status
 *   or empty output, and relays the child's stderr.
 * - Otherwise prompts on stderr for a 6-digit code.
 */

import type { AuthChallenge } from "../auth/challenge.js";

/** The subset of parsed CLI flags this module reads (and mutates: `otp` is cleared after use). */
export interface OtpSource {
  otp: string | undefined;
  otpCommand: string | undefined;
}

/** Resolve the code to answer `challenge` with, from `--otp`, `--otp-command`, or a prompt. */
export async function resolveChallengeCode(
  source: OtpSource,
  challenge: AuthChallenge,
): Promise<string> {
  throw new Error("TODO(A10)");
}
