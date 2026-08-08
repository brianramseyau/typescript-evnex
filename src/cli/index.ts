#!/usr/bin/env node
/**
 * `evnex` CLI entrypoint — ported from `evnex/cli/__init__.py`'s `main`
 * (PLAN.md §5 C1).
 *
 * TODO(C1): implement. Top-level error mapping: `EvnexAuthError` -> stderr +
 * exit 1; `EvnexHttpError`/`EvnexTimeoutError` -> stderr + exit 1;
 * `EvnexValidationError` -> the "try upgrading evnex" message + exit 1;
 * SIGINT -> exit 130. No (leaf) subcommand resolved: print the most
 * specific help and exit 0.
 */

import { fileURLToPath } from "node:url";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  throw new Error("TODO(C1)");
}

const isDirectlyExecuted =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

/* v8 ignore start -- process entrypoint guard, exercised only when this file
   is run directly as the `evnex` binary, not when imported by tests */
if (isDirectlyExecuted) {
  await main();
}
/* v8 ignore stop */
