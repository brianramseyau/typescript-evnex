/**
 * Tests for `src/api.ts`'s `Evnex` client — PLAN.md §5 B3.
 *
 * One happy-path test per method (method, path, query, body, parsed return),
 * plus explicit retry-policy coverage per PLAN.md §2.5's per-method
 * non-retryable table — the write/command surface this file covers is 28%
 * untested upstream (§6.3), and it is exactly the methods carrying these
 * hand-tuned exception sets.
 *
 * Auth is a real `EvnexAuth` instance built via `Object.create` (bypassing
 * its constructor, which — like every class it delegates to — only calls
 * `getAccessToken`), so these tests do not depend on B1's `CognitoSession` or
 * B2's `AccountOperations` (`src/auth/{session,account}.ts`), which are being
 * written concurrently in sibling worktrees. `getAccessToken` is the only
 * method `withAuthFlow` ever calls in these tests (no route ever answers
 * 401, so `forceRefresh` is never exercised — that path belongs to
 * `test/http/authFlow.test.ts`, A8).
 */

import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Evnex } from "../src/api.js";
import { EvnexAuth } from "../src/auth/index.js";
import { EvnexConfig } from "../src/config.js";
import { EvnexConfigurationError, EvnexValidationError } from "../src/errors.js";
import { EvnexHttpError, EvnexTimeoutError } from "../src/http/errors.js";
import { createStubFetch } from "./support/stubFetch.js";
import type { StubFetch, StubRoute } from "./support/stubFetch.js";
import {
  CHARGE_POINTS_PATH,
  CHARGE_POINTS_PAYLOAD,
  CHARGE_POINT_DETAIL_PATH,
  CHARGE_POINT_OVERRIDE_PATH,
  CHARGE_POINT_SESSIONS_PATH,
  CHARGE_POINT_STOP_PATH,
  CONNECTOR_SUMMARY_PAYLOAD,
  DETAIL_V3_PAYLOAD,
  INSIGHTS_PAYLOAD,
  LOCATIONS_PAYLOAD,
  ORG_CONNECTOR_SUMMARY_PATH,
  ORG_INSIGHTS_PATH,
  ORG_LOCATIONS_PATH,
  SESSIONS_PAYLOAD,
  USER_PATH,
  USER_PAYLOAD,
} from "./support/fixtures.js";

const ORG_ID = "org-0000";
const CP_ID = "cp-0000001";

// -- Local fixtures for endpoints no upstream test exercises (PLAN.md §6.3) --
// A9's fixtures.ts covers the read paths shared with C3/C4; the write/command
// surface below has no Python test to transcribe a payload from, so these are
// original, minimal-but-schema-complete payloads.

const ORG_SUMMARY_STATUS_PATH = `/v2/apps/organisations/${ORG_ID}/summary/status`;
const ORG_SUMMARY_STATUS_PAYLOAD = {
  data: {
    charging: 1,
    available: 3,
    disabled: 0,
    faulted: 0,
    occupied: 1,
    offline: 2,
    reserved: 0,
  },
};

const CHARGE_POINT_DETAIL_V2_PATH = `/v2/apps/charge-points/${CP_ID}`;
const CHARGE_POINT_DETAIL_V2_PAYLOAD = {
  data: {
    id: CP_ID,
    createdDate: "2024-01-01T00:00:00Z",
    updatedDate: "2024-06-01T00:00:00Z",
    networkStatusUpdatedDate: "2024-06-01T00:00:00Z",
    name: "Garage Charger",
    ocppChargePointId: "SN0000001",
    serial: "SN0000001",
    networkStatus: "ONLINE",
    location: {
      id: "loc-0000001",
      name: "Home",
      createdDate: "2024-01-01T00:00:00Z",
      updatedDate: "2024-01-01T00:00:00Z",
      chargePointCount: 1,
    },
    configuration: { maxCurrent: 32, plugAndCharge: false },
    electricityCost: { currency: "NZD", costs: [{ cost: 0.28, start: 0 }] },
    loadSchedule: {
      duration: 86_400,
      enabled: true,
      units: "A",
      chargingProfilePeriods: [{ limit: 32, start: 0 }],
    },
    connectors: [],
  },
};

const TRANSACTIONS_PATH = `/v2/apps/charge-points/${CP_ID}/transactions`;
const TRANSACTIONS_PAYLOAD = {
  data: {
    items: [
      {
        id: "txn-0000001",
        connectorId: "1",
        evseId: "1",
        powerUsage: 7000,
        startDate: "2024-06-01T08:00:00Z",
        endDate: "2024-06-01T09:00:00Z",
      },
    ],
  },
};

const SOLAR_CONFIG_PATH = `/charge-points/${CP_ID}/commands/get-solar`;
const SOLAR_CONFIG_PAYLOAD = {
  solarWithSchedule: true,
  powerSensorInstalled: true,
  solarStartExportPower: 100,
  solarStopImportPower: 50,
};

const GET_OVERRIDE_PATH = `/charge-points/${CP_ID}/commands/get-override`;
const GET_OVERRIDE_PAYLOAD = { chargeNow: true };

