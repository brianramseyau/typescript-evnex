#!/usr/bin/env node
/**
 * `evnex` CLI entrypoint — ported from `evnex/cli/__init__.py`'s `main`
 * (PLAN.md §5 C1).
 *
 * Top-level error mapping: `EvnexAuthError` -> stderr + exit 1;
 * `EvnexHttpError`/`EvnexTimeoutError` -> stderr + exit 1;
 * `EvnexValidationError` -> the "try upgrading evnex" message + exit 1;
 * SIGINT -> exit 130. Anything else propagates uncaught, matching Python's
 * `main` which only narrows those four `except` clauses and otherwise lets
 * the exception surface. Argument-parsing and "no leaf subcommand resolved"
 * outcomes (exit 2 / exit 0) are handled inside `dispatch` itself — this
 * mapping only ever sees errors raised by a leaf command's `run`.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EvnexAuthError, EvnexValidationError } from "../errors.js";
import { EvnexHttpError, EvnexTimeoutError } from "../http/errors.js";
import { buildParser, dispatch } from "./parser.js";

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const root = buildParser();
  // Registered and torn down per call (not module-scope) so repeated
  // invocations in-process - every test that calls `main` - never accumulate
  // listeners on the shared `process` object.
  const onSigint = (): void => {
    process.exit(130);
  };
  process.on("SIGINT", onSigint);
  try {
    await dispatch(root, argv);
  } catch (error) {
    if (error instanceof EvnexAuthError) {
      process.stderr.write(`Authentication error: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    if (error instanceof EvnexHttpError || error instanceof EvnexTimeoutError) {
      process.stderr.write(`API request failed: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    if (error instanceof EvnexValidationError) {
      process.stderr.write(
        "The API returned a response this client version does not understand; try upgrading evnex\n",
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

/**
 * Resolve a path through any symlinks, falling back to the path itself if it
 * cannot be resolved (it may not exist, or be unreadable). Never throws:
 * this runs at module scope, and coverage imports every file in `src/`, so a
 * throw here would take down the whole suite rather than just this command.
 */
function realPathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * True when this module is the process entrypoint rather than an import.
 *
 * Both sides are resolved through symlinks before comparing, which is the
 * whole point. npm installs a `bin` as a symlink at `node_modules/.bin/evnex`
 * pointing at the real `dist/cli/index.js`, and that is exactly what `npx
 * evnex` executes. Node's ESM loader resolves `import.meta.url` to the
 * symlink's *target*, while `process.argv[1]` keeps the symlink path it was
 * invoked by — so comparing them raw never matches, `main()` never runs, and
 * the CLI exits 0 having silently done nothing. That is not a hypothetical:
 * it is what shipped until a clean-tarball install caught it, because the
 * bug is invisible to any test that imports this module directly.
 *
 * Exported so that behaviour can actually be tested, rather than living
 * inside the coverage-excluded block below where nothing can reach it.
 */
export function isEntrypoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  return realPathOrSelf(fileURLToPath(moduleUrl)) === realPathOrSelf(argv1);
}

/* v8 ignore next -- the invocation itself only happens when run as a binary */
if (isEntrypoint(import.meta.url, process.argv[1])) await main();
