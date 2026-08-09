/**
 * Dry-run fixtures — lets the whole sweep pipeline (graph walk, capture,
 * redaction, diffing, report generation) run end-to-end against recorded
 * data instead of the network, so it can be proven correct (and exercised in
 * tests) with no live account and no credentials.
 *
 * Reuses real fixtures from `test/support/fixtures.ts` — themselves ported
 * verbatim from `python-evnex`'s own test suite (PLAN.md §5 A9) — for every
 * endpoint one exists for. The remaining endpoints have **no captured
 * fixture anywhere in either project** (this is precisely why the live
 * sweep exists — see PARITY.md's `EvnexChargePointDetail` (v2) row); for
 * those, this module synthesises a schema-valid payload by hand from the
 * Zod/pydantic model definitions. `FIXTURE_PROVENANCE` records which is
 * which, and `report.ts` prints it per endpoint: a synthetic fixture proves
 * the *tool* works, never that the real API's schema is right.
 */

import {
  BASE_URL,
  CHARGE_POINTS_PAYLOAD,
  CONNECTOR_SUMMARY_PAYLOAD,
  DETAIL_V3_PAYLOAD,
  INSIGHTS_PAYLOAD,
  LOCATIONS_PAYLOAD,
  SESSIONS_PAYLOAD,
  USER_PAYLOAD,
} from "../../../test/support/fixtures.js";
import { createStubFetch } from "../../../test/support/stubFetch.js";
import type { StubRoute } from "../../../test/support/stubFetch.js";
import type { AuthTokenSource } from "../../../src/http/authFlow.js";
import { Transport } from "../../../src/http/transport.js";

// -- Synthetic payloads -------------------------------------------------------
//
// Hand-built to be schema-valid against this package's own Zod schemas
// (cross-checked against evnex/schema/**.py's field lists at the time these
// were written — see endpoints.ts's pythonNotes for the citations). None of
// these were ever observed on a real charger.

/** GET /v2/apps/charge-points/{id} — no captured fixture exists anywhere; see PARITY.md. */
const SYNTHETIC_CHARGE_POINT_DETAIL_V2 = {
  data: {
    id: "cp-0000001",
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
      address: {
        address1: "1 Test Street",
        city: "Wellington",
        postCode: "6011",
        country: "NZ",
      },
      coordinates: { latitude: -41.2865, longitude: 174.7762 },
      chargePointCount: 1,
    },
    configuration: { maxCurrent: 32, plugAndCharge: false },
    electricityCost: { currency: "NZD", costs: [{ cost: 0.28, start: 0 }] },
    // No "timezone" — matches the live-confirmed §10.1 shape (src/schema/chargePoints.ts's comment).
    loadSchedule: {
      duration: 86_400,
      enabled: true,
      units: "A",
      chargingProfilePeriods: [{ limit: 32, start: 0 }],
    },
    connectors: [
      {
        powerType: "AC_1_PHASE",
        connectorId: "1",
        evseId: "1",
        updatedDate: "2024-06-01T00:00:00Z",
        connectorType: "TYPE_2_SOCKET",
        amperage: 32,
        voltage: 230,
        connectorFormat: "CABLE",
        ocppStatus: "AVAILABLE",
        status: "AVAILABLE",
        ocppCode: "NoError",
        meter: null,
      },
    ],
  },
};

/** POST /charge-points/{id}/commands/get-status */
const SYNTHETIC_CHARGE_POINT_STATUS = {
  data: {
    commandResultStatus: "Accepted",
    chargePointStatus: {
      chargeNow: false,
      chargingLogic: "Vehicle",
      chargingCurrentControl: "FullPower",
      LEDState: "Charging",
      AntiSleep: "Disabled",
    },
  },
};

/** POST /charge-points/{id}/commands/get-energy-meter-reading */
const SYNTHETIC_ENERGY_METER_READING = {
  data: {
    timestamp: "2024-06-01T12:00:00Z",
    chargingActivePower: 3600,
    supplyActivePower: 3800,
  },
  status: "Accepted",
};

/** POST /charge-points/{id}/commands/get-override */
const SYNTHETIC_OVERRIDE_CONFIG = { chargeNow: true };

/** POST /charge-points/{id}/commands/get-solar */
const SYNTHETIC_SOLAR_CONFIG = {
  solarWithSchedule: false,
  powerSensorInstalled: true,
  solarStartExportPower: 200,
  solarStopImportPower: 100,
};

/** GET /v2/apps/charge-points/{id}/transactions — deprecated, no captured fixture anywhere. */
const SYNTHETIC_TRANSACTIONS_V2 = {
  data: {
    items: [
      {
        id: "txn-0000001",
        connectorId: "1",
        endDate: "2024-06-01T09:00:00Z",
        evseId: "1",
        powerUsage: 7000,
        reason: "EVDisconnected",
        startDate: "2024-06-01T08:00:00Z",
        carbonOffset: 1.1,
        electricityCost: { currency: "NZD", cost: 1.96 },
      },
    ],
  },
};