const STATUS_PATH = `/charge-points/${CP_ID}/commands/get-status`;
const STATUS_PAYLOAD = {
  data: { commandResultStatus: "Accepted", chargePointStatus: null },
};

const ENERGY_METER_PATH = `/charge-points/${CP_ID}/commands/get-energy-meter-reading`;
const ENERGY_METER_PAYLOAD = {
  data: {
    timestamp: "2024-06-01T09:00:00Z",
    chargingActivePower: 7000,
    supplyActivePower: 7200,
  },
  status: "Accepted",
};

const AVAILABILITY_PATH = `/v2/apps/organisations/${ORG_ID}/charge-points/${CP_ID}/commands/change-availability`;
const COMMAND_V3_PAYLOAD = { data: { message: "OK", status: "Accepted" } };

const UNLOCK_PATH = `/v2/apps/organisations/${ORG_ID}/charge-points/${CP_ID}/commands/unlock-connector`;
const COMMAND_V2_PAYLOAD = { data: { message: "OK", status: "Accepted" } };

const STOP_PAYLOAD = { data: { message: "Stopping", status: "Accepted" } };

const LOAD_MANAGEMENT_PATH = `/v2/apps/charge-points/${CP_ID}/load-management`;
const CHARGE_SCHEDULE_PATH = `/v2/apps/charge-points/${CP_ID}/charge-schedule`;
const LOAD_SCHEDULE_PAYLOAD = {
  data: {
    duration: 86_400,
    enabled: true,
    units: "A",
    chargingProfilePeriods: [
      { limit: 0, start: 0 },
      { limit: 32, start: 3600 },
    ],
  },
};

// -- Test helpers -------------------------------------------------------------

/**
 * A real `EvnexAuth` with `getAccessToken` overridden — `Object.create`
 * bypasses the constructor (and therefore B1/B2's still-`TODO(...)`
 * collaborators) entirely, since TS's `private` fields are erased at
 * runtime. `forceRefresh` is intentionally left as the real (delegating)
 * implementation: no test here ever triggers a 401, so it is never called.
 */
function fakeAuth(token = "access-token"): EvnexAuth {
  const auth = Object.create(EvnexAuth.prototype) as EvnexAuth;
  auth.getAccessToken = () => Promise.resolve(token);
  return auth;
}

interface BuildClientOptions {
  routes?: StubRoute[];
  /** Explicit `undefined` forces an unset org id regardless of ambient env. */
  orgId?: string | undefined;
}

function buildClient(options: BuildClientOptions = {}): {
  client: Evnex;
  stub: StubFetch;
} {
  const stub = createStubFetch(options.routes ?? []);
  const config = new EvnexConfig({ EVNEX_ORG_ID: options.orgId });
  const client = new Evnex({ auth: fakeAuth(), fetch: stub.fetch, config });
  return { client, stub };
}

/** A route that always throws, simulating a request timeout (PLAN.md §2.7). */
function timeoutRoute(method: string, path: string): StubRoute {
  return {
    method,
    path,
    handler: () => {
      throw new DOMException("simulated read timeout", "TimeoutError");
    },
  };
}

/** A route that always fails with a 500 (-> EvnexHttpError). */
function serverErrorRoute(method: string, path: string): StubRoute {
  return { method, path, status: 500, json: { message: "server exploded" } };
}

/**
 * A route that always throws a raw `TypeError` — the shape of a genuine
 * network-level `fetch` failure (e.g. undici's "fetch failed"), which
 * `Transport` does not translate (it only recognises abort/timeout errors)
 * and so propagates unchanged. Used to demonstrate that a method whose
 * non-retryable set already covers `EvnexHttpError`/`EvnexTimeoutError`
 * still retries *something*.
 */
function networkErrorRoute(method: string, path: string): StubRoute {
  return {
    method,
    path,
    handler: () => {
      throw new TypeError("fetch failed");
    },
  };
}

/** Run `fn` under fake timers so a real retry's backoff delay costs no wall-clock time. */
async function withFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const promise = fn();
    await vi.runAllTimersAsync();
    return await promise;
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// -- Construction ---------------------------------------------------------

