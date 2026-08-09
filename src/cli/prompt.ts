/**
 * Interactive prompts — ported from the `input()`/`getpass.getpass()` calls
 * throughout `evnex/cli/_auth.py` and `_resources.py`.
 *
 * Prompts are written to **stderr** so a `--json` command's stdout stays
 * valid JSON; input is read from stdin.
 *
 * `promptSecret` disables echo via raw mode (`stdin.setRawMode(true)`) when
 * stdin is a TTY. Python's `getpass.getpass()` gets this for free from
 * `termios` (it turns ECHO off while leaving canonical line-editing, i.e.
 * `ICANON`, on, so the kernel still handles backspace and only delivers a
 * finished line). Node's `setRawMode` has no such half-way point — it turns
 * canonical mode off too — so backspace and Ctrl+C, which the kernel would
 * otherwise handle for us, are handled explicitly below.
 */

const BACKSPACE = "\u007f";
const CTRL_C = "\u0003";

/** True while `stdin` is a TTY, i.e. `setRawMode` both exists and does something. */
function isRawModeCapable(stdin: NodeJS.ReadStream): boolean {
  return stdin.isTTY === true;
}

interface ReadLineOptions {
  /** Suppress echo (via raw mode) and handle backspace/Ctrl+C ourselves. */
  hidden: boolean;
}

function readLineFrom(
  stdin: NodeJS.ReadStream,
  prompt: string,
  options: ReadLineOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stderr.write(prompt);

    const useRawMode = options.hidden && isRawModeCapable(stdin);
    if (useRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";

    const cleanup = (): void => {
      stdin.removeListener("data", onData);
      stdin.removeListener("error", onError);
      if (useRawMode) stdin.setRawMode(false);
      stdin.pause();
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === "\n" || char === "\r") {
          cleanup();
          // In hidden mode nothing has echoed the Enter keystroke either;
          // move the cursor to a fresh line ourselves.
          if (options.hidden) process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (options.hidden && char === CTRL_C) {
          // Raw mode disables the terminal's own SIGINT generation (ISIG),
          // so without this the process would just swallow Ctrl+C.
          cleanup();
          process.stderr.write("\n");
          reject(new Error("prompt aborted (Ctrl+C)"));
          return;
        }
        if (options.hidden && (char === BACKSPACE || char === "\b")) {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on("data", onData);
    stdin.on("error", onError);
  });
}

/** Prompt on stderr and read one line from stdin. */
export function promptLine(prompt: string): Promise<string> {
  return readLineFrom(process.stdin, prompt, { hidden: false });
}

/** Prompt on stderr and read one line from stdin with echo disabled (raw-mode). */
export function promptSecret(prompt: string): Promise<string> {
  return readLineFrom(process.stdin, prompt, { hidden: true });
}

/** Prompt on stderr for a yes/no confirmation; only "y"/"yes" (any case) is truthy. */
export async function promptConfirm(prompt: string): Promise<boolean> {
  const answer = await promptLine(prompt);
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}
