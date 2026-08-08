/**
 * Interactive prompts — ported from the `input()`/`getpass.getpass()` calls
 * throughout `evnex/cli/_auth.py` and `_resources.py`.
 *
 * TODO(A10): implement. Prompts are written to **stderr** so a `--json`
 * command's stdout stays valid JSON; input is read from stdin.
 */

/** Prompt on stderr and read one line from stdin. */
export function promptLine(prompt: string): Promise<string> {
  throw new Error("TODO(A10)");
}

/** Prompt on stderr and read one line from stdin with echo disabled (raw-mode). */
export function promptSecret(prompt: string): Promise<string> {
  throw new Error("TODO(A10)");
}

/** Prompt on stderr for a yes/no confirmation; only "y"/"yes" (any case) is truthy. */
export async function promptConfirm(prompt: string): Promise<boolean> {
  throw new Error("TODO(A10)");
}
