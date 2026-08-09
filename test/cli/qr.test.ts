import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showQr } from "../../src/cli/qr.js";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

class FakeChild extends EventEmitter {
  unref = vi.fn();
}

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

const originalPlatform = process.platform;

let stdout: string[];
let stderr: string[];
let dir: string;

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
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => new FakeChild());
  dir = mkdtempSync(join(tmpdir(), "evnex-qr-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  setPlatform(originalPlatform);
  rmSync(dir, { recursive: true, force: true });
  delete process.env["XDG_RUNTIME_DIR"];
});

const URI = "otpauth://totp/evnex:evnex-account?secret=JBSWY3DPEHPK3PXP&issuer=evnex";

describe("showQr (qrcode installed)", () => {
  it("prints an ASCII QR code to stdout and nothing to stderr", async () => {
    await showQr(URI);
    expect(stdout.join("").length).toBeGreaterThan(0);
    expect(stderr).toEqual([]);
  });

  it("does not touch the browser opener when openBrowser is not requested", async () => {
    await showQr(URI);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  describe("--browser", () => {
    it("writes a 0600 SVG under $XDG_RUNTIME_DIR when set", async () => {
      process.env["XDG_RUNTIME_DIR"] = dir;

      await showQr(URI, { openBrowser: true });

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [, args] = spawnMock.mock.calls[0] as [string, string[]];
      const url = args[args.length - 1] ?? "";
      const path = url.replace(/^file:\/\//, "");

      expect(path.startsWith(dir)).toBe(true);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readFileSync(path, "utf8")).toContain("<svg");
    });

    it("falls back to the OS temp dir when $XDG_RUNTIME_DIR is unset", async () => {
      delete process.env["XDG_RUNTIME_DIR"];

      await showQr(URI, { openBrowser: true });

      const [, args] = spawnMock.mock.calls[0] as [string, string[]];
      const url = args[args.length - 1] ?? "";
      const path = url.replace(/^file:\/\//, "");
      expect(path.startsWith(tmpdir())).toBe(true);
      rmSync(path, { force: true });
    });

    it("falls back to the OS temp dir when $XDG_RUNTIME_DIR is empty", async () => {
      process.env["XDG_RUNTIME_DIR"] = "";

      await showQr(URI, { openBrowser: true });

      const [, args] = spawnMock.mock.calls[0] as [string, string[]];
      const url = args[args.length - 1] ?? "";
      const path = url.replace(/^file:\/\//, "");
      expect(path.startsWith(tmpdir())).toBe(true);
      rmSync(path, { force: true });
    });

    it("prints the MFA-secret warning with the file path", async () => {
      process.env["XDG_RUNTIME_DIR"] = dir;

      await showQr(URI, { openBrowser: true });

      const text = stderr.join("");
      expect(text).toContain("QR code written to");
      expect(text).toContain(dir);
      expect(text).toContain(
        "This file contains your MFA secret; delete it after scanning.",
      );
    });

    it("opens with 'open' on darwin", async () => {
      setPlatform("darwin");
      process.env["XDG_RUNTIME_DIR"] = dir;
      await showQr(URI, { openBrowser: true });
      const [command] = spawnMock.mock.calls[0] as [string, string[]];
      expect(command).toBe("open");
    });

    it("opens with 'cmd /c start' on win32", async () => {
      setPlatform("win32");
      process.env["XDG_RUNTIME_DIR"] = dir;
      await showQr(URI, { openBrowser: true });
      const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(command).toBe("cmd");
      expect(args.slice(0, 3)).toEqual(["/c", "start", ""]);
    });

    it("opens with 'xdg-open' elsewhere", async () => {
      setPlatform("linux");
      process.env["XDG_RUNTIME_DIR"] = dir;
      await showQr(URI, { openBrowser: true });
      const [command] = spawnMock.mock.calls[0] as [string, string[]];
      expect(command).toBe("xdg-open");
    });

    it("swallows a synchronous spawn failure instead of crashing", async () => {
      process.env["XDG_RUNTIME_DIR"] = dir;
      spawnMock.mockImplementationOnce(() => {
        throw new Error("EACCES");
      });
      await expect(showQr(URI, { openBrowser: true })).resolves.toBeUndefined();
      expect(stderr.join("")).toContain("QR code written to");
    });

    it("swallows an async 'error' event from the opener without crashing", async () => {
      process.env["XDG_RUNTIME_DIR"] = dir;
      const child = new FakeChild();
      spawnMock.mockImplementationOnce(() => child);

      await showQr(URI, { openBrowser: true });
      expect(() => child.emit("error", new Error("no such opener"))).not.toThrow();
    });
  });
});
