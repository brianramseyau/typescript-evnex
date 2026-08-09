#!/usr/bin/env -S npx tsx
/**
 * Sign in (answering MFA if the account has it enabled) and print the
 * session tokens — a port of python-evnex's `examples/get_token.py`.
 *
 * Also demonstrates resuming a previous session from `EVNEX_ACCESS_TOKEN` /
 * `EVNEX_REFRESH_TOKEN` instead of a username/password + MFA prompt, and
 * `onTokenUpdate`, the hook a real application uses to persist freshly
 * issued tokens (the CLI's own `--token-cache` does exactly this — see
 * `src/cli/tokenCache.ts`).
 *
 * Required: EVNEX_CLIENT_USERNAME, EVNEX_CLIENT_PASSWORD (unless resuming
 * via EVNEX_ACCESS_TOKEN / EVNEX_REFRESH_TOKEN instead).
 *
 * Note: logging tokens at all — as this script's final three lines do — is
 * something a real application should never do; it is done here only so a
 * one-shot example script has something to show for itself.
 */

import { createInterface } from "node:readline/promises";
import { Evnex } from "../src/index.js";
import { EvnexAuth, isAuthChallenge, TokenSet } from "../src/auth/index.js";
import type { AuthChallenge } from "../src/auth/index.js";

async function saveTokens(_tokens: TokenSet): Promise<void> {
  // A real application would persist these atomically.
  console.log("New tokens issued; persist them for next time");
}

/** The `input()` analogue: prompt on stdout, read one line from stdin. */
async function promptForCode(challengeName: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`Enter the code for challenge ${challengeName}: `);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  let tokens: TokenSet | undefined;
  const accessToken = process.env["EVNEX_ACCESS_TOKEN"];
  const refreshToken = process.env["EVNEX_REFRESH_TOKEN"];
  if (accessToken || refreshToken) {
    tokens = new TokenSet({ accessToken, refreshToken });
  }

  const auth = new EvnexAuth({ tokens, onTokenUpdate: saveTokens });

  if (tokens === undefined) {
    let result: TokenSet | AuthChallenge = await auth.startAuthentication(
      process.env["EVNEX_CLIENT_USERNAME"]!,
      process.env["EVNEX_CLIENT_PASSWORD"]!,
    );
    while (isAuthChallenge(result)) {
      const code = await promptForCode(result.name);
      result = await auth.respondToChallenge(result, code);
    }
  }

  const evnex = new Evnex({ auth });
  const user = await evnex.getUserDetail();
  console.log("User Name:", user.name || user.email);

  console.log("Access Token: ", auth.tokens?.accessToken);
  console.log("Refresh Token: ", auth.tokens?.refreshToken);
  console.log("Expires At: ", auth.tokens?.expiresAt);
}

await main();
