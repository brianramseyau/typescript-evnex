/**
 * CLI test harness — captures stdout and stderr separately, plus the process
 * exit code, around one call to the CLI's entry point (`main` in
 * `src/cli/index.ts`, PLAN.md §5 C1). Direct analogue of pytest's `capsys`:
 * Python tests assert `capsys.readouterr().out` parses as exactly one JSON
 * document for `--json` commands; this harness's `.stdout` is that same
 * string, so those assertions port unchanged.
 *
 * `entry` is passed in rather than imported here, so this harness has no
 * compile-time dependency on C1's (still-`TODO`) module — every wave that
 * consumes it (B3, C2, C3, C4) imports `main` from `src/cli/index.js` itself
 * and passes it through.
 */

export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type CliEntryPoint = (argv: readonly string[]) => Promise<void>;

/** Thrown internally when the intercepted `process.exit` is called; never escapes {@link runCli}. */
class CliExitSignal extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

/** Redirect a Node write stream's `write` into `sink`, returning a restore function. */
function captureWrites(stream: NodeJS.WriteStream, sink: string[]): () => void {
  // The raw, unbound property value — restored verbatim so a caller that
  // captured a reference to it beforehand (`const original = stream.write`)
  // sees the exact same function back afterwards. `.bind()` would produce a
  // new wrapper function on every call and break that reference equality.
  const original = stream.write;
  const spy: NodeJS.WriteStream["write"] = ((
    chunk: unknown,
    encodingOrCallback?: unknown,
    callback?: unknown,
  ): boolean => {
    const text =
      typeof chunk === "string"
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk).toString("utf8")
          : String(chunk);
    sink.push(text);
    const cb = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (typeof cb === "function") {
      (cb as () => void)();
    }
    return true;
  }) as NodeJS.WriteStream["write"];
  stream.write = spy;
  return () => {
    stream.write = original;
  };
}

/**
 * Run `entry(argv)` with `process.stdout` / `process.stderr` captured and
 * `process.exit` intercepted, so a real `process.exit()` call inside `entry`
 * cannot tear down the test worker. Everything is restored — even if `entry`
 * throws an error that is not the intercepted exit.
 *
 * The reported exit code is whichever of these happens: the code passed to
 * `process.exit(code)` if `entry` called it; otherwise `process.exitCode` if
 * `entry` set that and returned; otherwise `0`.
 */
export async function runCli(
  entry: CliEntryPoint,
  argv: readonly string[] = [],
): Promise<CliResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const restoreStdout = captureWrites(process.stdout, stdoutChunks);
  const restoreStderr = captureWrites(process.stderr, stderrChunks);
  // Same reasoning as `captureWrites`: keep the exact original reference,
  // never a `.bind()` wrapper, so restoration is transparent to a caller
  // that compares `process.exit` before and after.
  const originalExit = process.exit;
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  process.exit = ((code?: number): never => {
    throw new CliExitSignal(code ?? 0);
  }) as typeof process.exit;

  let exitCode = 0;
  try {
    await entry(argv);
    exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    if (error instanceof CliExitSignal) {
      exitCode = error.code;
    } else {
      throw error;
    }
  } finally {
    restoreStdout();
    restoreStderr();
    process.exit = originalExit;
    process.exitCode = originalExitCode;
  }

  return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join(""), exitCode };
}