describe("Evnex construction", () => {
  it("resolves orgId from config.EVNEX_ORG_ID and version from the transport", () => {
    const { client } = buildClient({ orgId: ORG_ID });
    expect(client.orgId).toBe(ORG_ID);
    expect(client.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("leaves orgId undefined when EVNEX_ORG_ID is unset", () => {
    const { client } = buildClient({ orgId: undefined });
    expect(client.orgId).toBeUndefined();
  });

  it("builds a default EvnexConfig when none is given", () => {
    const auth = fakeAuth();
    const client = new Evnex({ auth });
    expect(client.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("close() resolves and is safe to call more than once", async () => {
    const { client } = buildClient();
    await expect(client.close()).resolves.toBeUndefined();
    await expect(client.close()).resolves.toBeUndefined();
  });
});

// -- Org id resolution (mirrors test_get_user_detail_*, test_org_method_without_org_id_raises) --

describe("organisation id resolution", () => {
  it("test_get_user_detail_preserves_configured_org — a configured org id survives sign-in", async () => {
    const { client, stub } = buildClient({
      orgId: "configured-org",
      routes: [{ method: "GET", path: USER_PATH, json: USER_PAYLOAD }],
    });

    await client.getUserDetail();

    expect(client.orgId).toBe("configured-org");
    expect(stub.callsFor("GET", USER_PATH)).toHaveLength(1);
  });

  it("test_get_user_detail_defaults_org_when_unset — defaults to the user's first org", async () => {
    const { client } = buildClient({
      orgId: undefined,
      routes: [{ method: "GET", path: USER_PATH, json: USER_PAYLOAD }],
    });

    await client.getUserDetail();

    expect(client.orgId).toBe(ORG_ID);
  });

  it("test_get_user_detail_defaults_org_when_blank — a present-but-empty org id counts as unset", async () => {
    const { client } = buildClient({
      routes: [{ method: "GET", path: USER_PATH, json: USER_PAYLOAD }],
    });
    client.orgId = "";

    await client.getUserDetail();

    expect(client.orgId).toBe(ORG_ID);
  });

  it("does not default the org when the user has no organisations", async () => {
    const { client } = buildClient({
      orgId: undefined,
      routes: [
        {
          method: "GET",
          path: USER_PATH,
          json: { data: { ...USER_PAYLOAD.data, organisations: [] } },
        },
      ],
    });

    await client.getUserDetail();

    expect(client.orgId).toBeUndefined();
  });

  it("test_org_method_without_org_id_raises — fails fast, with no request sent", async () => {
    const { client, stub } = buildClient({ orgId: undefined });

    await expect(client.getOrgLocations()).rejects.toThrow(EvnexConfigurationError);
    await expect(client.getOrgLocations()).rejects.toThrow(/No organisation id/);
    expect(stub.calls).toHaveLength(0);
  });

  it("an explicit orgId argument overrides the client's resolved org", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [
        {
          method: "GET",
          path: "/v2/apps/organisations/org-other/locations",
          json: LOCATIONS_PAYLOAD,
        },
      ],
    });

    await client.getOrgLocations("org-other");

    expect(
      stub.callsFor("GET", "/v2/apps/organisations/org-other/locations"),
    ).toHaveLength(1);
    // The client's own resolved default is untouched by a one-off override.
    expect(client.orgId).toBe(ORG_ID);
  });
});

// -- Happy path: one test per method (method, path, query, body, parsed return) --

describe("happy paths", () => {
  it("getUserDetail — GET /v2/apps/user", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "GET", path: USER_PATH, json: USER_PAYLOAD }],
    });

    const user = await client.getUserDetail();

    const call = stub.callsFor("GET", USER_PATH)[0];
    expect(call?.json).toBeUndefined();
    expect(user.email).toBe("user@example.com");
    expect(user.organisations[0]?.id).toBe(ORG_ID);
  });

  it("getOrgChargePoints — GET /v2/apps/organisations/{org}/charge-points", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [{ method: "GET", path: CHARGE_POINTS_PATH, json: CHARGE_POINTS_PAYLOAD }],
    });

    const chargePoints = await client.getOrgChargePoints();

    expect(stub.callsFor("GET", CHARGE_POINTS_PATH)).toHaveLength(1);
    expect(chargePoints).toHaveLength(1);
    expect(chargePoints[0]?.id).toBe(CP_ID);
    expect(chargePoints[0]?.name).toBe("Garage Charger");
  });

  it("getOrgInsight — GET /organisations/{org}/summary/insights?days&tz-offset", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [{ method: "GET", path: ORG_INSIGHTS_PATH, json: INSIGHTS_PAYLOAD }],
    });

    const insights = await client.getOrgInsight({ days: 7 });

    const call = stub.callsFor("GET", ORG_INSIGHTS_PATH)[0];
    expect(call?.query.get("days")).toBe("7");
    expect(call?.query.get("tz-offset")).toBe("12");
    expect(insights).toHaveLength(2);
    expect(insights[0]?.cost.cost).toBe(1.5);
  });

  it("getOrgInsight — honours an explicit tzOffset", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [{ method: "GET", path: ORG_INSIGHTS_PATH, json: INSIGHTS_PAYLOAD }],
    });

    await client.getOrgInsight({ days: 30, tzOffset: -5 });

    const call = stub.callsFor("GET", ORG_INSIGHTS_PATH)[0];
    expect(call?.query.get("days")).toBe("30");
    expect(call?.query.get("tz-offset")).toBe("-5");
  });

  it("getOrgSummaryStatus — GET /v2/apps/organisations/{org}/summary/status", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [
        {
          method: "GET",
          path: ORG_SUMMARY_STATUS_PATH,
          json: ORG_SUMMARY_STATUS_PAYLOAD,
        },
      ],
    });

    const status = await client.getOrgSummaryStatus();

    expect(stub.callsFor("GET", ORG_SUMMARY_STATUS_PATH)).toHaveLength(1);
    expect(status.charging).toBe(1);
    expect(status.available).toBe(3);
  });

  it("getOrgLocations — GET /v2/apps/organisations/{org}/locations, returns the data objects directly", async () => {
    // test_get_org_locations_returns_data_objects
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [{ method: "GET", path: ORG_LOCATIONS_PATH, json: LOCATIONS_PAYLOAD }],
    });

    const locations = await client.getOrgLocations();

    expect(stub.callsFor("GET", ORG_LOCATIONS_PATH)).toHaveLength(1);
    expect(locations[0]?.id).toBe("3fa85f64-5717-4562-b3fc-2c963f66afa6");
    expect(locations[0]?.attributes.name).toBe("Home");
    expect(locations[0]?.attributes.address?.city).toBe("Wellington");
    expect(locations[0]?.relationships.chargePoints.data[0]?.id).toBe(CP_ID);
  });

  it("getOrgConnectorSummary — GET /organisations/{org}/summary/status", async () => {
    // test_get_org_connector_summary
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [
        {
          method: "GET",
          path: ORG_CONNECTOR_SUMMARY_PATH,
          json: CONNECTOR_SUMMARY_PAYLOAD,
        },
      ],
    });

    const summary = await client.getOrgConnectorSummary();

    expect(stub.callsFor("GET", ORG_CONNECTOR_SUMMARY_PATH)).toHaveLength(1);
    expect(summary.available).toBe(3);
    expect(summary.charging).toBe(1);
    expect(summary.offline).toBe(2);
  });

  it("getChargePointDetail (deprecated v2) — GET /v2/apps/charge-points/{cp}", async () => {
    const { client, stub } = buildClient({
      routes: [
        {
          method: "GET",
          path: CHARGE_POINT_DETAIL_V2_PATH,
          json: CHARGE_POINT_DETAIL_V2_PAYLOAD,
        },
      ],
    });

    const detail = await client.getChargePointDetail(CP_ID);

    expect(stub.callsFor("GET", CHARGE_POINT_DETAIL_V2_PATH)).toHaveLength(1);
    expect(detail.id).toBe(CP_ID);
    expect(detail.configuration.maxCurrent).toBe(32);
    expect(detail.loadSchedule.duration).toBe(86_400);
  });

  it("getChargePointDetailV3 — GET /charge-points/{cp}, JSON:API envelope, no /v2/apps prefix", async () => {
    const { client, stub } = buildClient({
      routes: [
        { method: "GET", path: CHARGE_POINT_DETAIL_PATH, json: DETAIL_V3_PAYLOAD },
      ],
    });

    const detail = await client.getChargePointDetailV3(CP_ID);

    expect(stub.callsFor("GET", CHARGE_POINT_DETAIL_PATH)).toHaveLength(1);
    expect(detail.data.id).toBe(CP_ID);
    expect(detail.data.attributes.timeZone).toBe("Pacific/Auckland");
  });

  it("getChargePointSolarConfig — POST /charge-points/{cp}/commands/get-solar", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "POST", path: SOLAR_CONFIG_PATH, json: SOLAR_CONFIG_PAYLOAD }],
    });

    const solar = await client.getChargePointSolarConfig(CP_ID);

    const call = stub.callsFor("POST", SOLAR_CONFIG_PATH)[0];
    expect(call?.json).toBeUndefined();
    expect(solar.solarStartExportPower).toBe(100);
  });

  it("getChargePointOverride — POST .../commands/get-override, 15s timeout", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "POST", path: GET_OVERRIDE_PATH, json: GET_OVERRIDE_PAYLOAD }],
    });

    const override = await client.getChargePointOverride(CP_ID);

    expect(stub.callsFor("POST", GET_OVERRIDE_PATH)).toHaveLength(1);
    expect(override.chargeNow).toBe(true);
  });

  it("setChargePointOverride — POST .../commands/set-override, body + 10s timeout, no response parsing", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "POST", path: CHARGE_POINT_OVERRIDE_PATH, status: 200 }],
    });

    const result = await client.setChargePointOverride({
      chargePointId: CP_ID,
      chargeNow: true,
    });

    const call = stub.callsFor("POST", CHARGE_POINT_OVERRIDE_PATH)[0];
    expect(call?.json).toEqual({ connectorId: 1, chargeNow: true });
    expect(result).toBe(true);
  });

  it("setChargePointOverride — connectorId defaults to 1 but can be overridden", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "POST", path: CHARGE_POINT_OVERRIDE_PATH, status: 200 }],
    });

    await client.setChargePointOverride({
      chargePointId: CP_ID,
      chargeNow: false,
      connectorId: 2,
    });

    const call = stub.callsFor("POST", CHARGE_POINT_OVERRIDE_PATH)[0];
    expect(call?.json).toEqual({ connectorId: 2, chargeNow: false });
  });

  it("getChargePointStatus — POST /charge-points/{cp}/commands/get-status", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "POST", path: STATUS_PATH, json: STATUS_PAYLOAD }],
    });

    const status = await client.getChargePointStatus(CP_ID);

    expect(stub.callsFor("POST", STATUS_PATH)).toHaveLength(1);
    expect(status.data.commandResultStatus).toBe("Accepted");
    expect(status.data.chargePointStatus).toBeNull();
  });

  it("getChargePointEnergyMeterReading — POST .../commands/get-energy-meter-reading", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "POST", path: ENERGY_METER_PATH, json: ENERGY_METER_PAYLOAD }],
    });

    const reading = await client.getChargePointEnergyMeterReading(CP_ID);

    expect(stub.callsFor("POST", ENERGY_METER_PATH)).toHaveLength(1);
    expect(reading.data.chargingActivePower).toBe(7000);
    expect(reading.status).toBe("Accepted");
  });

  it("getChargePointTransactions (deprecated v2) — GET /v2/apps/charge-points/{cp}/transactions", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "GET", path: TRANSACTIONS_PATH, json: TRANSACTIONS_PAYLOAD }],
    });

    const transactions = await client.getChargePointTransactions(CP_ID);

    expect(stub.callsFor("GET", TRANSACTIONS_PATH)).toHaveLength(1);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.id).toBe("txn-0000001");
  });

  it("getChargePointSessions — GET /charge-points/{cp}/sessions, JSON:API data[].attributes", async () => {
    const { client, stub } = buildClient({
      routes: [
        { method: "GET", path: CHARGE_POINT_SESSIONS_PATH, json: SESSIONS_PAYLOAD },
      ],
    });

    const sessions = await client.getChargePointSessions(CP_ID);

    expect(stub.callsFor("GET", CHARGE_POINT_SESSIONS_PATH)).toHaveLength(1);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.id).toBe("session-0000001");
    expect(sessions[0]?.attributes.sessionStatus).toBe("InProgress");
  });

  it("stopChargePoint — POST .../commands/remote-stop-transaction, resolves org, parses data", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [{ method: "POST", path: CHARGE_POINT_STOP_PATH, json: STOP_PAYLOAD }],
    });

    const response = await client.stopChargePoint({ chargePointId: CP_ID });

    const call = stub.callsFor("POST", CHARGE_POINT_STOP_PATH)[0];
    expect(call?.json).toEqual({ connectorId: "1" });
    expect(response.status).toBe("Accepted");
  });

  it("enableCharger — delegates to setChargerAvailability(available: true)", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "POST", path: AVAILABILITY_PATH, json: COMMAND_V3_PAYLOAD }],
    });

    const result = await client.enableCharger({ orgId: ORG_ID, chargePointId: CP_ID });

    const call = stub.callsFor("POST", AVAILABILITY_PATH)[0];
    expect(call?.json).toEqual({ connectorId: 1, changeAvailabilityType: "Operative" });
    expect(result).toBeUndefined();
  });

  it("disableCharger — delegates to setChargerAvailability(available: false)", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "POST", path: AVAILABILITY_PATH, json: COMMAND_V3_PAYLOAD }],
    });

    await client.disableCharger({ orgId: ORG_ID, chargePointId: CP_ID });

    const call = stub.callsFor("POST", AVAILABILITY_PATH)[0];
    expect(call?.json).toEqual({ connectorId: 1, changeAvailabilityType: "Inoperative" });
  });

  it("setChargerAvailability — POST .../commands/change-availability, parses data (v3 command response)", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "POST", path: AVAILABILITY_PATH, json: COMMAND_V3_PAYLOAD }],
    });

    const result = await client.setChargerAvailability({
      orgId: ORG_ID,
      chargePointId: CP_ID,
      connectorId: 2,
    });

    const call = stub.callsFor("POST", AVAILABILITY_PATH)[0];
    expect(call?.json).toEqual({ connectorId: 2, changeAvailabilityType: "Operative" });
    expect(result.status).toBe("Accepted");
  });

  it("unlockCharger — POST .../commands/unlock-connector, uses the client's resolved org", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [{ method: "POST", path: UNLOCK_PATH, json: COMMAND_V2_PAYLOAD }],
    });

    const result = await client.unlockCharger({ chargePointId: CP_ID });

    const call = stub.callsFor("POST", UNLOCK_PATH)[0];
    expect(call?.json).toEqual({ connectorId: "0", changeAvailabilityType: "Operative" });
    expect(result.status).toBe("Accepted");
  });

  it("unlockCharger — available: false sends Inoperative", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [{ method: "POST", path: UNLOCK_PATH, json: COMMAND_V2_PAYLOAD }],
    });

    await client.unlockCharger({
      chargePointId: CP_ID,
      available: false,
      connectorId: "1",
    });

    const call = stub.callsFor("POST", UNLOCK_PATH)[0];
    expect(call?.json).toEqual({
      connectorId: "1",
      changeAvailabilityType: "Inoperative",
    });
  });

  it("unlockCharger — fails fast (no request) when the client has no resolved org", async () => {
    // A deliberate deviation from Python's unlock_charger, which uses
    // `self.org_id` directly and would instead emit a literal "None" in the
    // request path — see this file's PARITY notes.
    const { client, stub } = buildClient({ orgId: undefined });

    await expect(client.unlockCharger({ chargePointId: CP_ID })).rejects.toThrow(
      EvnexConfigurationError,
    );
    expect(stub.calls).toHaveLength(0);
  });

  it("setChargerLoadProfile — PUT /v2/apps/charge-points/{cp}/load-management", async () => {
    const { client, stub } = buildClient({
      routes: [
        { method: "PUT", path: LOAD_MANAGEMENT_PATH, json: LOAD_SCHEDULE_PAYLOAD },
      ],
    });

    const schedule = await client.setChargerLoadProfile({
      chargePointId: CP_ID,
      chargingProfilePeriods: [
        { limit: 0, start: 0 },
        { limit: 32, start: 3600 },
      ],
    });

    const call = stub.callsFor("PUT", LOAD_MANAGEMENT_PATH)[0];
    expect(call?.json).toEqual({
      chargingProfilePeriods: [
        { limit: 0, start: 0 },
        { limit: 32, start: 3600 },
      ],
      enabled: true,
      units: "A",
      duration: 86_400,
    });
    expect(schedule.chargingProfilePeriods).toHaveLength(2);
  });

  it("setChargerLoadProfile — strips unknown fields from each segment, mirroring pydantic re-validation", async () => {
    const { client, stub } = buildClient({
      routes: [
        { method: "PUT", path: LOAD_MANAGEMENT_PATH, json: LOAD_SCHEDULE_PAYLOAD },
      ],
    });

    await client.setChargerLoadProfile({
      chargePointId: CP_ID,
      chargingProfilePeriods: [
        { limit: 0, start: 0, extra: "should be stripped" } as unknown as {
          limit: number;
          start: number;
        },
      ],
      enabled: false,
      duration: 3600,
      units: "kW",
    });

    const call = stub.callsFor("PUT", LOAD_MANAGEMENT_PATH)[0];
    expect(call?.json).toEqual({
      chargingProfilePeriods: [{ limit: 0, start: 0 }],
      enabled: false,
      units: "kW",
      duration: 3600,
    });
  });

  it("setChargePointSchedule — PUT /v2/apps/charge-points/{cp}/charge-schedule, no units/timezone in body", async () => {
    const { client, stub } = buildClient({
      routes: [
        { method: "PUT", path: CHARGE_SCHEDULE_PATH, json: LOAD_SCHEDULE_PAYLOAD },
      ],
    });

    const schedule = await client.setChargePointSchedule({
      chargePointId: CP_ID,
      chargingProfilePeriods: [{ limit: 0, start: 0 }],
    });

    const call = stub.callsFor("PUT", CHARGE_SCHEDULE_PATH)[0];
    expect(call?.json).toEqual({
      chargingProfilePeriods: [{ limit: 0, start: 0 }],
      enabled: true,
      duration: 86_400,
    });
    expect(call?.json).not.toHaveProperty("units");
    expect(call?.json).not.toHaveProperty("timezone");
    expect(schedule.enabled).toBe(true);
  });
});

