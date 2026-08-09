/**
 * Tests for the CLI router (PLAN.md §5 C1). These exercise `dispatch` and
 * `buildParser` against synthetic `Command` trees rather than the real
 * `auth`/`resources`/`charge` command groups — C2/C3/C4 have not run yet, so
 * the real trees would throw `TODO(...)` if built. `buildParser`'s own
 * "real wiring" default path is covered separately, with the three command
 * modules mocked, in the last describe block.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildParser,
  cacheFlags,
  chargePointFlag,
  dispatch,
  formatHelp,
  jsonFlag,
  otpFlags,
} from "../../src/cli/parser.js";
import type { Command, FlagGroup, ParsedArgs } from "../../src/cli/parser.js";
import { defaultTokenCachePath } from "../../src/cli/tokenCache.js";
import { runCli } from "../support/cli.js";

/** A leaf command with a no-op `run`, overridable per test. */
function leaf(overrides: Partial<Command> & Pick<Command, "name" | "help">): Command {
  return { run: async () => {}, ...overrides };
}

const fakeVersion = (): string => "9.9.9";

/** Run `dispatch(root, argv)` through the same stdout/stderr/exit-capturing harness `main` uses. */
function run(root: Command, argv: readonly string[], getVersion = fakeVersion) {
  return runCli((a) => dispatch(root, a, getVersion), argv);
}

