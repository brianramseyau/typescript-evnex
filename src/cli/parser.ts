/**
 * CLI command tree and `parseArgs`-based router — ported from
 * `evnex/cli/__init__.py`'s `build_parser` (PLAN.md §5 C1).
 *
 * No CLI framework: `node:util` `parseArgs` plus this in-house router
 * (PLAN.md §0). Resolution walks argv consuming child command names while
 * they match, then calls `parseArgs` on the remainder with the resolved
 * command's merged flag config and `allowPositionals: true`.
 *
 * TODO(C1): implement.
 *
 * - `strict: true` rejects undeclared options natively
 *   (`ERR_PARSE_ARGS_UNKNOWN_OPTION`) — attach flag groups per command
 *   exactly as the original does and the rejection comes for free.
 * - No negated flags in `parseArgs`: declare `--no-prefer` as a plain
 *   boolean `"no-prefer"` and invert it in the handler.
 * - No `choices`/type validation in `parseArgs`: validate against
 *   `PositionalSpec`/`FlagSpec` metadata in the router, and exit 2 with a
 *   usage message on failure, matching argparse.
 * - A command group with no leaf subcommand prints that group's help and
 *   exits 0.
 */

export interface FlagSpec {
  /** Long flag name, e.g. `"json"` for `--json`. */
  name: string;
  type: "string" | "boolean";
  /** Single-character alias, e.g. `"y"` for `-y`. */
  short?: string;
  default?: string | boolean;
  /** Enforced by the router; `parseArgs` itself has no `choices` support. */
  choices?: readonly string[];
  help: string;
}

/** A reusable set of flags attached to one or more commands, mirroring argparse "parents". */
export interface FlagGroup {
  flags: readonly FlagSpec[];
}

export interface PositionalSpec {
  name: string;
  required?: boolean;
  help?: string;
}

/**
 * The parsed result handed to a command's `run` — an `argparse.Namespace`
 * analogue. Flag values are keyed by their camelCase name (`--token-cache`
 * -> `args.tokenCache`); commands index it with the flags/positionals they
 * declared.
 */
export interface ParsedArgs {
  positionals: readonly string[];
  [flag: string]: string | boolean | readonly string[] | undefined;
}

export interface Command {
  name: string;
  /** One-line, for the parent's listing. */
  help: string;
  /** Longer, for this command's own `--help`. */
  description?: string;
  /** Composed, mirroring argparse "parents". */
  flags?: FlagGroup[];
  positionals?: PositionalSpec[];
  children?: Command[];
  run?: (args: ParsedArgs) => Promise<void>;
}

/**
 * Shared flag groups, mirroring the argparse "parent" parsers of
 * `evnex/cli/__init__.py`. Kept separate so commands that never sign in
 * (`logout`) or need no session at all (`reset-password`) reject them
 * instead of silently ignoring them.
 *
 * TODO(C1): populate the real flag definitions. These are left as
 * (type-checked) empty placeholders rather than throwing stubs, unlike the
 * rest of this codebase's stubs: they are plain data, and `vitest`'s
 * `coverage.all: true` (PLAN.md §6.1) imports every `src/**` file to
 * establish baseline coverage, so a throw at module-evaluation time here
 * would crash the whole test run, not just callers of one function.
 */

/** `--token-cache`, for commands that read or write the token cache. */
export const cacheFlags: FlagGroup = { flags: [] };

/** `--otp` / `--otp-command`, for commands that may need to answer a sign-in MFA challenge. */
export const otpFlags: FlagGroup = { flags: [] };

/** `--json`, for every command that can emit a machine-readable document. */
export const jsonFlag: FlagGroup = { flags: [] };

/** `--charge-point`, for commands that operate on a single, selectable charge point. */
export const chargePointFlag: FlagGroup = { flags: [] };

/** The full `evnex` command tree. */
export function buildParser(): Command {
  throw new Error("TODO(C1)");
}

/** Resolve `argv` against `root`, parse flags, and invoke the matched command. */
export async function dispatch(root: Command, argv: readonly string[]): Promise<void> {
  throw new Error("TODO(C1)");
}
