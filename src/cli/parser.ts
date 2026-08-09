/**
 * CLI command tree and `parseArgs`-based router — ported from
 * `evnex/cli/__init__.py`'s `build_parser` (PLAN.md §5 C1).
 *
 * No CLI framework: `node:util` `parseArgs` plus this in-house router
 * (PLAN.md §0). Resolution walks argv consuming child command names while
 * they match, then calls `parseArgs` on the remainder with the resolved
 * command's merged flag config and `allowPositionals: true`.
 *
 * - `strict: true` rejects undeclared options natively
 *   (`ERR_PARSE_ARGS_UNKNOWN_OPTION`) — attach flag groups per command
 *   exactly as the original does and the rejection comes for free.
 * - No negated flags in `parseArgs`: declare `--no-prefer` as a plain
 *   boolean `"no-prefer"` and invert it in the handler.
 * - No `choices`/type validation in `parseArgs`: validated against
 *   `PositionalSpec`/`FlagSpec` metadata here in the router, exiting 2 with
 *   a usage message on failure, matching argparse.
 * - A command group with no leaf subcommand prints that group's help and
 *   exits 0.
 *
 * `buildParser()` wires in the real command tree from `./commands/*.js`
 * (C2/C3/C4's `createAuthCommand` / `createResourceCommands` /
 * `createChargeCommand`) — those agents attach their commands purely by
 * implementing the functions this file already calls, never by editing this
 * file. It also accepts an explicit top-level command list, so the router
 * itself (resolution, `strict` rejection, validation, help generation) is
 * fully testable against synthetic trees without depending on those other
 * modules being implemented yet.
 */

import { parseArgs } from "node:util";
import type { ParseArgsOptionDescriptor, ParseArgsOptionsConfig } from "node:util";
import { resolvePackageVersion } from "../http/transport.js";
import { defaultTokenCachePath } from "./tokenCache.js";
import { createAuthCommand } from "./commands/auth.js";
import { createChargeCommand } from "./commands/charge.js";
import { createResourceCommands } from "./commands/resources.js";

export interface FlagSpec {
  /** Long flag name, e.g. `"json"` for `--json`. */
  name: string;
  type: "string" | "boolean";
  /** Single-character alias, e.g. `"y"` for `-y`. */
  short?: string;
  default?: string | boolean;
  /** Enforced by the router; `parseArgs` itself has no `choices` support. */
  choices?: readonly string[];
  /**
   * Extra validation `choices` can't express (e.g. "positive integer" for
   * `--limit`). Return an error message to reject the value, `undefined` to
   * accept it. Enforced by the router, after `choices`.
   */
  validate?: (raw: string) => string | undefined;
  help: string;
}

/** A reusable set of flags attached to one or more commands, mirroring argparse "parents". */
export interface FlagGroup {
  flags: readonly FlagSpec[];
}

