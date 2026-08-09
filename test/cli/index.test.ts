/**
 * Tests for the `evnex` entrypoint (PLAN.md §5 C1): top-level error mapping,
 * SIGINT handling, and the "no leaf subcommand" / `--version` outcomes as
 * seen through the public single-argument `main(argv)` contract.
 *
 * `./parser.js`'s `buildParser` is mocked to hand back a synthetic root —
 * C2/C3/C4 have not run yet, so the real command tree would throw
 * `TODO(...)`. `dispatch` itself is left un-mocked (the real implementation,
 * already covered by `parser.test.ts`), so these tests exercise `main`'s own
 * logic end to end against real routing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvnexAuthError, EvnexValidationError } from "../../src/errors.js";
import { EvnexHttpError, EvnexTimeoutError } from "../../src/http/errors.js";
import type * as ParserModule from "../../src/cli/parser.js";
import type { Command } from "../../src/cli/parser.js";
import { runCli } from "../support/cli.js";

const state = vi.hoisted(() => ({ root: undefined as unknown }));

vi.mock("../../src/cli/parser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ParserModule>();
  return {
    ...actual,
    buildParser: () => state.root,
  };
});

const { main } = await import("../../src/cli/index.js");

function setRoot(root: Command): void {
  state.root = root;
}

beforeEach(() => {
  setRoot({ name: "evnex", help: "root" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("top-level error mapping", () => {
  it("maps EvnexAuthError to stderr and exit 1", async () => {
    setRoot({
      name: "evnex",
      help: "root",
      run: async () => {
        throw new EvnexAuthError("bad session");
      },
    });

    const result = await runCli(main, []);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("Authentication error: bad session\n");
  });

  it("maps EvnexHttpError to stderr and exit 1", async () => {
    setRoot({
      name: "evnex",
      help: "root",
      run: async () => {
        throw new EvnexHttpError("500 on /foo", { status: 500, path: "/foo" });
      },
    });

    const result = await runCli(main, []);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("API request failed: 500 on /foo\n");
  });

  it("maps EvnexTimeoutError to stderr and exit 1", async () => {
    setRoot({
      name: "evnex",
      help: "root",
      run: async () => {
        throw new EvnexTimeoutError("timed out on /foo", { path: "/foo" });
      },
    });

    const result = await runCli(main, []);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("API request failed: timed out on /foo\n");
  });

  it("maps EvnexValidationError to the 'try upgrading evnex' message and exit 1", async () => {
    setRoot({
      name: "evnex",
      help: "root",
      run: async () => {
        throw new EvnexValidationError("bad shape");
      },
    });

    const result = await runCli(main, []);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "The API returned a response this client version does not understand; try upgrading evnex\n",
    );
  });

  it("lets an unrecognised error propagate uncaught", async () => {
    setRoot({
      name: "evnex",
      help: "root",
      run: async () => {
        throw new RangeError("not ours to map");
      },
    });

    await expect(main([])).rejects.toThrow("not ours to map");
  });
});

describe("SIGINT", () => {
  it("exits 130 when SIGINT arrives while a command is running", async () => {
    setRoot({
      name: "evnex",
      help: "root",
      run: async () => {
        process.emit("SIGINT");
      },
    });

    const result = await runCli(main, []);

    expect(result.exitCode).toBe(130);
  });

  it("does not leak a SIGINT listener across calls", async () => {
    const before = process.listenerCount("SIGINT");
    setRoot({ name: "evnex", help: "root", run: async () => {} });

    await runCli(main, []);

    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});

describe("no subcommand / --version, end to end", () => {
  it("prints the root's help and exits 0 when no subcommand is given", async () => {
    setRoot({
      name: "evnex",
      help: "root",
      children: [{ name: "status", help: "show status" }],
    });

    const result = await runCli(main, []);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("status");
    expect(result.stderr).toBe("");
  });

  it("--version prints a version and exits 0", async () => {
    setRoot({
      name: "evnex",
      help: "root",
      flags: [{ flags: [{ name: "version", type: "boolean", help: "show version" }] }],
    });

    const result = await runCli(main, ["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^evnex \S+\n$/);
  });

  it("an unrecognised subcommand exits 2", async () => {
    setRoot({ name: "evnex", help: "root", children: [{ name: "status", help: "s" }] });

    const result = await runCli(main, ["bogus"]);

    expect(result.exitCode).toBe(2);
  });
});
