/**
 * Tests for the resource read commands (PLAN.md §5 C3): `status`,
 * `charge-points` (list/show), `sessions list`, `locations list`,
 * `insights`, and `schedule show`.
 *
 * `./commands/auth.js`'s `signedInAuth` and `../../api.js`'s `Evnex` are
 * mocked — C2's auth commands and (transitively) the real HTTP stack are
 * irrelevant here; these tests are about command wiring and rendering, not
 * authentication or transport, both fully covered elsewhere (B3, F0).
 * `../resolve.js`'s `matchChargePoint`/`resolveOne` are mocked too — C4 is
 * implementing that file concurrently in a sibling lane, and this suite only
 * needs to prove resources.ts calls them correctly and uses their result,
 * not that their own resolution algorithm is correct (that's C4's
 * `test_resolve_*` acceptance list).
 *
 * The fake `Evnex` client's methods read from a shared, per-test-reset
 * `backend` object (declared via `vi.hoisted` so the `vi.mock` factory can
 * close over it) — this lets each test configure exactly the responses it
 * needs with a plain property assignment, while still exercising the real
 * `dispatch`/parser plumbing (defaults, `choices`, positive-integer
 * validation) end to end, the same way the Python suite's `respx`-mocked
 * `run(argv)` fixture does.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../../src/cli/parser.js";
import type { Command, ParsedArgs } from "../../src/cli/parser.js";
import { runCli } from "../support/cli.js";
import {
  CHARGE_POINTS_PAYLOAD,
  DETAIL_V3_PAYLOAD,
  INSIGHTS_PAYLOAD,
  LOCATIONS_PAYLOAD,
  LOCATION_MINIMAL,
  SESSIONS_PAYLOAD,
  TWO_CHARGE_POINTS_PAYLOAD,
} from "../support/fixtures.js";
import { EvnexGetChargePointsResponse } from "../../src/schema/chargePoints.js";
import type { EvnexChargePoint } from "../../src/schema/chargePoints.js";
import {
  EvnexChargePointDetail as EvnexChargePointDetailV3Schema,
  EvnexGetChargePointSessionsResponse,
} from "../../src/schema/v3/chargePoints.js";
import type { EvnexChargePointSession } from "../../src/schema/v3/chargePoints.js";
import { evnexV3ApiResponse } from "../../src/schema/v3/generic.js";
import { EvnexGetLocationsResponse } from "../../src/schema/v3/locations.js";
import { EvnexGetOrgInsights } from "../../src/schema/org.js";

// -- Shared fake-backend state, closed over by the mocked `Evnex` class -----

const backend = vi.hoisted(() => ({
  chargePoints: [] as EvnexChargePoint[],
  detailByCp: {} as Record<string, unknown>,
  sessionsByCp: {} as Record<string, EvnexChargePointSession[]>,
  locations: [] as unknown[],
  insights: [] as unknown[],
  insightCalls: [] as { days: number }[],
}));

const resolveMocks = vi.hoisted(() => {
  function matchChargePoint(
    chargePoints: readonly { id: string; name: string; serial: string }[],
    selector: string,
  ) {
    const exact = chargePoints.find((cp) => cp.id === selector);
    if (exact) return exact;
    const needle = selector.toLowerCase();
    const match = chargePoints.find(
      (cp) =>
        cp.name.toLowerCase().includes(needle) ||
        cp.serial.toLowerCase().includes(needle),
    );
    if (match === undefined) {
      throw new Error(`test double matchChargePoint: no match for ${selector}`);
    }
    return match;
  }
  function resolveOne(
    chargePoints: readonly { id: string; name: string; serial: string }[],
    selector: string | undefined,
  ) {
    if (selector !== undefined) return matchChargePoint(chargePoints, selector);
    const [first] = chargePoints;
    if (first === undefined) {
      throw new Error("test double resolveOne: no charge points to resolve");
    }
    return first;
  }
  return { matchChargePoint, resolveOne };
});

vi.mock("../../src/api.js", () => {
  class Evnex {
    getUserDetail = vi.fn(async () => undefined);
    getOrgChargePoints = vi.fn(async () => backend.chargePoints);
    getChargePointDetailV3 = vi.fn(async (id: string) => backend.detailByCp[id]);
    getChargePointSessions = vi.fn(async (id: string) => backend.sessionsByCp[id] ?? []);
    getOrgLocations = vi.fn(async () => backend.locations);
    getOrgInsight = vi.fn(async (options: { days: number }) => {
      backend.insightCalls.push(options);
      return backend.insights;
    });
    close = vi.fn(async () => undefined);
  }
  return { Evnex };
});

vi.mock("../../src/cli/commands/auth.js", () => ({
  signedInAuth: vi.fn(async () => ({}) as unknown),
}));

vi.mock("../../src/cli/resolve.js", () => ({
  matchChargePoint: resolveMocks.matchChargePoint,
  resolveOne: resolveMocks.resolveOne,
}));

const { createResourceCommands, openClient } =
  await import("../../src/cli/commands/resources.js");
const { signedInAuth } = await import("../../src/cli/commands/auth.js");

// -- Fixture helpers ----------------------------------------------------------

function parseChargePoints(payload: unknown): EvnexChargePoint[] {
  return EvnexGetChargePointsResponse.parse(payload).data.items;
}

function parseSessions(payload: unknown): EvnexChargePointSession[] {
  return EvnexGetChargePointSessionsResponse.parse(payload).data;
}

const detailV3Response = evnexV3ApiResponse(EvnexChargePointDetailV3Schema);
function parseDetail(payload: unknown): unknown {
  return detailV3Response.parse(payload);
}

function parseLocations(payload: unknown): unknown[] {
  return EvnexGetLocationsResponse.parse(payload).data;
}

function parseInsights(payload: unknown): unknown[] {
  return EvnexGetOrgInsights.parse(payload).data.map((entry) => entry.attributes);
}

/** A v3 charge point detail payload, with the meter/schedule swappable for edge cases. */
function detailPayload(
  options: {
    meter?: Record<string, unknown> | null;
    chargeSchedule?: { enabled: boolean; chargingSchedulePeriods: unknown[] } | null;
  } = {},
): unknown {
  const meter =
    options.meter === undefined
      ? {
          currentL1: 16,
          frequency: 50,
          power: 3600,
          register: 12345.6,
          supplyActivePower: 400,
          updatedDate: "2024-06-01T00:00:00Z",
          voltageL1N: 230,
        }
      : options.meter;
  const chargeSchedule =
    options.chargeSchedule === undefined
      ? {
          enabled: true,
          chargingSchedulePeriods: [
            { limit: 32, startPeriod: 0 },
            { limit: 0, startPeriod: 79200 },
          ],
        }
      : options.chargeSchedule;

  return {
    data: {
      id: "cp-0000001",
      type: "chargePoint",
      attributes: {
        connectors: [
          {
            evseId: "1",
            connectorFormat: "CABLE",
            connectorType: "TYPE_2_SOCKET",
            ocppStatus: "CHARGING",
            powerType: "AC_1_PHASE",
            connectorId: "1",
            ocppCode: "CHARGING",
            updatedDate: "2024-06-01T00:00:00Z",
            meter,
            maxVoltage: 230,
            maxAmperage: 32,
          },
        ],
        createdDate: "2024-01-01T00:00:00Z",
        electricityCost: {
          currency: "NZD",
          tariffs: [{ start: 0, rate: 0.28, type: "Flat" }],
          tariffType: "Flat",
          cost: 0.28,
        },
        firmware: "1.2.3",
        maxCurrent: 32,
        model: "E2",
        name: "Garage Charger",
        networkStatus: "ONLINE",
        networkStatusUpdatedDate: "2024-06-01T00:00:00Z",
        ocppChargePointId: "SN0000001",
        profiles: { chargeSchedule },
        serial: "SN0000001",
        timeZone: "Pacific/Auckland",
        tokenRequired: false,
        updatedDate: "2024-06-01T00:00:00Z",
        vendor: "Evnex",
      },
      relationships: {
        chargePoint: null,
        location: { data: { id: "loc-0000001", type: "location" } },
        organisation: { data: { id: "org-0000", type: "organisation" } },
      },
    },
    included: null,
  };
}