/** GET /v2/apps/organisations/{id}/summary/status — v2 flat envelope, no captured fixture anywhere (only the v3 orgConnectorSummary shape has one). */
const SYNTHETIC_ORG_SUMMARY_STATUS_V2 = {
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

// -- Route table --------------------------------------------------------------

const ORG_ID = "org-0000";
const CHARGE_POINT_ID = "cp-0000001";

interface FixtureRoute extends StubRoute {
  /** Which endpoint id (endpoints.ts) this route backs, for provenance lookup. */
  endpointId: string;
  /** True when `json` is a real payload inherited from test/support/fixtures.ts. */
  upstream: boolean;
}

const ROUTES: readonly FixtureRoute[] = [
  {
    endpointId: "userDetail",
    upstream: true,
    method: "GET",
    path: "/v2/apps/user",
    json: USER_PAYLOAD,
  },
  {
    endpointId: "orgChargePoints",
    upstream: true,
    method: "GET",
    path: `/v2/apps/organisations/${ORG_ID}/charge-points`,
    json: CHARGE_POINTS_PAYLOAD,
  },
  {
    endpointId: "chargePointDetailV2",
    upstream: false,
    method: "GET",
    path: `/v2/apps/charge-points/${CHARGE_POINT_ID}`,
    json: SYNTHETIC_CHARGE_POINT_DETAIL_V2,
  },
  {
    endpointId: "chargePointDetailV3",
    upstream: true,
    method: "GET",
    path: `/charge-points/${CHARGE_POINT_ID}`,
    json: DETAIL_V3_PAYLOAD,
  },
  {
    endpointId: "chargePointStatus",
    upstream: false,
    method: "POST",
    path: `/charge-points/${CHARGE_POINT_ID}/commands/get-status`,
    json: SYNTHETIC_CHARGE_POINT_STATUS,
  },
  {
    endpointId: "chargePointEnergyMeterReading",
    upstream: false,
    method: "POST",
    path: `/charge-points/${CHARGE_POINT_ID}/commands/get-energy-meter-reading`,
    json: SYNTHETIC_ENERGY_METER_READING,
  },
  {
    endpointId: "chargePointOverride",
    upstream: false,
    method: "POST",
    path: `/charge-points/${CHARGE_POINT_ID}/commands/get-override`,
    json: SYNTHETIC_OVERRIDE_CONFIG,
  },
  {
    endpointId: "chargePointSolarConfig",
    upstream: false,
    method: "POST",
    path: `/charge-points/${CHARGE_POINT_ID}/commands/get-solar`,
    json: SYNTHETIC_SOLAR_CONFIG,
  },
  {
    endpointId: "chargePointTransactionsV2",
    upstream: false,
    method: "GET",
    path: `/v2/apps/charge-points/${CHARGE_POINT_ID}/transactions`,
    json: SYNTHETIC_TRANSACTIONS_V2,
  },
  {
    endpointId: "chargePointSessions",
    upstream: true,
    method: "GET",
    path: `/charge-points/${CHARGE_POINT_ID}/sessions`,
    json: SESSIONS_PAYLOAD,
  },
  {
    endpointId: "orgLocations",
    upstream: true,
    method: "GET",
    path: `/v2/apps/organisations/${ORG_ID}/locations`,
    json: LOCATIONS_PAYLOAD,
  },
  {
    endpointId: "orgInsight",
    upstream: true,
    method: "GET",
    path: `/organisations/${ORG_ID}/summary/insights`,
    json: INSIGHTS_PAYLOAD,
  },
  {
    endpointId: "orgSummaryStatusV2",
    upstream: false,
    method: "GET",
    path: `/v2/apps/organisations/${ORG_ID}/summary/status`,
    json: SYNTHETIC_ORG_SUMMARY_STATUS_V2,
  },
  {
    endpointId: "orgConnectorSummaryV3",
    upstream: true,
    method: "GET",
    path: `/organisations/${ORG_ID}/summary/status`,
    json: CONNECTOR_SUMMARY_PAYLOAD,
  },
];

/** endpoint id -> whether its dry-run fixture is a real upstream payload (vs. synthetic). */
export const FIXTURE_PROVENANCE: ReadonlyMap<string, boolean> = new Map(
  ROUTES.map((route) => [route.endpointId, route.upstream]),
);

/** A fixed, non-expiring fake — the dry run never talks to Cognito. */
function makeFakeAuth(): AuthTokenSource {
  return {
    getAccessToken: () => Promise.resolve("dry-run-fixture-token"),
    forceRefresh: () => Promise.resolve(undefined),
  };
}

export interface DryRunHarness {
  transport: Transport;
  auth: AuthTokenSource;
}

/** Builds the (transport, auth) pair the dry-run pipeline sends its requests through. */
export function buildDryRunHarness(): DryRunHarness {
  const stub = createStubFetch(ROUTES);
  const transport = new Transport({
    baseUrl: BASE_URL,
    fetch: stub.fetch,
    version: "dry-run",
  });
  return { transport, auth: makeFakeAuth() };
}