export interface PositionalSpec {
  name: string;
  /** Defaults to `true` — matches argparse positionals, which are required unless `nargs="?"`. */
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
 */

/** `--token-cache`, for commands that read or write the token cache. */
export const cacheFlags: FlagGroup = {
  flags: [
    {
      name: "token-cache",
      type: "string",
      default: defaultTokenCachePath(),
      help: `where to cache session tokens (default: ${defaultTokenCachePath()})`,
    },
  ],
};

/** `--otp` / `--otp-command`, for commands that may need to answer a sign-in MFA challenge. */
export const otpFlags: FlagGroup = {
  flags: [
    {
      name: "otp",
      type: "string",
      help: "6-digit code to answer a sign-in MFA challenge non-interactively",
    },
    {
      name: "otp-command",
      type: "string",
      help:
        "shell command printing a current MFA code, e.g. " +
        "'op item get Evnex --otp' with the 1Password CLI",
    },
  ],
};

/** `--json`, for every command that can emit a machine-readable document. */
export const jsonFlag: FlagGroup = {
  flags: [
    { name: "json", type: "boolean", help: "emit machine-readable JSON on stdout" },
  ],
};

/**
 * `--charge-point`, for commands that operate on a single, selectable
 * charge point.
 *
 * The upstream Python help text is a copy/paste bug — "a part of its name or
 * serial of its name or serial" repeats itself (`evnex/cli/_resources.py`'s
 * `cp_flag.add_argument`). This is a wording-only fix, reported rather than
 * silently carried over or silently "corrected" without a note (see the
 * agent's final report).
 */
export const chargePointFlag: FlagGroup = {
  flags: [
    {
      name: "charge-point",
      type: "string",
      help: "charge point id, or a part of its name or serial",
    },
  ],
};

const HELP_SPEC: FlagSpec = {
  name: "help",
  type: "boolean",
  short: "h",
  help: "show this help message and exit",
};

const VERSION_SPEC: FlagSpec = {
  name: "version",
  type: "boolean",
  help: "show program's version number and exit",
};

/** All declared flags for `command`, its groups flattened, plus the always-available `--help`. */
function mergedFlagSpecs(command: Command): FlagSpec[] {
  const declared = (command.flags ?? []).flatMap((group) => group.flags);
  return [...declared, HELP_SPEC];
}

function toParseArgsOptions(specs: readonly FlagSpec[]): ParseArgsOptionsConfig {
  const options: ParseArgsOptionsConfig = {};
  for (const spec of specs) {
    const descriptor: ParseArgsOptionDescriptor = { type: spec.type };
    if (spec.short !== undefined) descriptor.short = spec.short;
    if (spec.default !== undefined) descriptor.default = spec.default;
    options[spec.name] = descriptor;
  }
  return options;
}

/** `--token-cache` -> `tokenCache`, matching {@link ParsedArgs}'s documented convention. */
function toCamelCase(kebab: string): string {
  return kebab.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function buildParsedArgs(
  specs: readonly FlagSpec[],
  values: Record<string, string | boolean | (string | boolean)[] | undefined>,
  positionals: readonly string[],
): ParsedArgs {
  const args: Record<string, string | boolean | undefined> = {};
  for (const spec of specs) {
    const raw = values[spec.name];
    // `multiple` is never set on any declared flag, so `raw` is always a
    // scalar at runtime; the array branch of parseArgs's return type is
    // structurally possible but never actually produced here.
    if (typeof raw === "string" || typeof raw === "boolean") {
      args[toCamelCase(spec.name)] = raw;
    }
  }
  return { ...args, positionals: [...positionals] };
}

function commandLabel(path: readonly string[]): string {
  return ["evnex", ...path].join(" ");
}

function formatUsageLine(command: Command, path: readonly string[]): string {
  const parts = ["usage:", commandLabel(path)];
  for (const spec of mergedFlagSpecs(command)) {
    const body = spec.type === "boolean" ? `--${spec.name}` : `--${spec.name} <value>`;
    parts.push(`[${body}]`);
  }
  if (command.children !== undefined && command.children.length > 0) {
    parts.push(`{${command.children.map((child) => child.name).join(",")}}`);
  }
  for (const spec of command.positionals ?? []) {
    parts.push(spec.required === false ? `[${spec.name}]` : spec.name);
  }
  return parts.join(" ");
}

/** Print a usage line, an `error:` diagnostic, and exit 2 — the argparse contract for bad input. */
function printUsageError(
  command: Command,
  path: readonly string[],
  message: string,
): never {
  process.stderr.write(`${formatUsageLine(command, path)}\n`);
  process.stderr.write(`${commandLabel(path)}: error: ${message}\n`);
  process.exit(2);
}

/** Render `command`'s own help text (usage, subcommands, positionals, options). */
export function formatHelp(command: Command, path: readonly string[] = []): string {
  const lines: string[] = [];
  lines.push(`${commandLabel(path)} - ${command.description ?? command.help}`);
  lines.push("");
  lines.push(formatUsageLine(command, path));

  if (command.children !== undefined && command.children.length > 0) {
    lines.push("");
    lines.push("Commands:");
    const width = Math.max(...command.children.map((child) => child.name.length));
    for (const child of command.children) {
      lines.push(`  ${child.name.padEnd(width)}  ${child.help}`);
    }
  }

  if (command.positionals !== undefined && command.positionals.length > 0) {
    lines.push("");
    lines.push("Positional arguments:");
    for (const spec of command.positionals) {
      lines.push(
        spec.help !== undefined ? `  ${spec.name}  ${spec.help}` : `  ${spec.name}`,
      );
    }
  }

  lines.push("");
  lines.push("Options:");
  for (const spec of mergedFlagSpecs(command)) {
    const flagLabel =
      spec.short !== undefined ? `-${spec.short}, --${spec.name}` : `--${spec.name}`;
    const valueLabel = spec.type === "boolean" ? "" : " <value>";
    const choicesLabel =
      spec.choices !== undefined ? ` (choices: ${spec.choices.join(", ")})` : "";
    lines.push(`  ${flagLabel}${valueLabel}  ${spec.help}${choicesLabel}`);
  }
  lines.push("");

  return lines.join("\n");
}

interface Resolution {
  command: Command;
  path: string[];
  remaining: string[];
}

/** Walk `argv` from `root`, consuming child command names while they match. */
function resolvePath(root: Command, argv: readonly string[]): Resolution {
  let current = root;
  const path: string[] = [];
  let index = 0;
  while (current.children !== undefined && current.children.length > 0) {
    const token = argv[index];
    if (token === undefined || token.startsWith("-")) break;
    const child = current.children.find((candidate) => candidate.name === token);
    if (child === undefined) {
      const choices = current.children
        .map((candidate) => `'${candidate.name}'`)
        .join(", ");
      printUsageError(
        current,
        path,
        `argument command: invalid choice: '${token}' (choose from ${choices})`,
      );
    }
    current = child;
    path.push(token);
    index += 1;
  }
  return { command: current, path, remaining: argv.slice(index) };
}

function validatePositionals(
  command: Command,
  path: readonly string[],
  parsed: ParsedArgs,
): void {
  const specs = command.positionals ?? [];
  if (parsed.positionals.length > specs.length) {
    const extra = parsed.positionals.slice(specs.length).join(" ");
    printUsageError(command, path, `unrecognized arguments: ${extra}`);
  }
  specs.forEach((spec, index) => {
    const required = spec.required !== false;
    if (required && parsed.positionals[index] === undefined) {
      printUsageError(
        command,
        path,
        `the following arguments are required: ${spec.name}`,
      );
    }
  });
}

function validateFlags(
  command: Command,
  path: readonly string[],
  parsed: ParsedArgs,
  specs: readonly FlagSpec[],
): void {
  for (const spec of specs) {
    const value = parsed[toCamelCase(spec.name)];
    if (typeof value !== "string") continue;
    if (spec.choices !== undefined && !spec.choices.includes(value)) {
      const choices = spec.choices.map((choice) => `'${choice}'`).join(", ");
      printUsageError(
        command,
        path,
        `argument --${spec.name}: invalid choice: '${value}' (choose from ${choices})`,
      );
    }
    if (spec.validate !== undefined) {
      const error = spec.validate(value);
      if (error !== undefined) {
        printUsageError(command, path, `argument --${spec.name}: ${error}`);
      }
    }
  }
}

/**
 * The full `evnex` command tree: `auth`, the resource read commands, and
 * `charge`, wired in from `./commands/*.js`. `topLevel` defaults to that real
 * tree but can be overridden — the router's own tests do, so they never
 * depend on C2/C3/C4's commands being implemented.
 */
export function buildParser(
  topLevel: readonly Command[] = defaultTopLevelCommands(),
): Command {
  return {
    name: "evnex",
    help: "Command line interface for the EVNEX Cloud API.",
    description: "Command line interface for the EVNEX Cloud API.",
    flags: [{ flags: [VERSION_SPEC] }],
    children: [...topLevel],
  };
}

// TODO(C2): createAuthCommand's real implementation slots in here.
// TODO(C3): createResourceCommands' real implementation slots in here.
// TODO(C4): createChargeCommand's real implementation slots in here.
function defaultTopLevelCommands(): Command[] {
  return [createAuthCommand(), ...createResourceCommands(), createChargeCommand()];
}

/** Resolve `argv` against `root`, parse flags, and invoke the matched command. */
export async function dispatch(
  root: Command,
  argv: readonly string[],
  getVersion: () => string = () => resolvePackageVersion(),
): Promise<void> {
  const { command, path, remaining } = resolvePath(root, argv);
  const specs = mergedFlagSpecs(command);

  let values: Record<string, string | boolean | (string | boolean)[] | undefined>;
  let positionals: readonly string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...remaining],
      options: toParseArgsOptions(specs),
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    printUsageError(command, path, (error as Error).message);
  }

  const parsed = buildParsedArgs(specs, values, positionals);

  if (parsed["help"] === true) {
    process.stdout.write(formatHelp(command, path));
    process.exit(0);
  }

  if (command === root && parsed["version"] === true) {
    process.stdout.write(`evnex ${getVersion()}\n`);
    return;
  }

  validatePositionals(command, path, parsed);
  validateFlags(command, path, parsed, specs);

  if (command.run === undefined) {
    // A group with no leaf subcommand chosen: print its own help and exit
    // cleanly, matching argparse's `args.func is None` fallback.
    process.stdout.write(formatHelp(command, path));
    process.exit(0);
  }

  await command.run(parsed);
}
