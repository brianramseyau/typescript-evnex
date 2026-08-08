/**
 * TOTP enrollment QR rendering — ported from `show_qr` in `evnex/cli/_auth.py`.
 *
 * TODO(A10): implement.
 *
 * - Terminal QR via the **optional peer** `qrcode` package. A missing
 *   install degrades to printing the `otpauth://` URI — the original treats
 *   uninstalling it as a supported opt-out.
 * - `--browser` writes an SVG to `$XDG_RUNTIME_DIR` when set (tmpfs, cleared
 *   at logout) else the temp dir, chmod 0600, and prints the "contains your
 *   MFA secret, delete after scanning" warning.
 */

export interface ShowQrOptions {
  /** Also open the QR code (as a temporary SVG) in a browser. */
  openBrowser?: boolean;
}

/** Render the enrollment QR in the terminal, and optionally a browser. */
export async function showQr(uri: string, options: ShowQrOptions = {}): Promise<void> {
  throw new Error("TODO(A10)");
}