// -- Deprecation warnings (one-shot) ---------------------------------------

describe("deprecation warnings", () => {
  it("getChargePointDetail warns once via process.emitWarning, not on a second call", async () => {
    const { client } = buildClient({
      routes: [
        {
          method: "GET",
          path: CHARGE_POINT_DETAIL_V2_PATH,
          json: CHARGE_POINT_DETAIL_V2_PAYLOAD,
        },
      ],
    });
    const spy = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);

    await client.getChargePointDetail(CP_ID);
    await client.getChargePointDetail(CP_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("deprecated"),
      "DeprecationWarning",
    );
  });

  it("getChargePointTransactions warns once via process.emitWarning, not on a second call", async () => {
    const { client } = buildClient({
      routes: [{ method: "GET", path: TRANSACTIONS_PATH, json: TRANSACTIONS_PAYLOAD }],
    });
    const spy = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);

    await client.getChargePointTransactions(CP_ID);
    await client.getChargePointTransactions(CP_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("deprecated"),
      "DeprecationWarning",
    );
  });

  it("warnings are independent per client instance", async () => {
    const routes: StubRoute[] = [
      {
        method: "GET",
        path: CHARGE_POINT_DETAIL_V2_PATH,
        json: CHARGE_POINT_DETAIL_V2_PAYLOAD,
      },
    ];
    const { client: clientA } = buildClient({ routes });
    const { client: clientB } = buildClient({ routes });
    const spy = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);

    await clientA.getChargePointDetail(CP_ID);
    await clientB.getChargePointDetail(CP_ID);

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// -- Response validation ----------------------------------------------------

describe("response validation", () => {
  it("wraps a schema mismatch in EvnexValidationError, with the ZodError on cause, and does not retry", async () => {
    const { client, stub } = buildClient({
      routes: [{ method: "GET", path: USER_PATH, json: { data: { id: "not-a-uuid" } } }],
    });

    const error = await client.getUserDetail().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(EvnexValidationError);
    expect((error as EvnexValidationError).cause).toBeInstanceOf(z.ZodError);
    expect(stub.callsFor("GET", USER_PATH)).toHaveLength(1);
  });
});

// -- Retry policy (PLAN.md §2.5) --------------------------------------------
//
// Every method below is exercised for BOTH halves of its policy: the
// exception type(s) PLAN.md §2.5 adds to the non-retryable set must fail on
// the first attempt with no retry, and at least one exception type NOT in
// that set must still be retried up to the 5-attempt cap. This is the part
// of the port §6.3 flags as least verified upstream.

describe("retry policy — extra non-retryable additions (PLAN.md §2.5)", () => {
  it("getOrgChargePoints: does not retry EvnexHttpError", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [serverErrorRoute("GET", CHARGE_POINTS_PATH)],
    });

    await expect(client.getOrgChargePoints()).rejects.toBeInstanceOf(EvnexHttpError);
    expect(stub.callsFor("GET", CHARGE_POINTS_PATH)).toHaveLength(1);
  });

  it("getOrgChargePoints: still retries EvnexTimeoutError to the 5-attempt cap", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [timeoutRoute("GET", CHARGE_POINTS_PATH)],
    });

    await withFakeTimers(() =>
      expect(client.getOrgChargePoints()).rejects.toBeInstanceOf(EvnexTimeoutError),
    );
    expect(stub.callsFor("GET", CHARGE_POINTS_PATH)).toHaveLength(5);
  });

  it("getOrgLocations: does not retry EvnexHttpError", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [serverErrorRoute("GET", ORG_LOCATIONS_PATH)],
    });

    await expect(client.getOrgLocations()).rejects.toBeInstanceOf(EvnexHttpError);
    expect(stub.callsFor("GET", ORG_LOCATIONS_PATH)).toHaveLength(1);
  });

  it("getOrgLocations: still retries EvnexTimeoutError to the 5-attempt cap", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [timeoutRoute("GET", ORG_LOCATIONS_PATH)],
    });

    await withFakeTimers(() =>
      expect(client.getOrgLocations()).rejects.toBeInstanceOf(EvnexTimeoutError),
    );
    expect(stub.callsFor("GET", ORG_LOCATIONS_PATH)).toHaveLength(5);
  });

  it("getChargePointDetailV3: does not retry TypeError", async () => {
    const { client, stub } = buildClient({
      routes: [
        {
          method: "GET",
          path: CHARGE_POINT_DETAIL_PATH,
          handler: () => {
            throw new TypeError(
              "simulated parity with pydantic's generic-model TypeError",
            );
          },
        },
      ],
    });

    await expect(client.getChargePointDetailV3(CP_ID)).rejects.toBeInstanceOf(TypeError);
    expect(stub.callsFor("GET", CHARGE_POINT_DETAIL_PATH)).toHaveLength(1);
  });

  it("getChargePointDetailV3: still retries EvnexHttpError to the 5-attempt cap", async () => {
    const { client, stub } = buildClient({
      routes: [serverErrorRoute("GET", CHARGE_POINT_DETAIL_PATH)],
    });

    await withFakeTimers(() =>
      expect(client.getChargePointDetailV3(CP_ID)).rejects.toBeInstanceOf(EvnexHttpError),
    );
    expect(stub.callsFor("GET", CHARGE_POINT_DETAIL_PATH)).toHaveLength(5);
  });

  for (const [name, path, invoke] of [
    [
      "getChargePointSolarConfig",
      SOLAR_CONFIG_PATH,
      (c: Evnex) => c.getChargePointSolarConfig(CP_ID),
    ],
    [
      "getChargePointOverride",
      GET_OVERRIDE_PATH,
      (c: Evnex) => c.getChargePointOverride(CP_ID),
    ],
    ["getChargePointStatus", STATUS_PATH, (c: Evnex) => c.getChargePointStatus(CP_ID)],
    [
      "getChargePointEnergyMeterReading",
      ENERGY_METER_PATH,
      (c: Evnex) => c.getChargePointEnergyMeterReading(CP_ID),
    ],
  ] as const) {
    it(`${name}: does not retry EvnexTimeoutError (charge point offline)`, async () => {
      const { client, stub } = buildClient({ routes: [timeoutRoute("POST", path)] });

      await expect(invoke(client)).rejects.toBeInstanceOf(EvnexTimeoutError);
      expect(stub.callsFor("POST", path)).toHaveLength(1);
    });

    it(`${name}: still retries EvnexHttpError to the 5-attempt cap`, async () => {
      const { client, stub } = buildClient({ routes: [serverErrorRoute("POST", path)] });

      await withFakeTimers(() =>
        expect(invoke(client)).rejects.toBeInstanceOf(EvnexHttpError),
      );
      expect(stub.callsFor("POST", path)).toHaveLength(5);
    });
  }

  it("setChargePointOverride: does not retry EvnexTimeoutError (test_set_override_fails_fast_on_timeout)", async () => {
    const { client, stub } = buildClient({
      routes: [timeoutRoute("POST", CHARGE_POINT_OVERRIDE_PATH)],
    });

    await expect(
      client.setChargePointOverride({ chargePointId: CP_ID, chargeNow: true }),
    ).rejects.toBeInstanceOf(EvnexTimeoutError);
    expect(stub.callsFor("POST", CHARGE_POINT_OVERRIDE_PATH)).toHaveLength(1);
  });

  it("setChargePointOverride: does not retry EvnexHttpError", async () => {
    const { client, stub } = buildClient({
      routes: [serverErrorRoute("POST", CHARGE_POINT_OVERRIDE_PATH)],
    });

    await expect(
      client.setChargePointOverride({ chargePointId: CP_ID, chargeNow: true }),
    ).rejects.toBeInstanceOf(EvnexHttpError);
    expect(stub.callsFor("POST", CHARGE_POINT_OVERRIDE_PATH)).toHaveLength(1);
  });

  it("setChargePointOverride: still retries a generic network failure to the 5-attempt cap", async () => {
    const { client, stub } = buildClient({
      routes: [networkErrorRoute("POST", CHARGE_POINT_OVERRIDE_PATH)],
    });

    await withFakeTimers(() =>
      expect(
        client.setChargePointOverride({ chargePointId: CP_ID, chargeNow: true }),
      ).rejects.toBeInstanceOf(TypeError),
    );
    expect(stub.callsFor("POST", CHARGE_POINT_OVERRIDE_PATH)).toHaveLength(5);
  });

  it("stopChargePoint: does not retry EvnexTimeoutError (no active session -> 504)", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [timeoutRoute("POST", CHARGE_POINT_STOP_PATH)],
    });

    await expect(client.stopChargePoint({ chargePointId: CP_ID })).rejects.toBeInstanceOf(
      EvnexTimeoutError,
    );
    expect(stub.callsFor("POST", CHARGE_POINT_STOP_PATH)).toHaveLength(1);
  });

  it("stopChargePoint: does not retry EvnexHttpError", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [serverErrorRoute("POST", CHARGE_POINT_STOP_PATH)],
    });

    await expect(client.stopChargePoint({ chargePointId: CP_ID })).rejects.toBeInstanceOf(
      EvnexHttpError,
    );
    expect(stub.callsFor("POST", CHARGE_POINT_STOP_PATH)).toHaveLength(1);
  });

  it("stopChargePoint: still retries a generic network failure to the 5-attempt cap", async () => {
    const { client, stub } = buildClient({
      orgId: ORG_ID,
      routes: [networkErrorRoute("POST", CHARGE_POINT_STOP_PATH)],
    });

    await withFakeTimers(() =>
      expect(client.stopChargePoint({ chargePointId: CP_ID })).rejects.toBeInstanceOf(
        TypeError,
      ),
    );
    expect(stub.callsFor("POST", CHARGE_POINT_STOP_PATH)).toHaveLength(5);
  });
});

