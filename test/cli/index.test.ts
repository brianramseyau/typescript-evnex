/**
 * Tests for the `evnex` entrypoint (PLAN.md §5 C1): top-level error mapping,
 * SIGINT handling, and the "no leaf subcommand" / `--version` outcomes as
 * seen through the public single-argument `main(argv)` contract.
 *
 * `./parser.js`'s `buildParser` is mocked to hand back a synthetic root, so
 * a failure here localises to `main` rather than to the command tree.
 * `dispatch` itself is left un-mocked (the real implementation, already
 * covered by `parser.test.ts`), so these tests exercise `main`'s own logic
 * end to end against real routing.
 */

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

const { main, isEntrypoint } = await import("../../src/cli/index.js");

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

// The bin-symlink regression. npm installs `bin` entries as symlinks, and
// `npx evnex` executes the symlink — so `process.argv[1]` is the symlink path
// while Node resolves `import.meta.url` to its target. Comparing the two raw
// never matched, and the CLI exited 0 having done nothing at all. Nothing in
// the suite could see it: the guard lived inside a coverage-excluded block,
// and every test here imports the module rather than executing it. Found by a
// clean-tarball install, pinned here with a real symlink on disk.
describe("isEntrypoint", () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "evnex-entrypoint-"));
    target = join(dir, "index.js");
    writeFileSync(target, "");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is false when there is no argv[1] at all", () => {
    expect(isEntrypoint(pathToFileURL(target).href, undefined)).toBe(false);
  });

  it("is true when invoked by its own real path", () => {
    expect(isEntrypoint(pathToFileURL(target).href, target)).toBe(true);
  });

  it("is true when invoked through a symlink, as npm's bin shim does", () => {
    const link = join(dir, "evnex-shim");
    symlinkSync(target, link);
    expect(isEntrypoint(pathToFileURL(target).href, link)).toBe(true);
  });

  it("is false for an unrelated file", () => {
    const other = join(dir, "other.js");
    writeFileSync(other, "");
    expect(isEntrypoint(pathToFileURL(target).href, other)).toBe(false);
  });

  // realpath throws on a path that does not exist. Falling back to the raw
  // path keeps this a plain false rather than an unhandled throw at module
  // scope, which would break every file the coverage run imports.
  it("is false, not throwing, when argv[1] does not exist", () => {
    expect(isEntrypoint(pathToFileURL(target).href, join(dir, "gone.js"))).toBe(false);
  });
});
