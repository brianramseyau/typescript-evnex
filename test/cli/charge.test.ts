/**
 * Tests for the `charge now|auto|stop` commands (PLAN.md §5 C4) — mirrors
 * `tests/test_cli_resources.py::test_charge_*` in python-evnex.
 *
 * `signedInAuth` (C2, `../../src/cli/commands/auth.ts`) is mocked so these
 * tests never depend on that module's own (separately owned) implementation;
 * the EVNEX API itself is a `stubFetch` route table installed as the global
 * `fetch`, matching how `Transport` falls back to it when no `fetch` override
 * is passed to `Evnex` — the same seam production code uses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChargeCommand } from "../../src/cli/commands/charge.js";
import type { Command, ParsedArgs } from "../../src/cli/parser.js";
import { EvnexHttpError } from "../../src/http/errors.js";
import { makeResumedAuth } from "../support/builders.js";
import { runCli } from "../support/cli.js";
import type { CliResult } from "../support/cli.js";
import {
  CHARGE_POINTS_PATH,
  CHARGE_POINTS_PAYLOAD,
  CHARGE_POINT_OVERRIDE_PATH,
  CHARGE_POINT_STOP_PATH,
  TWO_CHARGE_POINTS_PAYLOAD,
  USER_PATH,
  USER_PAYLOAD,
} from "../support/fixtures.js";
import { createStubFetch } from "../support/stubFetch.js";
import type { StubFetch } from "../support/stubFetch.js";
import { FakeStdin, installFakeStdin } from "./fakeStdin.js";

vi.mock("../../src/cli/commands/auth.js", () => ({
  signedInAuth: vi.fn(),
}));

const { signedInAuth } = await import("../../src/cli/commands/auth.js");

function baseArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    positionals: [],
    tokenCache: "/tmp/evnex-test-tokens.json",
    otp: undefined,
    otpCommand: undefined,
    chargePoint: undefined,
    yes: undefined,
    ...overrides,
  };
}

function findChild(root: Command, name: string): Command {
  const child = root.children?.find((candidate) => candidate.name === name);
  if (child === undefined) throw new Error(`no '${name}' child on '${root.name}'`);
  return child;
}

function runCommand(command: Command, args: ParsedArgs): Promise<CliResult> {
  if (command.run === undefined) throw new Error(`'${command.name}' has no run`);
  const run = command.run;
  return runCli(() => run(args));
}

/** Resolves once `stdin` has registered a listener for `event` (see `promptConfirm`). */
function waitForListener(stdin: FakeStdin, event: string): Promise<void> {
  return new Promise((resolve) => {
    stdin.on("newListener", function onNewListener(registered: string) {
      if (registered === event) {
        stdin.removeListener("newListener", onNewListener);
        resolve();
      }
    });
  });
}

let stub: StubFetch;
let restoreFetch: () => void;

beforeEach(() => {
  stub = createStubFetch([
    { method: "GET", path: USER_PATH, json: USER_PAYLOAD },
    { method: "GET", path: CHARGE_POINTS_PATH, json: CHARGE_POINTS_PAYLOAD },
  ]);
  vi.stubGlobal("fetch", stub.fetch);
  restoreFetch = () => vi.unstubAllGlobals();
  vi.mocked(signedInAuth).mockResolvedValue(makeResumedAuth().auth);
});

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

describe("charge now", () => {
  it("sends chargeNow: true and prints confirmation", async () => {
    stub.addRoute({ method: "POST", path: CHARGE_POINT_OVERRIDE_PATH, json: {} });
    const command = findChild(createChargeCommand(), "now");

    const result = await runCommand(command, baseArgs());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Charging now on Garage Charger (SN0000001)\n");
    const calls = stub.callsFor("POST", CHARGE_POINT_OVERRIDE_PATH);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.json).toMatchObject({ chargeNow: true });
  });

  it("resolves --charge-point by a case-insensitive name substring", async () => {
    stub.addRoute({
      method: "GET",
      path: CHARGE_POINTS_PATH,
      json: TWO_CHARGE_POINTS_PAYLOAD,
    });
    stub.addRoute({
      method: "POST",
      path: "/charge-points/cp-0000002/commands/set-override",
      json: {},
    });
    const command = findChild(createChargeCommand(), "now");

    const result = await runCommand(command, baseArgs({ chargePoint: "driveway" }));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Charging now on Driveway Charger");
  });
});