const CP_ID = "cp-0000001";

// -- CLI harness ---------------------------------------------------------------

const root: Command = { name: "evnex", help: "root", children: createResourceCommands() };

function run(argv: readonly string[]) {
  return runCli((a) => dispatch(root, a), argv);
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.chargePoints = [];
  backend.detailByCp = {};
  backend.sessionsByCp = {};
  backend.locations = [];
  backend.insights = [];
  backend.insightCalls = [];
});

// -- openClient ----------------------------------------------------------------

describe("openClient", () => {
  it("signs in, builds a client, and releases it via close()", async () => {
    const args: ParsedArgs = { positionals: [] };
    const { client, close } = await openClient(args);

    expect(vi.mocked(signedInAuth)).toHaveBeenCalledWith(args);
    const fakeClient = client as unknown as { close: ReturnType<typeof vi.fn> };
    expect(fakeClient.close).not.toHaveBeenCalled();

    await close();
    expect(fakeClient.close).toHaveBeenCalledTimes(1);
  });
});

// -- status ----------------------------------------------------------------

describe("status", () => {
  it("shows power and the active session (test_status_shows_power_and_active_session)", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(DETAIL_V3_PAYLOAD);
    backend.sessionsByCp[CP_ID] = parseSessions(SESSIONS_PAYLOAD);

    const result = await run(["status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Garage Charger (SN0000001)");
    expect(result.stdout).toContain("Network: ONLINE");
    expect(result.stdout).toContain("Connector 1: CHARGING");
    expect(result.stdout).toContain("Charging power: 3.60 kW");
    expect(result.stdout).toContain("Grid power: 0.40 kW");
    expect(result.stdout).toContain("Active session: 3.50 kWh");
  });

  it("emits --json as the only thing on stdout (test_status_json_is_the_only_thing_on_stdout)", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(DETAIL_V3_PAYLOAD);
    backend.sessionsByCp[CP_ID] = parseSessions(SESSIONS_PAYLOAD);

    const result = await run(["status", "--json"]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      chargePoint: { serial: string };
      sessions: { id: string }[];
    }[];
    expect(payload[0]?.chargePoint.serial).toBe("SN0000001");
    expect(payload[0]?.sessions[0]?.id).toBe("session-0000001");
  });

  it("renders a charge point with no meter (test_status_renders_charge_point_without_meter)", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(detailPayload({ meter: null }));
    backend.sessionsByCp[CP_ID] = parseSessions(SESSIONS_PAYLOAD);

    const result = await run(["status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Garage Charger");
    expect(result.stdout).not.toContain("Charging power");
  });

  it("shows a cost when the active session carries one", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(DETAIL_V3_PAYLOAD);
    backend.sessionsByCp[CP_ID] = parseSessions({
      data: [
        {
          id: "session-active-cost",
          type: "session",
          attributes: {
            startDate: "2024-06-03T08:00:00Z",
            endDate: null,
            totalPowerUsage: 5000,
            totalCost: { currency: "NZD", amount: 12.34, distribution: null },
          },
        },
      ],
    });

    const result = await run(["status"]);

    expect(result.stdout).toContain("Active session: 5.00 kWh, 12.34 NZD");
  });

  it("omits the active-session line when there are no sessions", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(DETAIL_V3_PAYLOAD);
    backend.sessionsByCp[CP_ID] = [];

    const result = await run(["status"]);

    expect(result.stdout).not.toContain("Active session");
  });

  it("omits the active-session line when the newest session has already ended", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(DETAIL_V3_PAYLOAD);
    backend.sessionsByCp[CP_ID] = parseSessions({
      data: [
        {
          id: "session-done",
          type: "session",
          attributes: {
            startDate: "2024-06-01T08:00:00Z",
            endDate: "2024-06-01T09:00:00Z",
            totalPowerUsage: 4000,
          },
        },
      ],
    });

    const result = await run(["status"]);

    expect(result.stdout).not.toContain("Active session");
  });

  it("omits the grid-power line when no power sensor is installed", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(
      detailPayload({
        meter: {
          frequency: 50,
          power: 3600,
          register: 12345.6,
          updatedDate: "2024-06-01T00:00:00Z",
        },
      }),
    );
    backend.sessionsByCp[CP_ID] = [];

    const result = await run(["status"]);

    expect(result.stdout).toContain("Charging power: 3.60 kW");
    expect(result.stdout).not.toContain("Grid power");
  });

  it("targets only the selected charge point with --charge-point", async () => {
    backend.chargePoints = parseChargePoints(TWO_CHARGE_POINTS_PAYLOAD);
    backend.detailByCp["cp-0000002"] = parseDetail(DETAIL_V3_PAYLOAD);
    backend.sessionsByCp["cp-0000002"] = [];

    const result = await run(["status", "--charge-point", "cp-0000002"]);

    expect(result.exitCode).toBe(0);
    // Only one block rendered: no blank-line block separator present.
    expect(result.stdout).not.toContain("\n\n");
  });

  it("prints 'No charge points found' to stderr when the account has none", async () => {
    backend.chargePoints = [];

    const result = await run(["status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("No charge points found");
  });
});

