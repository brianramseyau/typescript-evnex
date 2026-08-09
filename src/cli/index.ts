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

const isDirectlyExecuted =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

/* v8 ignore start -- process entrypoint guard, exercised only when this file
   is run directly as the `evnex` binary, not when imported by tests */
if (isDirectlyExecuted) {
  await main();
}
/* v8 ignore stop */