describe("charge auto", () => {
  it("sends chargeNow: false and prints confirmation", async () => {
    stub.addRoute({ method: "POST", path: CHARGE_POINT_OVERRIDE_PATH, json: {} });
    const command = findChild(createChargeCommand(), "auto");

    const result = await runCommand(command, baseArgs());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "Returned Garage Charger (SN0000001) to its charging schedule\n",
    );
    const calls = stub.callsFor("POST", CHARGE_POINT_OVERRIDE_PATH);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.json).toMatchObject({ chargeNow: false });
  });
});

describe("charge stop", () => {
  it("--yes skips the prompt and stops charging", async () => {
    stub.addRoute({
      method: "POST",
      path: CHARGE_POINT_STOP_PATH,
      json: { data: { message: "Command accepted", status: "Accepted" } },
    });
    const command = findChild(createChargeCommand(), "stop");

    const result = await runCommand(command, baseArgs({ yes: true }));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Stopped charging on Garage Charger (SN0000001)\n");
    expect(stub.callsFor("POST", CHARGE_POINT_STOP_PATH)).toHaveLength(1);
  });

  it("translates a timeout (no active session) into exit 1", async () => {
    stub.addRoute({
      method: "POST",
      path: CHARGE_POINT_STOP_PATH,
      handler: () => {
        // The API answers a stop with no active session as a 504 that
        // surfaces as a read timeout — see `Transport.send`'s
        // `isTimeoutError` check.
        throw new DOMException("The operation was aborted.", "TimeoutError");
      },
    });
    const command = findChild(createChargeCommand(), "stop");

    const result = await runCommand(command, baseArgs({ yes: true }));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("No active charging session on Garage Charger to stop.\n");
  });

  it("a declined confirmation aborts without sending the stop command", async () => {
    const stdin = new FakeStdin(false);
    const restoreStdin = installFakeStdin(stdin);
    try {
      const command = findChild(createChargeCommand(), "stop");
      const pending = runCommand(command, baseArgs());
      await waitForListener(stdin, "data");
      stdin.push("n\n");

      const result = await pending;

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Aborted.");
      expect(stub.callsFor("POST", CHARGE_POINT_STOP_PATH)).toHaveLength(0);
    } finally {
      restoreStdin();
    }
  });

  it("an accepted confirmation sends the stop command", async () => {
    stub.addRoute({
      method: "POST",
      path: CHARGE_POINT_STOP_PATH,
      json: { data: { message: "Command accepted", status: "Accepted" } },
    });
    const stdin = new FakeStdin(false);
    const restoreStdin = installFakeStdin(stdin);
    try {
      const command = findChild(createChargeCommand(), "stop");
      const pending = runCommand(command, baseArgs());
      await waitForListener(stdin, "data");
      stdin.push("y\n");

      const result = await pending;

      expect(result.exitCode).toBe(0);
      expect(stub.callsFor("POST", CHARGE_POINT_STOP_PATH)).toHaveLength(1);
    } finally {
      restoreStdin();
    }
  });

  it("a non-timeout failure propagates rather than being swallowed as 'no active session'", async () => {
    stub.addRoute({
      method: "POST",
      path: CHARGE_POINT_STOP_PATH,
      status: 500,
      json: {},
    });
    const command = findChild(createChargeCommand(), "stop");

    await expect(runCommand(command, baseArgs({ yes: true }))).rejects.toBeInstanceOf(
      EvnexHttpError,
    );
  });
});
