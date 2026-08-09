/**
 * A non-"module not found" import failure must propagate, not be silently
 * swallowed as a missing optional peer. Split into its own file for the
 * same reason as `qr.missingPackage.test.ts`: `vi.mock` is file-scoped.
 */
import { describe, expect, it, vi } from "vitest";
import { showQr } from "../../src/cli/qr.js";

vi.mock("qrcode", () => {
  throw new Error("boom");
});

describe("showQr, qrcode import fails for an unrelated reason", () => {
  it("propagates the failure instead of degrading", async () => {
    let caught: unknown;
    try {
      await showQr("otpauth://totp/evnex?secret=ABCDEF");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    // vitest's mock-factory-throw path wraps the real error under `.cause`.
    expect((caught as Error).cause).toMatchObject({ message: "boom" });
  });
});