// -- charge-points -----------------------------------------------------------

describe("charge-points list", () => {
  it("lists charge points (test_charge_points_list)", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);

    const result = await run(["charge-points", "list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("cp-0000001");
    expect(result.stdout).toContain("Garage Charger");
    expect(result.stdout).toContain("SN0000001");
    expect(result.stdout).toContain("ONLINE");
  });

  it("emits a single JSON document with --json", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);

    const result = await run(["charge-points", "list", "--json"]);

    const payload = JSON.parse(result.stdout) as { id: string }[];
    expect(payload[0]?.id).toBe("cp-0000001");
  });
});

describe("charge-points show", () => {
  it("shows the detail of the sole charge point (test_charge_points_show)", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(DETAIL_V3_PAYLOAD);

    const result = await run(["charge-points", "show"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Model: E2");
    expect(result.stdout).toContain("Firmware: 1.2.3");
    expect(result.stdout).toContain("Charge schedule: enabled");
  });

  it("emits the raw attributes as a single JSON document with --json", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(DETAIL_V3_PAYLOAD);

    const result = await run(["charge-points", "show", "--json"]);

    const payload = JSON.parse(result.stdout) as { firmware: string; serial: string };
    expect(payload.firmware).toBe("1.2.3");
    expect(payload.serial).toBe("SN0000001");
  });

  it("resolves an explicit positional id among several charge points", async () => {
    backend.chargePoints = parseChargePoints(TWO_CHARGE_POINTS_PAYLOAD);
    backend.detailByCp["cp-0000002"] = parseDetail(DETAIL_V3_PAYLOAD);

    const result = await run(["charge-points", "show", "cp-0000002"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Garage Charger");
  });

  it("renders with no meter present", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(detailPayload({ meter: null }));

    const result = await run(["charge-points", "show"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Model: E2");
    expect(result.stdout).not.toContain("Charging power");
  });

  it("omits grid power when the meter carries no supplyActivePower", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(
      detailPayload({
        meter: {
          frequency: 50,
          power: 3600,
          register: 12345.6,
          updatedDate: "2024-06-01T00:00:00Z",
        },
      }),
    );

    const result = await run(["charge-points", "show"]);

    expect(result.stdout).toContain("Charging power: 3.60 kW");
    expect(result.stdout).not.toContain("Grid power");
  });

  it("reports a disabled schedule", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(
      detailPayload({
        chargeSchedule: {
          enabled: false,
          chargingSchedulePeriods: [{ limit: 32, startPeriod: 0 }],
        },
      }),
    );

    const result = await run(["charge-points", "show"]);

    expect(result.stdout).toContain("Charge schedule: disabled");
  });

  it("reports a disabled schedule when none is configured at all", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(detailPayload({ chargeSchedule: null }));

    const result = await run(["charge-points", "show"]);

    expect(result.stdout).toContain("Charge schedule: disabled");
  });
});

