/**
 * Auth commands — ported from the `cmd_*` functions and `add_auth_commands`
 * in `evnex/cli/_auth.py` (PLAN.md §5 C2).
 *
 * Commands: `auth login`, `auth logout`, `auth status`,
 * `auth change-password`, `auth reset-password`,
 * `auth mfa enable|disable|enroll|confirm`.
 *
 * `signedInAuth` is the shared entry point every session-needing command
 * (here and in `resources.ts` / `charge.ts`) uses: load the cached tokens,
 * try `getAccessToken()`, and on `ReauthenticationRequiredError` fall back
 * to interactive sign-in, looping over challenges until a `TokenSet` comes
 * back. Credentials come from `EVNEX_CLIENT_USERNAME` /
 * `EVNEX_CLIENT_PASSWORD` or prompts.
 *
 * `--no-prefer` is declared (below, on `mfa confirm`) as a plain boolean —
 * `parseArgs` has no `store_false`/negation support — and inverted here in
 * `runMfaConfirm`, matching `parser.ts`'s documented convention.
 */

import { EvnexAuth, isAuthChallenge } from "../../auth/index.js";
import type { AuthChallenge, TokenSet, TotpEnrollment } from "../../auth/index.js";
import { ReauthenticationRequiredError } from "../../errors.js";
import type { OtpSource } from "../otp.js";
import { resolveChallengeCode } from "../otp.js";
import { cacheFlags, otpFlags } from "../parser.js";
import type { Command, ParsedArgs } from "../parser.js";
import { promptConfirm, promptLine, promptSecret } from "../prompt.js";
import { showQr } from "../qr.js";
import { createTokenSaver, loadTokens, removeTokenCache } from "../tokenCache.js";

// -- ParsedArgs flag readers --------------------------------------------------

/**
 * A flag declared with `type: "string"` (with or without a default), read
 * back as a string. Every call site below reads a flag from a group that
 * was actually attached to the command it belongs to, so `parseArgs` has
 * always populated (default or explicit) it by the time `run` is invoked —
 * this is a type-narrowing cast, not a runtime check.
 */
function stringFlag(args: ParsedArgs, name: string): string {
  return args[name] as string;
}

/** An optional string flag with no default, e.g. `--otp`. */
function optionalStringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

/** A boolean flag: `true` when passed on the command line, otherwise `false`. */
function boolFlag(args: ParsedArgs, name: string): boolean {
  return args[name] === true;
}

// -- Credentials ---------------------------------------------------------------

async function resolveUsername(): Promise<string> {
  const fromEnv = process.env["EVNEX_CLIENT_USERNAME"];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return promptLine("EVNEX username: ");
}

async function resolvePassword(): Promise<string> {
  const fromEnv = process.env["EVNEX_CLIENT_PASSWORD"];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return promptSecret("EVNEX password: ");
}

// -- Shared sign-in entry point -------------------------------------------------

/** Return an `EvnexAuth` with a usable session, signing in interactively if needed. */
export async function signedInAuth(args: ParsedArgs): Promise<EvnexAuth> {
  const cachePath = stringFlag(args, "tokenCache");
  const auth = new EvnexAuth({
    tokens: loadTokens(cachePath),
    onTokenUpdate: createTokenSaver(cachePath),
  });

  if (auth.tokens !== undefined) {
    try {
      await auth.getAccessToken();
      return auth;
    } catch (error) {
      if (!(error instanceof ReauthenticationRequiredError)) throw error;
      process.stderr.write("Cached session expired; signing in again\n");
    }
  }

  const username = await resolveUsername();
  const password = await resolvePassword();
  const otpSource: OtpSource = {
    otp: optionalStringFlag(args, "otp"),
    otpCommand: optionalStringFlag(args, "otpCommand"),
  };

  let result: TokenSet | AuthChallenge = await auth.startAuthentication(
    username,
    password,
  );
  while (isAuthChallenge(result)) {
    const code = await resolveChallengeCode(otpSource, result);
    result = await auth.respondToChallenge(result, code);
  }

  process.stderr.write(`Signed in as ${username}; session cached at ${cachePath}\n`);
  return auth;
}

// -- QR / enrollment display ----------------------------------------------------

function enrollmentAccountName(): string {
  const username = process.env["EVNEX_CLIENT_USERNAME"];
  return username !== undefined && username.length > 0 ? username : "evnex-account";
}

/** Print the otpauth URI, bare secret, and QR code for a TOTP enrollment. */
async function printEnrollment(
  enrollment: TotpEnrollment,
  openBrowser: boolean,
): Promise<void> {
  const uri = enrollment.provisioningUri(enrollmentAccountName());
  process.stdout.write("Scan the QR code with your authenticator app, or paste the\n");
  process.stdout.write(
    "otpauth URI into a password manager's one-time password field:\n\n",
  );
  process.stdout.write(`  ${uri}\n\n`);
  process.stdout.write(`(bare secret for manual entry: ${enrollment.secret})\n\n`);
  await showQr(uri, { openBrowser });
}

