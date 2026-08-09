/**
 * Tests for charge point resolution (PLAN.md §5 C4) — mirrors
 * `tests/test_cli_resources.py::test_resolve_*` in python-evnex.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchChargePoint, resolveOne } from "../../src/cli/resolve.js";
import { EvnexChargePoint } from "../../src/schema/chargePoints.js";
import { chargePointItem } from "../support/fixtures.js";

/** Thrown by the mocked `process.exit` so assertions can inspect the code. */
class ExitSignal extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

function cp(id: string, name: string, serial: string): EvnexChargePoint {
  return EvnexChargePoint.parse(chargePointItem(id, name, serial));
}

const ONE = [cp("cp-0000001", "Garage Charger", "SN0000001")];
const TWO = [
  cp("cp-0000001", "Garage Charger", "SN0000001"),
  cp("cp-0000002", "Driveway Charger", "SN0000002"),
];

let stderr: string[];

beforeEach(() => {
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitSignal(code ?? 0);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveOne", () => {
  it("uses the sole charge point when there is exactly one and no selector was given", () => {
    expect(resolveOne(ONE, undefined).id).toBe("cp-0000001");
  });

  it("exits 2 and lists the choices when ambiguous with no selector", () => {
    let caught: ExitSignal | undefined;
    try {
      resolveOne(TWO, undefined);
    } catch (error) {
      caught = error as ExitSignal;
    }
    expect(caught).toBeInstanceOf(ExitSignal);
    expect(caught?.code).toBe(2);
    const output = stderr.join("");
    expect(output).toContain("Select a charge point");
    expect(output).toContain("cp-0000001");
    expect(output).toContain("cp-0000002");
  });

  it("delegates to matchChargePoint when a selector is given (case-insensitive name substring)", () => {
    expect(resolveOne(TWO, "garage").name).toBe("Garage Charger");
  });
});

describe("matchChargePoint", () => {
  it("matches case-insensitively by serial substring", () => {
    expect(matchChargePoint(TWO, "sn0000002").id).toBe("cp-0000002");
  });

  it("an exact id match wins even though it would also substring-match another field", () => {
    expect(matchChargePoint(TWO, "cp-0000002").id).toBe("cp-0000002");
  });

  it("exits 2 with 'be more specific' when the selector matches several charge points", () => {
    let caught: ExitSignal | undefined;
    try {
      matchChargePoint(TWO, "charger");
    } catch (error) {
      caught = error as ExitSignal;
    }
    expect(caught?.code).toBe(2);
    expect(stderr.join("")).toContain("be more specific");
  });

  it("exits 2 with 'No charge point matches' when the selector matches nothing", () => {
    let caught: ExitSignal | undefined;
    try {
      matchChargePoint(ONE, "nonexistent");
    } catch (error) {
      caught = error as ExitSignal;
    }
    expect(caught?.code).toBe(2);
    expect(stderr.join("")).toContain("No charge point matches");
  });
});