describe("dispatch: resolution", () => {
  it("walks matching child names down to the leaf and invokes its handler", async () => {
    const handler = vi.fn(async () => {});
    const show = leaf({ name: "show", help: "show one", run: handler });
    const chargePoints = { name: "charge-points", help: "cp group", children: [show] };
    const root: Command = { name: "evnex", help: "root", children: [chargePoints] };

    const result = await run(root, ["charge-points", "show"]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(0);
  });

  it("rejects a bogus subcommand name with exit 2 and lists the valid choices", async () => {
    const root: Command = {
      name: "evnex",
      help: "root",
      children: [leaf({ name: "auth", help: "auth" })],
    };

    const result = await run(root, ["bogus"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid choice: 'bogus'");
    expect(result.stderr).toContain("'auth'");
  });

  it("old flat command names no longer parse now that commands are nested", async () => {
    // Mirrors Python's `test_old_names_no_longer_parse`: a pre-restructure
    // flat name like "charge-points-list" is not a valid top-level choice
    // once "charge-points" is a group with a "list" child.
    const list = leaf({ name: "list", help: "list" });
    const chargePoints = { name: "charge-points", help: "cp", children: [list] };
    const root: Command = { name: "evnex", help: "root", children: [chargePoints] };

    const result = await run(root, ["charge-points-list"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid choice: 'charge-points-list'");
  });

  it("stops descending at a group with explicitly empty children and falls back to its help", async () => {
    const root: Command = { name: "evnex", help: "root", children: [] };

    const result = await run(root, []);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("evnex - root");
  });

  it("a group with no leaf subcommand chosen prints that group's help and exits 0", async () => {
    const mfa = {
      name: "mfa",
      help: "mfa group",
      children: [leaf({ name: "enable", help: "e" })],
    };
    const auth = { name: "auth", help: "auth group", children: [mfa] };
    const root: Command = { name: "evnex", help: "root", children: [auth] };

    const result = await run(root, ["auth"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("evnex auth - auth group");
    expect(result.stdout).toContain("mfa");
  });

  it("no args at all prints the root's own help and exits 0", async () => {
    const root: Command = {
      name: "evnex",
      help: "root",
      children: [leaf({ name: "status", help: "show status" })],
    };

    const result = await run(root, []);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("show status");
  });
});

describe("dispatch: strict flag rejection", () => {
  it("logout only takes --token-cache, matching Python's TestLogout", async () => {
    const logout = leaf({ name: "logout", help: "logout", flags: [cacheFlags] });
    const auth = { name: "auth", help: "auth", children: [logout] };
    const root: Command = { name: "evnex", help: "root", children: [auth] };

    const accepted = await run(root, ["auth", "logout", "--token-cache", "/tmp/x.json"]);
    expect(accepted.exitCode).toBe(0);

    const rejected = await run(root, ["auth", "logout", "--otp", "123456"]);
    expect(rejected.exitCode).toBe(2);
    expect(rejected.stderr).toContain("Unknown option '--otp'");
  });

  it("reset-password rejects the session flags entirely (none declared)", async () => {
    const resetPassword = leaf({ name: "reset-password", help: "reset" });
    const auth = { name: "auth", help: "auth", children: [resetPassword] };
    const root: Command = { name: "evnex", help: "root", children: [auth] };

    const result = await run(root, [
      "auth",
      "reset-password",
      "--token-cache",
      "/tmp/x.json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown option '--token-cache'");
  });
});

describe("dispatch: flag parsing", () => {
  it("accepts shared flags in trailing position, after a positional", async () => {
    const handler = vi.fn(async (_args: ParsedArgs) => {});
    const confirm = leaf({
      name: "confirm",
      help: "confirm",
      positionals: [{ name: "totp-code" }],
      flags: [otpFlags],
      run: handler,
    });
    const root: Command = { name: "evnex", help: "root", children: [confirm] };

    const result = await run(root, ["confirm", "123456", "--otp", "999999"]);

    expect(result.exitCode).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
    const args = handler.mock.calls[0]![0];
    expect(args.positionals).toEqual(["123456"]);
    expect(args["otp"]).toBe("999999");
    expect(args["otpCommand"]).toBeUndefined();
  });

  it("declares --no-prefer as a plain boolean the handler inverts itself", async () => {
    const handler = vi.fn(async (_args: ParsedArgs) => {});
    const confirm = leaf({
      name: "confirm",
      help: "confirm",
      flags: [
        { flags: [{ name: "no-prefer", type: "boolean", help: "disable preference" }] },
      ],
      run: handler,
    });
    const root: Command = { name: "evnex", help: "root", children: [confirm] };

    await run(root, ["confirm", "--no-prefer"]);

    const args = handler.mock.calls[0]![0];
    expect(args["noPrefer"]).toBe(true);

    handler.mockClear();
    await run(root, ["confirm"]);
    const argsDefault = handler.mock.calls[0]![0];
    expect(argsDefault["noPrefer"]).toBeUndefined();
  });

  it("applies a flag's default value when not given on the command line", async () => {
    const handler = vi.fn(async (_args: ParsedArgs) => {});
    const list = leaf({
      name: "list",
      help: "list",
      flags: [{ flags: [{ name: "limit", type: "string", default: "10", help: "max" }] }],
      run: handler,
    });
    const root: Command = { name: "evnex", help: "root", children: [list] };

    await run(root, ["list"]);

    const args = handler.mock.calls[0]![0];
    expect(args["limit"]).toBe("10");
  });
});

describe("dispatch: --version", () => {
  it("prints the version and exits 0 for `evnex --version`", async () => {
    const root: Command = {
      name: "evnex",
      help: "root",
      flags: [{ flags: [{ name: "version", type: "boolean", help: "show version" }] }],
      children: [leaf({ name: "status", help: "status" })],
    };

    const result = await run(root, ["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("evnex 9.9.9\n");
  });

  it("uses the real package version when no getVersion override is supplied", async () => {
    const root: Command = {
      name: "evnex",
      help: "root",
      flags: [{ flags: [{ name: "version", type: "boolean", help: "show version" }] }],
    };

    const result = await runCli((a) => dispatch(root, a), ["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^evnex \S+\n$/);
  });

  it("only recognises --version at the root, not once a subcommand is resolved", async () => {
    const root: Command = {
      name: "evnex",
      help: "root",
      flags: [{ flags: [{ name: "version", type: "boolean", help: "show version" }] }],
      children: [leaf({ name: "status", help: "status" })],
    };

    const result = await run(root, ["status", "--version"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown option '--version'");
  });
});

describe("dispatch: --help", () => {
  it("prints help and exits 0 for a leaf command, without invoking its handler", async () => {
    const handler = vi.fn(async () => {});
    const login = leaf({
      name: "login",
      help: "sign in",
      flags: [cacheFlags, otpFlags],
      run: handler,
    });
    const root: Command = { name: "evnex", help: "root", children: [login] };

    const result = await run(root, ["login", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(handler).not.toHaveBeenCalled();
    expect(result.stdout).toContain("--token-cache");
    expect(result.stdout).toContain("--otp");
  });

  it("supports the -h short alias", async () => {
    const root: Command = {
      name: "evnex",
      help: "root",
      children: [leaf({ name: "status", help: "s" })],
    };

    const result = await run(root, ["status", "-h"]);

    expect(result.exitCode).toBe(0);
  });
});

describe("dispatch: positional validation", () => {
  it("requires a declared positional by default", async () => {
    const confirm = leaf({
      name: "confirm",
      help: "confirm",
      positionals: [{ name: "totp-code" }],
    });
    const root: Command = { name: "evnex", help: "root", children: [confirm] };

    const result = await run(root, ["confirm"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("the following arguments are required: totp-code");
  });

  it("allows an explicitly optional positional to be omitted", async () => {
    const handler = vi.fn(async (_args: ParsedArgs) => {});
    const show = leaf({
      name: "show",
      help: "show",
      positionals: [{ name: "id", required: false }],
      run: handler,
    });
    const root: Command = { name: "evnex", help: "root", children: [show] };

    const result = await run(root, ["show"]);

    expect(result.exitCode).toBe(0);
    const args = handler.mock.calls[0]![0];
    expect(args.positionals).toEqual([]);
  });

  it("rejects more positionals than declared", async () => {
    const show = leaf({
      name: "show",
      help: "show",
      positionals: [{ name: "id", required: false }],
    });
    const root: Command = { name: "evnex", help: "root", children: [show] };

    const result = await run(root, ["show", "one", "two"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unrecognized arguments: two");
  });
});

describe("dispatch: --days-style choices and --limit-style custom validation", () => {
  const daysFlag: FlagGroup = {
    flags: [
      {
        name: "days",
        type: "string",
        choices: ["7", "14", "30"],
        default: "7",
        help: "window",
      },
    ],
  };
  const limitFlag: FlagGroup = {
    flags: [
      {
        name: "limit",
        type: "string",
        default: "10",
        help: "max",
        validate: (raw) => {
          const n = Number(raw);
          return Number.isInteger(n) && n > 0 ? undefined : "must be a positive integer";
        },
      },
    ],
  };

  it("accepts a value in --days' choices", async () => {
    const insights = leaf({ name: "insights", help: "insights", flags: [daysFlag] });
    const root: Command = { name: "evnex", help: "root", children: [insights] };

    const result = await run(root, ["insights", "--days", "14"]);
    expect(result.exitCode).toBe(0);
  });

  it("rejects a value outside --days' choices with exit 2", async () => {
    const insights = leaf({ name: "insights", help: "insights", flags: [daysFlag] });
    const root: Command = { name: "evnex", help: "root", children: [insights] };

    const result = await run(root, ["insights", "--days", "8"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("argument --days");
    expect(result.stderr).toContain("invalid choice: '8'");
  });

  it("accepts a --limit-style positive integer", async () => {
    const sessions = leaf({ name: "list", help: "list", flags: [limitFlag] });
    const root: Command = { name: "evnex", help: "root", children: [sessions] };

    const result = await run(root, ["list", "--limit", "5"]);
    expect(result.exitCode).toBe(0);
  });

  it("rejects a non-positive --limit-style value with exit 2", async () => {
    const sessions = leaf({ name: "list", help: "list", flags: [limitFlag] });
    const root: Command = { name: "evnex", help: "root", children: [sessions] };

    const result = await run(root, ["list", "--limit", "0"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("argument --limit: must be a positive integer");
  });
});

describe("dispatch: run() errors propagate uncaught", () => {
  it("does not swallow an error thrown by the leaf handler", async () => {
    const boom = leaf({
      name: "boom",
      help: "boom",
      run: async () => {
        throw new Error("kaboom");
      },
    });
    const root: Command = { name: "evnex", help: "root", children: [boom] };

    await expect(dispatch(root, ["boom"], fakeVersion)).rejects.toThrow("kaboom");
  });
});

describe("formatHelp", () => {
  it("lists children, positionals (with and without help text), and flag choices/defaults", () => {
    const leafCmd: Command = {
      name: "confirm",
      help: "confirm a device",
      description: "Verify a code from a newly enrolled device.",
      positionals: [
        { name: "totp-code", help: "6-digit code" },
        { name: "device-name", required: false },
      ],
      flags: [
        cacheFlags,
        jsonFlag,
        chargePointFlag,
        {
          flags: [
            { name: "days", type: "string", choices: ["7", "14", "30"], help: "window" },
          ],
        },
      ],
    };

    const text = formatHelp(leafCmd, ["auth", "mfa"]);

    expect(text).toContain(
      "evnex auth mfa - Verify a code from a newly enrolled device.",
    );
    expect(text).toContain("usage: evnex auth mfa");
    expect(text).toContain("totp-code  6-digit code");
    expect(text).toContain("device-name");
    expect(text).toContain("--token-cache <value>");
    expect(text).toContain("--json");
    expect(text).toContain("(choices: 7, 14, 30)");
    expect(text).toContain("-h, --help");
  });

  it("lists group children and omits the positionals section when there are none", () => {
    const group: Command = {
      name: "auth",
      help: "auth group",
      children: [
        leaf({ name: "login", help: "sign in" }),
        leaf({ name: "logout", help: "sign out" }),
      ],
    };

    const text = formatHelp(group);

    expect(text).toContain("evnex - auth group");
    expect(text).toContain("login");
    expect(text).toContain("sign in");
    expect(text).toContain("logout");
    expect(text).not.toContain("Positional arguments:");
  });
});

describe("exported shared flag groups", () => {
  it("cacheFlags declares --token-cache defaulting to the real token cache path", () => {
    expect(cacheFlags.flags).toHaveLength(1);
    expect(cacheFlags.flags[0]).toMatchObject({ name: "token-cache", type: "string" });
    expect(cacheFlags.flags[0]?.default).toBe(defaultTokenCachePath());
  });

  it("otpFlags declares --otp and --otp-command", () => {
    const names = otpFlags.flags.map((f) => f.name);
    expect(names).toEqual(["otp", "otp-command"]);
  });

  it("jsonFlag declares a boolean --json", () => {
    expect(jsonFlag.flags).toEqual([
      { name: "json", type: "boolean", help: "emit machine-readable JSON on stdout" },
    ]);
  });

  it("chargePointFlag declares --charge-point", () => {
    expect(chargePointFlag.flags[0]?.name).toBe("charge-point");
  });
});

describe("buildParser", () => {
  it("wires an explicit top-level command list in as-given, plus --version", async () => {
    const status = leaf({ name: "status", help: "status" });
    const root = buildParser([status]);

    expect(root.name).toBe("evnex");
    expect(root.children).toEqual([status]);

    const result = await run(root, ["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("evnex 9.9.9\n");
  });

  describe("default (real) command tree", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.doUnmock("../../src/cli/commands/auth.js");
      vi.doUnmock("../../src/cli/commands/resources.js");
      vi.doUnmock("../../src/cli/commands/charge.js");
      vi.resetModules();
    });

    it("assembles auth, the resource commands, and charge from ./commands/*.js by default", async () => {
      vi.doMock("../../src/cli/commands/auth.js", () => ({
        createAuthCommand: (): Command => ({ name: "auth", help: "auth (fake)" }),
      }));
      vi.doMock("../../src/cli/commands/resources.js", () => ({
        createResourceCommands: (): Command[] => [
          { name: "status", help: "status (fake)" },
          { name: "locations", help: "locations (fake)" },
        ],
      }));
      vi.doMock("../../src/cli/commands/charge.js", () => ({
        createChargeCommand: (): Command => ({ name: "charge", help: "charge (fake)" }),
      }));

      const { buildParser: freshBuildParser } = await import("../../src/cli/parser.js");
      const root = freshBuildParser();

      expect(root.children?.map((c) => c.name)).toEqual([
        "auth",
        "status",
        "locations",
        "charge",
      ]);
    });
  });
});
