/**
 * TOTP enrollment QR rendering — ported from `show_qr` in `evnex/cli/_auth.py`.
 *
 * - Terminal QR via the **optional peer** `qrcode` package. A missing
 *   install degrades to printing the `otpauth://` URI — the original treats
 *   uninstalling it as a supported opt-out (PLAN.md §7).
 * - `--browser` writes an SVG to `$XDG_RUNTIME_DIR` when set (tmpfs, cleared
 *   at logout) else the temp dir, chmod 0600, and prints the "contains your
 *   MFA secret, delete after scanning" warning.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { open as openFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ShowQrOptions {
  /** Also open the QR code (as a temporary SVG) in a browser. */
  openBrowser?: boolean;
}

/** The slice of the `qrcode` package's API this module uses. */
interface QrcodeModule {
  toString(
    text: string,
    options: { type: "terminal" | "svg"; small?: boolean },
  ): Promise<string>;
}

/**
 * True for Node's "package not found" dynamic-import failure.
 *
 * Only the wrapped form is reachable from tests: vitest's `vi.mock`
 * factory-throw path (used by the missing-`qrcode` test) always nests the
 * original error under `.cause`, rather than setting `code` directly the
 * way a real, unmocked `import()` failure would. Both forms are checked so
 * production behaviour — no mocking involved — is correct either way.
 */
function isModuleNotFoundError(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  // The `err.code` side and the `.cause` presence check are only reachable
  // via a real, unmocked import() failure; see the docstring above for why
  // the suite can only exercise the `.cause`-wrapped path. This directive
  // must stay a single-line comment on the line directly above its target:
  // written as a block, `next` resolves to a line inside the comment body
  // and silently excludes the wrong statement.
  /* v8 ignore next */
  const code = err.code ?? err.cause?.code;
  return code === "ERR_MODULE_NOT_FOUND";
}

/**
 * Dynamically load the optional `qrcode` peer, or `undefined` if it is not
 * installed. A dynamic `import()` (rather than a static one) is what makes
 * "not installed" a normal, catchable rejection instead of a load-time
 * crash for everyone who hasn't opted into the dependency — mirroring
 * Python's `try: import qrcode / except ImportError`.
 */
async function loadQrcode(): Promise<QrcodeModule | undefined> {
  try {
    return (await import("qrcode")) as unknown as QrcodeModule;
  } catch (error) {
    if (isModuleNotFoundError(error)) return undefined;
    throw error;
  }
}

/** Best-effort `webbrowser.open()` analogue: platform-appropriate opener, fire-and-forget. */
function openInBrowser(path: string): void {
  const url = `file://${path}`;
  const [command, args]: [string, readonly string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    // A launch failure (no such opener on this system, etc.) surfaces as an
    // 'error' event, not a thrown exception; swallow it the same way
    // Python's webbrowser.open() reports failure via a return value rather
    // than an exception — the QR/otpauth URI/secret are already printed
    // above, so a missing browser opener is not fatal to enrollment.
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // spawn() itself can throw synchronously for some failure modes
    // (e.g. EACCES on some platforms); same best-effort reasoning applies.
  }
}

/** Render the enrollment QR in the terminal, and optionally a browser. */
export async function showQr(uri: string, options: ShowQrOptions = {}): Promise<void> {
  const qrcode = await loadQrcode();
  if (qrcode === undefined) {
    process.stderr.write("(install the qrcode package for a scannable QR code)\n");
    return;
  }

  const ascii = await qrcode.toString(uri, { type: "terminal", small: true });
  process.stdout.write(ascii);

  if (options.openBrowser !== true) return;

  const svg = await qrcode.toString(uri, { type: "svg" });
  // Prefer $XDG_RUNTIME_DIR (tmpfs, cleared at logout) for a file that
  // holds a live MFA secret; fall back to the default temp dir.
  const runtimeDir = process.env["XDG_RUNTIME_DIR"];
  const dir = runtimeDir !== undefined && runtimeDir.length > 0 ? runtimeDir : tmpdir();
  const path = join(dir, `evnex-mfa-qr-${randomBytes(9).toString("base64url")}.svg`);

  const handle = await openFile(path, "w", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(svg, "utf8");
  } finally {
    await handle.close();
  }

  openInBrowser(path);
  process.stderr.write(
    `QR code written to ${path}\n` +
      "This file contains your MFA secret; delete it after scanning.\n",
  );
}
