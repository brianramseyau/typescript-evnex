/**
 * A minimal fake `process.stdin` for `prompt.ts`/`otp.ts` tests — implements
 * just the surface `readLineFrom` (in `src/cli/prompt.ts`) touches:
 * `on`/`removeListener`, `resume`/`pause`/`setEncoding`, and (when `isTTY`)
 * `setRawMode`. Not shared test infrastructure (that's `test/support/**`,
 * owned by A9) — local to the two CLI test files that need to simulate
 * keystrokes arriving on stdin.
 */

import { EventEmitter } from "node:events";

export class FakeStdin extends EventEmitter {
  isTTY: boolean;
  readonly rawModeCalls: boolean[] = [];

  constructor(isTTY = false) {
    super();
    this.isTTY = isTTY;
  }

  setRawMode(mode: boolean): this {
    this.rawModeCalls.push(mode);
    return this;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }

  setEncoding(_encoding: BufferEncoding): this {
    return this;
  }

  /** Simulate a chunk of typed input arriving. */
  push(text: string): void {
    this.emit("data", text);
  }
}

/** Install `fake` as `process.stdin` and return a function that restores the original. */
export function installFakeStdin(fake: FakeStdin): () => void {
  const original = process.stdin;
  Object.defineProperty(process, "stdin", {
    value: fake,
    configurable: true,
    writable: true,
  });
  return () => {
    Object.defineProperty(process, "stdin", {
      value: original,
      configurable: true,
      writable: true,
    });
  };
}
