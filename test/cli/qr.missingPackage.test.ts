/**
 * Split from `qr.test.ts` because `vi.mock("qrcode", ...)` is file-scoped
 * (hoisted) — the rest of `qr.test.ts` exercises the real, installed
 * `qrcode` package, which a file-wide mock here would shadow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showQr } from "../../src/cli/qr.js";

vi.mock("qrcode", () => {
  const err = new Error("Cannot find package 'qrcode'");
  (err as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND";
  throw err;
});

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("showQr, qrcode not installed", () => {
  it("degrades to a stderr note and prints nothing to stdout", async () => {
    await showQr("otpauth://totp/evnex?secret=ABCDEF");
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toBe("(install the qrcode package for a scannable QR code)\n");
  });

  it("degrades the same way even when --browser was requested (no SVG is written)", async () => {
    await showQr("otpauth://totp/evnex?secret=ABCDEF", { openBrowser: true });
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toBe("(install the qrcode package for a scannable QR code)\n");
  });
});
