import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promptConfirm, promptLine, promptSecret } from "../../src/cli/prompt.js";
import { FakeStdin, installFakeStdin } from "./fakeStdin.js";

let stdin: FakeStdin;
let restoreStdin: () => void;
let stderr: string[];

function setUp(isTTY: boolean): void {
  stdin = new FakeStdin(isTTY);
  restoreStdin = installFakeStdin(stdin);
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  });
}

afterEach(() => {
  restoreStdin();
  vi.restoreAllMocks();
});

describe("promptLine", () => {
  beforeEach(() => setUp(false));

  it("writes the prompt to stderr", async () => {
    const pending = promptLine("Username: ");
    stdin.push("alice\n");
    await pending;
    expect(stderr.join("")).toBe("Username: ");
  });

  it("resolves with the line, excluding the newline", async () => {
    const pending = promptLine("Username: ");
    stdin.push("alice\n");
    await expect(pending).resolves.toBe("alice");
  });

  it("assembles a line delivered across multiple chunks", async () => {
    const pending = promptLine("> ");
    stdin.push("al");
    stdin.push("ice\n");
    await expect(pending).resolves.toBe("alice");
  });

  it("terminates on a bare CR, matching a CRLF-terminated line", async () => {
    const pending = promptLine("> ");
    stdin.push("alice\r\n");
    await expect(pending).resolves.toBe("alice");
  });

  it("never engages raw mode", async () => {
    setUp(true); // even when stdin *is* a TTY
    const pending = promptLine("> ");
    stdin.push("alice\n");
    await pending;
    expect(stdin.rawModeCalls).toEqual([]);
  });

  it("rejects if the stream errors", async () => {
    const pending = promptLine("> ");
    const boom = new Error("boom");
    stdin.emit("error", boom);
    await expect(pending).rejects.toBe(boom);
  });
});

describe("promptSecret", () => {
  describe("on a non-TTY stdin", () => {
    beforeEach(() => setUp(false));

    it("never engages raw mode", async () => {
      const pending = promptSecret("Password: ");
      stdin.push("hunter2\n");
      await pending;
      expect(stdin.rawModeCalls).toEqual([]);
    });

    it("resolves with the typed value", async () => {
      const pending = promptSecret("Password: ");
      stdin.push("hunter2\n");
      await expect(pending).resolves.toBe("hunter2");
    });
  });

  describe("on a TTY stdin", () => {
    beforeEach(() => setUp(true));

    it("engages raw mode for the duration of the read and restores it after", async () => {
      const pending = promptSecret("Password: ");
      stdin.push("x\n");
      await pending;
      expect(stdin.rawModeCalls).toEqual([true, false]);
    });

    it("writes a trailing newline to stderr once Enter is pressed (echo is suppressed)", async () => {
      const pending = promptSecret("Password: ");
      stdin.push("hunter2\n");
      await pending;
      expect(stderr.join("")).toBe("Password: \n");
    });

    it("handles backspace by removing the last character", async () => {
      const pending = promptSecret("Password: ");
      stdin.push("ab\u007fc\n"); // "a", "b", backspace, "c" -> "ac"
      await expect(pending).resolves.toBe("ac");
    });

    it("handles backspace expressed as \\b", async () => {
      const pending = promptSecret("Password: ");
      stdin.push("ab\bc\n");
      await expect(pending).resolves.toBe("ac");
    });

    it("rejects on Ctrl+C", async () => {
      const pending = promptSecret("Password: ");
      stdin.push("partial\u0003");
      await expect(pending).rejects.toThrow("prompt aborted (Ctrl+C)");
    });
  });
});

describe("promptConfirm", () => {
  beforeEach(() => setUp(false));

  it.each([
    ["y", true],
    ["Y", true],
    ["yes", true],
    ["YES", true],
    ["  yes  ", true],
    ["n", false],
    ["no", false],
    ["", false],
    ["maybe", false],
  ])("treats %j as %j", async (answer, expected) => {
    const pending = promptConfirm("Continue? [y/N] ");
    stdin.push(`${answer}\n`);
    await expect(pending).resolves.toBe(expected);
  });
});