// -- Unverified id-token claim decode (for `auth status`) ----------------------

/**
 * Best-effort, unverified decode of a JWT's payload segment — mirrors
 * Python's `jwt.decode(..., options={"verify_signature": False})`, which is
 * swallowed into `claims = {}` on any decode failure. `src/auth/jwt.ts`
 * exports only `decodeExpiry` (the `exp`-claim-specific reader), not a
 * generic claim decoder, so this is original (small) logic, not a
 * duplicate of anything this agent owns elsewhere.
 */
function decodeIdTokenClaims(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return {};
  try {
    // parts.length === 3 guarantees index 1 exists.
    const json = Buffer.from(parts[1]!, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// -- Command handlers ------------------------------------------------------------

async function runLogin(args: ParsedArgs): Promise<void> {
  await signedInAuth(args);
}

async function runLogout(args: ParsedArgs): Promise<void> {
  const cachePath = stringFlag(args, "tokenCache");
  const removed = await removeTokenCache(cachePath);
  process.stdout.write(
    removed ? `Removed cached session at ${cachePath}\n` : "No cached session\n",
  );
}

async function runStatus(args: ParsedArgs): Promise<void> {
  const auth = await signedInAuth(args);
  const tokens = auth.tokens;

  let identity = "unknown (no identity token cached)";
  if (tokens !== undefined && tokens.idToken !== undefined && tokens.idToken !== "") {
    const claims = decodeIdTokenClaims(tokens.idToken);
    const email = typeof claims["email"] === "string" ? claims["email"] : undefined;
    const cognitoUsername =
      typeof claims["cognito:username"] === "string"
        ? claims["cognito:username"]
        : undefined;
    identity = email ?? cognitoUsername ?? "unknown";
  }
  process.stdout.write(`Signed in as: ${identity}\n`);

  if (tokens !== undefined && tokens.expiresAt !== undefined) {
    process.stdout.write(`Access token expires: ${tokens.expiresAt.toISOString()}\n`);
  }
  process.stdout.write(`Token cache: ${stringFlag(args, "tokenCache")}\n`);

  const status = await auth.getMfaStatus();
  if (status.enabled.length === 0) {
    process.stdout.write("MFA: disabled\n");
    return;
  }
  process.stdout.write("MFA methods:\n");
  for (const method of status.enabled) {
    const marker = method === status.preferred ? " (preferred)" : "";
    process.stdout.write(`  ${method}${marker}\n`);
  }
}

async function runChangePassword(args: ParsedArgs): Promise<void> {
  const auth = await signedInAuth(args);
  const current = await promptSecret("Current password: ");
  const next = await promptSecret("New password: ");
  const confirm = await promptSecret("Confirm new password: ");
  if (next !== confirm) {
    process.stderr.write("New passwords did not match. Aborted.\n");
    process.exit(1);
  }
  await auth.changePassword(current, next);
  process.stdout.write("Password changed\n");
}

// The forgot-password flow needs no signed-in session (and no --token-cache
// / --otp*: `reset-password` declares no flag groups at all, below).
async function runResetPassword(_args: ParsedArgs): Promise<void> {
  const auth = new EvnexAuth();
  const username = await resolveUsername();
  const destination = await auth.startPasswordReset(username);
  process.stdout.write(
    destination
      ? `A reset code was sent to ${destination}\n`
      : "A reset code was sent; check your email\n",
  );
  const code = await promptLine("Enter the reset code: ");
  const next = await promptSecret("New password: ");
  const confirm = await promptSecret("Confirm new password: ");
  if (next !== confirm) {
    process.stderr.write("New passwords did not match. Aborted.\n");
    process.exit(1);
  }
  await auth.confirmPasswordReset(username, code, next);
  process.stdout.write("Password reset; sign in again with the new password\n");
}

async function runMfaEnable(args: ParsedArgs): Promise<void> {
  const auth = await signedInAuth(args);
  const enrollment = await auth.beginTotpEnrollment();
  await printEnrollment(enrollment, boolFlag(args, "browser"));

  const code = await promptLine("Enter a code from the new device: ");
  await auth.confirmTotpEnrollment(code, { deviceName: stringFlag(args, "deviceName") });
  await auth.setMfaPreference({ totp: true });
  process.stdout.write("TOTP device registered and set as the preferred MFA method\n");
}

async function runMfaDisable(args: ParsedArgs): Promise<void> {
  if (!boolFlag(args, "yes")) {
    const confirmed = await promptConfirm("Disable MFA on this account? [y/N] ");
    if (!confirmed) {
      process.stderr.write("Aborted.\n");
      process.exit(1);
    }
  }
  const auth = await signedInAuth(args);
  await auth.setMfaPreference();
  process.stdout.write("MFA disabled\n");
}

async function runMfaEnroll(args: ParsedArgs): Promise<void> {
  const auth = await signedInAuth(args);
  const enrollment = await auth.beginTotpEnrollment();
  await printEnrollment(enrollment, boolFlag(args, "browser"));
  process.stdout.write("\nThen run: evnex auth mfa confirm CODE [--device-name NAME]\n");
}

async function runMfaConfirm(args: ParsedArgs): Promise<void> {
  const auth = await signedInAuth(args);
  // The `totp-code` positional is required (the default), so the router
  // already exited 2 before `run` was ever invoked if it were missing.
  const totpCode = args.positionals[0]!;
  await auth.confirmTotpEnrollment(totpCode, {
    deviceName: stringFlag(args, "deviceName"),
  });

  const prefer = !boolFlag(args, "noPrefer");
  if (prefer) {
    await auth.setMfaPreference({ totp: true });
    process.stdout.write("TOTP device registered and set as the preferred MFA method\n");
  } else {
    process.stdout.write("TOTP device registered (MFA preference unchanged)\n");
  }
}

// -- Command tree ------------------------------------------------------------

/** The `auth` command group: login, logout, status, change-password, reset-password, mfa. */
export function createAuthCommand(): Command {
  const login: Command = {
    name: "login",
    help: "sign in (using cached tokens when valid) and cache session tokens",
    flags: [cacheFlags, otpFlags],
    run: runLogin,
  };

  const logout: Command = {
    name: "logout",
    help: "delete the cached session tokens",
    flags: [cacheFlags],
    run: runLogout,
  };

  const status: Command = {
    name: "status",
    help: "show the signed-in user, session, and enabled MFA methods",
    flags: [cacheFlags, otpFlags],
    run: runStatus,
  };

  const changePassword: Command = {
    name: "change-password",
    help: "change the account password (prompts for current and new)",
    flags: [cacheFlags, otpFlags],
    run: runChangePassword,
  };

  const resetPassword: Command = {
    name: "reset-password",
    help: "reset a forgotten password via an emailed code (no sign-in)",
    run: runResetPassword,
  };

  const mfaEnable: Command = {
    name: "enable",
    help: "enroll a new TOTP device and make it the preferred MFA method",
    description:
      "Interactive one-shot: prints the otpauth:// URI, bare secret, and " +
      "a QR code, prompts for a code from the new device, then registers " +
      "it and makes TOTP the preferred MFA method. Enrolling a new device " +
      "replaces any previously registered one.",
    flags: [
      cacheFlags,
      otpFlags,
      {
        flags: [
          {
            name: "device-name",
            type: "string",
            default: "",
            help: "friendly device name",
          },
          {
            name: "browser",
            type: "boolean",
            help: "also open the QR code in a browser",
          },
        ],
      },
    ],
    run: runMfaEnable,
  };

  const mfaDisable: Command = {
    name: "disable",
    help: "turn MFA off for the account",
    description: "Disable all MFA methods for the account.",
    flags: [
      cacheFlags,
      otpFlags,
      {
        flags: [
          {
            name: "yes",
            type: "boolean",
            short: "y",
            help: "skip the confirmation prompt",
          },
        ],
      },
    ],
    run: runMfaDisable,
  };

  const mfaEnroll: Command = {
    name: "enroll",
    help: "print a TOTP enrollment URI/secret/QR and exit (for automation)",
    description:
      "Plumbing command: start enrolling a TOTP device and print the " +
      "otpauth:// URI, bare secret, and QR code, then exit. Complete " +
      "enrollment with 'evnex auth mfa confirm CODE'.",
    flags: [
      cacheFlags,
      otpFlags,
      {
        flags: [
          {
            name: "browser",
            type: "boolean",
            help: "also open the QR code in a browser",
          },
        ],
      },
    ],
    run: runMfaEnroll,
  };

  const mfaConfirm: Command = {
    name: "confirm",
    help: "verify a code from a newly enrolled TOTP device (for automation)",
    description:
      "Plumbing command: verify a code generated by the newly enrolled " +
      "device. By default this also makes TOTP the preferred MFA method.",
    positionals: [{ name: "totp-code", help: "6-digit code from the new device" }],
    flags: [
      cacheFlags,
      otpFlags,
      {
        flags: [
          {
            name: "device-name",
            type: "string",
            default: "",
            help: "friendly device name",
          },
          {
            name: "no-prefer",
            type: "boolean",
            help: "register the device without changing the MFA preference",
          },
        ],
      },
    ],
    run: runMfaConfirm,
  };

  const mfa: Command = {
    name: "mfa",
    help: "manage multi-factor authentication devices",
    description: "Enable, disable, or (re)enroll TOTP multi-factor authentication.",
    children: [mfaEnable, mfaDisable, mfaEnroll, mfaConfirm],
  };

  return {
    name: "auth",
    help: "manage authentication and MFA for your EVNEX account",
    description:
      "Sign in and manage MFA and passwords for your EVNEX account. " +
      "Credentials come from EVNEX_CLIENT_USERNAME / EVNEX_CLIENT_PASSWORD " +
      "or prompts; session tokens are cached so an MFA code is only " +
      "needed once.",
    children: [login, logout, status, changePassword, resetPassword, mfa],
  };
}