// -- sessions ----------------------------------------------------------------

describe("sessions list", () => {
  it("lists recent sessions (test_sessions_list)", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.sessionsByCp[CP_ID] = parseSessions(SESSIONS_PAYLOAD);

    const result = await run(["sessions", "list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("active"); // the in-progress session has no end date
    expect(result.stdout).toContain("7.00 kWh");
    expect(result.stdout).toContain("1.96 NZD");
  });

  it("respects --limit (test_sessions_list_respects_limit)", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.sessionsByCp[CP_ID] = parseSessions(SESSIONS_PAYLOAD);

    const result = await run(["sessions", "list", "--limit", "1"]);

    expect(result.exitCode).toBe(0);
    // Header plus exactly one data row.
    expect(result.stdout.trim().split("\n")).toHaveLength(2);
    expect(result.stdout).not.toContain("1.96 NZD");
  });

  it("defaults to at most 10 sessions when --limit is omitted (test_sessions_limit_defaults_to_ten)", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    // 12 completed sessions, each with a distinct startDate so newest-first
    // ordering is well defined; the parser-level Python test only asserts
    // `args.limit == 10`, but nothing here stops a default from being wired
    // correctly at the parser while the command forgets to apply it (or vice
    // versa) — sending 12 and counting rendered rows exercises the whole path.
    backend.sessionsByCp[CP_ID] = parseSessions({
      data: Array.from({ length: 12 }, (_, i) => ({
        id: `session-${String(i).padStart(7, "0")}`,
        type: "session",
        attributes: {
          connectorId: "1",
          createdDate: `2024-06-${String(i + 1).padStart(2, "0")}T08:00:00Z`,
          evseId: "1",
          sessionStatus: "Completed",
          startDate: `2024-06-${String(i + 1).padStart(2, "0")}T08:00:00Z`,
          updatedDate: `2024-06-${String(i + 1).padStart(2, "0")}T09:00:00Z`,
          endDate: `2024-06-${String(i + 1).padStart(2, "0")}T09:00:00Z`,
          totalPowerUsage: 1000,
          totalCost: null,
        },
      })),
    });

    const result = await run(["sessions", "list"]);

    expect(result.exitCode).toBe(0);
    // Header plus exactly ten data rows, not all twelve.
    expect(result.stdout.trim().split("\n")).toHaveLength(11);
    // The newest ten (June 3rd through June 12th) render; the two oldest
    // (June 1st and 2nd) are cut off by the default limit.
    expect(result.stdout).toContain("2024-06-12");
    expect(result.stdout).toContain("2024-06-03");
    expect(result.stdout).not.toContain("2024-06-02");
    expect(result.stdout).not.toContain("2024-06-01");
  });

  it("enforces newest-first ordering regardless of API order (test_sessions_ordering_is_enforced)", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.sessionsByCp[CP_ID] = parseSessions({
      data: [...SESSIONS_PAYLOAD.data].reverse(),
    });

    const result = await run(["sessions", "list", "--limit", "1"]);

    expect(result.stdout).toContain("active"); // the newest (active) session, not the oldest
  });

  it("sorts a session with no startDate last", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.sessionsByCp[CP_ID] = parseSessions({
      data: [
        {
          id: "s-old",
          type: "session",
          attributes: {
            startDate: "2024-06-01T08:00:00Z",
            endDate: "2024-06-01T09:00:00Z",
          },
        },
        {
          id: "s-null",
          type: "session",
          attributes: { startDate: null, endDate: null },
        },
        {
          id: "s-new",
          type: "session",
          attributes: {
            startDate: "2024-06-02T08:00:00Z",
            endDate: "2024-06-02T09:00:00Z",
          },
        },
      ],
    });

    const result = await run(["sessions", "list", "--json"]);

    const payload = JSON.parse(result.stdout) as { id: string }[];
    expect(payload.map((s) => s.id)).toEqual(["s-new", "s-old", "s-null"]);
  });

  it("rejects a non-positive --limit with exit 2", async () => {
    const result = await run(["sessions", "list", "--limit", "0"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("must be a positive integer");
  });
});