describe("retry policy — methods with no extra additions still use the standing policy", () => {
  it("getUserDetail retries a transient EvnexHttpError to the 5-attempt cap", async () => {
    const { client, stub } = buildClient({
      routes: [serverErrorRoute("GET", USER_PATH)],
    });

    await withFakeTimers(() =>
      expect(client.getUserDetail()).rejects.toBeInstanceOf(EvnexHttpError),
    );
    expect(stub.callsFor("GET", USER_PATH)).toHaveLength(5);
  });
});

describe("retry policy — no retry decorator in Python, none added here", () => {
  for (const [name, method, path, invoke] of [
    [
      "setChargerAvailability",
      "POST",
      AVAILABILITY_PATH,
      (c: Evnex) => c.setChargerAvailability({ orgId: ORG_ID, chargePointId: CP_ID }),
    ],
    [
      "unlockCharger",
      "POST",
      UNLOCK_PATH,
      (c: Evnex) => c.unlockCharger({ chargePointId: CP_ID }),
    ],
    [
      "setChargerLoadProfile",
      "PUT",
      LOAD_MANAGEMENT_PATH,
      (c: Evnex) =>
        c.setChargerLoadProfile({ chargePointId: CP_ID, chargingProfilePeriods: [] }),
    ],
    [
      "setChargePointSchedule",
      "PUT",
      CHARGE_SCHEDULE_PATH,
      (c: Evnex) =>
        c.setChargePointSchedule({ chargePointId: CP_ID, chargingProfilePeriods: [] }),
    ],
  ] as const) {
    it(`${name}: a transient EvnexHttpError is not retried at all`, async () => {
      const { client, stub } = buildClient({
        orgId: ORG_ID,
        routes: [serverErrorRoute(method, path)],
      });

      await expect(invoke(client)).rejects.toBeInstanceOf(EvnexHttpError);
      expect(stub.callsFor(method, path)).toHaveLength(1);
    });
  }
});
