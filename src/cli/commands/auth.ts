/**
 * Auth commands — ported from the `cmd_*` functions and `add_auth_commands`
 * in `evnex/cli/_auth.py` (PLAN.md §5 C2).
 *
 * Commands: `auth login`, `auth logout`, `auth status`,
 * `auth change-password`, `auth reset-password`,
 * `auth mfa enable|disable|enroll|confirm`.
 *
 * TODO(C2): implement.
 *
 * `signedInAuth` is the shared entry point every session-needing command
 * (here and in `resources.ts` / `charge.ts`) uses: load the cached tokens,
 * try `getAccessToken()`, and on `ReauthenticationRequiredError` fall back
 * to interactive sign-in, looping over challenges until a `TokenSet` comes
 * back. Credentials come from `EVNEX_CLIENT_USERNAME` /
 * `EVNEX_CLIENT_PASSWORD` or prompts.
 */

import type { EvnexAuth } from "../../auth/index.js";
import type { Command, ParsedArgs } from "../parser.js";

/** Return an `EvnexAuth` with a usable session, signing in interactively if needed. */
export async function signedInAuth(args: ParsedArgs): Promise<EvnexAuth> {
  throw new Error("TODO(C2)");
}

/** The `auth` command group: login, logout, status, change-password, reset-password, mfa. */
export function createAuthCommand(): Command {
  throw new Error("TODO(C2)");
}