// -- locations -----------------------------------------------------------------

describe("locations list", () => {
  it("lists locations (test_locations_list)", async () => {
    backend.locations = parseLocations(LOCATIONS_PAYLOAD);

    const result = await run(["locations", "list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Home");
    expect(result.stdout).toContain("Wellington");
    expect(result.stdout).toContain("0000123456UN789");
    expect(result.stdout).toContain("Example Energy");
    expect(result.stdout).toContain("Pacific/Auckland");
  });

  it("emits --json as the only thing on stdout (test_locations_list_json_is_the_only_thing_on_stdout)", async () => {
    backend.locations = parseLocations(LOCATIONS_PAYLOAD);

    const result = await run(["locations", "list", "--json"]);

    const payload = JSON.parse(result.stdout) as {
      id: string;
      attributes: { name: string };
    }[];
    expect(payload[0]?.id).toBe("3fa85f64-5717-4562-b3fc-2c963f66afa6");
    expect(payload[0]?.attributes.name).toBe("Home");
  });

  it("handles a location with no address (test_locations_list_handles_missing_address)", async () => {
    backend.locations = parseLocations({ data: [LOCATION_MINIMAL] });

    const result = await run(["locations", "list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Depot");
  });
});

// -- insights --------------------------------------------------------------

describe("insights", () => {
  it("shows daily energy, cost, and session counts (test_insights)", async () => {
    backend.insights = parseInsights(INSIGHTS_PAYLOAD);

    const result = await run(["insights"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("2024-06-10");
    expect(result.stdout).toContain("1.00 kWh");
    expect(result.stdout).toContain("1.50 NZD");
  });

  it("defaults --days to 7 (test_insights_defaults)", async () => {
    backend.insights = [];

    const result = await run(["insights"]);

    expect(result.exitCode).toBe(0);
    expect(backend.insightCalls).toEqual([{ days: 7 }]);
  });

  it("rejects an unsupported --days value with exit 2 (test_insights_rejects)", async () => {
    const result = await run(["insights", "--days", "3"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("argument --days");
    expect(backend.insightCalls).toEqual([]);
  });

  it("accepts --days 14 and forwards it", async () => {
    backend.insights = [];

    const result = await run(["insights", "--days", "14"]);

    expect(result.exitCode).toBe(0);
    expect(backend.insightCalls).toEqual([{ days: 14 }]);
  });

  it("renders '-' when a day has no cost", async () => {
    backend.insights = parseInsights({
      data: [
        {
          attributes: {
            carbonOffset: 0,
            carbonUsage: null,
            cost: { currency: "NZD", cost: null },
            duration: 60,
            powerUsage: 500,
            sessions: 1,
            startDate: "2024-06-12T00:00:00Z",
          },
        },
      ],
    });

    const result = await run(["insights"]);

    const lines = result.stdout.trim().split("\n");
    const row = lines[1] ?? "";
    expect(row).toContain("0.50 kWh");
    expect(row).toMatch(/-\s+1\s*$/);
  });

  it("renders a cost with no currency as a bare amount", async () => {
    backend.insights = parseInsights({
      data: [
        {
          attributes: {
            carbonOffset: 0,
            carbonUsage: null,
            cost: { currency: null, cost: 3 },
            duration: 60,
            powerUsage: 500,
            sessions: 1,
            startDate: "2024-06-13T00:00:00Z",
          },
        },
      ],
    });

    const result = await run(["insights"]);

    const lines = result.stdout.trim().split("\n");
    const row = lines[1] ?? "";
    expect(row).toContain("3.00");
    expect(row).not.toContain("3.00 NZD");
  });
});

// -- schedule ----------------------------------------------------------------

describe("schedule show", () => {
  it("shows the schedule (test_schedule_show)", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(DETAIL_V3_PAYLOAD);

    const result = await run(["schedule", "show"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Charge schedule for Garage Charger: enabled");
    expect(result.stdout).toContain("00:00");
    expect(result.stdout).toContain("22:00");
    expect(result.stdout).toContain("32 A");
  });

  it("emits the schedule as JSON (test_schedule_show_json)", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(DETAIL_V3_PAYLOAD);

    const result = await run(["schedule", "show", "--json"]);

    const payload = JSON.parse(result.stdout) as {
      enabled: boolean;
      chargingSchedulePeriods: { limit: number }[];
    };
    expect(payload.enabled).toBe(true);
    expect(payload.chargingSchedulePeriods[0]?.limit).toBe(32);
  });

  it("reports a disabled schedule", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(
      detailPayload({
        chargeSchedule: {
          enabled: false,
          chargingSchedulePeriods: [{ limit: 32, startPeriod: 0 }],
        },
      }),
    );

    const result = await run(["schedule", "show"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Charge schedule for Garage Charger: disabled");
  });

  it("reports no schedule configured, in plain text", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(detailPayload({ chargeSchedule: null }));

    const result = await run(["schedule", "show"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("No charge schedule configured for Garage Charger\n");
  });

  it("emits a bare JSON null when no schedule is configured", async () => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.detailByCp[CP_ID] = parseDetail(detailPayload({ chargeSchedule: null }));

    const result = await run(["schedule", "show", "--json"]);

    expect(result.stdout).toBe("null\n");
  });
});

// -- JSON purity on listings --------------------------------------------------

describe("JSON purity on listings (test_json_purity_on_listings)", () => {
  const cases: { argv: readonly string[] }[] = [
    { argv: ["charge-points", "list"] },
    { argv: ["sessions", "list"] },
    { argv: ["insights"] },
  ];

  it.each(cases)("stdout is exactly one JSON document for `$argv`", async ({ argv }) => {
    backend.chargePoints = parseChargePoints(CHARGE_POINTS_PAYLOAD);
    backend.sessionsByCp[CP_ID] = parseSessions(SESSIONS_PAYLOAD);
    backend.insights = parseInsights(INSIGHTS_PAYLOAD);

    const result = await run([...argv, "--json"]);

    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });
});
