/**
 * JSON response fixtures — ported verbatim from the payloads embedded in
 * `python-evnex`'s `tests/test_auth.py`, `tests/test_cli_resources.py`, and
 * `tests/test_schema.py` (PLAN.md §5 A9).
 *
 * Kept byte-for-byte identical to the Python literals (same ids, same dates,
 * same field presence/absence) so this TypeScript suite and the upstream
 * Python suite assert against the same wire shapes. Do not "clean up" a
 * payload to look more idiomatic — a difference here is a difference in what
 * gets tested.
 *
 * The `*_PATH` constants are pathnames only (no host), for `stubFetch.ts`
 * route registration. The `*_URL` constants match the Python test suite's own
 * names and are the full URL against the default `EvnexConfig.EVNEX_BASE_URL`.
 */

// -- Base URL / paths -------------------------------------------------------

/** `EvnexConfig`'s default `EVNEX_BASE_URL`. */
export const BASE_URL = "https://client-api.evnex.io";

export const USER_PATH = "/v2/apps/user";
export const CHARGE_POINTS_PATH = "/v2/apps/organisations/org-0000/charge-points";
export const CHARGE_POINT_DETAIL_PATH = "/charge-points/cp-0000001";
export const CHARGE_POINT_SESSIONS_PATH = "/charge-points/cp-0000001/sessions";
export const ORG_INSIGHTS_PATH = "/organisations/org-0000/summary/insights";
export const ORG_LOCATIONS_PATH = "/v2/apps/organisations/org-0000/locations";
export const ORG_CONNECTOR_SUMMARY_PATH = "/organisations/org-0000/summary/status";
export const CHARGE_POINT_OVERRIDE_PATH = "/charge-points/cp-0000001/commands/set-override";
export const CHARGE_POINT_STOP_PATH =
  "/v2/apps/organisations/org-0000/charge-points/cp-0000001/commands/remote-stop-transaction";

export const USER_URL = `${BASE_URL}${USER_PATH}`;
export const CP_URL = `${BASE_URL}${CHARGE_POINTS_PATH}`;
export const DETAIL_URL = `${BASE_URL}${CHARGE_POINT_DETAIL_PATH}`;
export const SESSIONS_URL = `${BASE_URL}${CHARGE_POINT_SESSIONS_PATH}`;
export const INSIGHTS_URL = `${BASE_URL}${ORG_INSIGHTS_PATH}`;
export const LOCATIONS_URL = `${BASE_URL}${ORG_LOCATIONS_PATH}`;
export const CONNECTOR_SUMMARY_URL = `${BASE_URL}${ORG_CONNECTOR_SUMMARY_PATH}`;
export const OVERRIDE_URL = `${BASE_URL}${CHARGE_POINT_OVERRIDE_PATH}`;
export const STOP_URL = `${BASE_URL}${CHARGE_POINT_STOP_PATH}`;

// -- User (tests/test_cli_resources.py::USER_PAYLOAD) -----------------------

export const USER_PAYLOAD = {
  data: {
    id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    createdDate: "2024-01-01T00:00:00Z",
    updatedDate: "2024-01-01T00:00:00Z",
    name: "Test User",
    email: "user@example.com",
    organisations: [
      {
        id: "org-0000",
        isDefault: true,
        role: 1,
        createdDate: "2024-01-01T00:00:00Z",
        name: "Test Org",
        slug: "test-org",
        tier: 1,
        updatedDate: "2024-01-01T00:00:00Z",
      },
    ],
    type: "User",
  },
};

// tests/test_auth.py::USER_PAYLOAD — smaller, no organisations, used to test
// the bare-token Authorization header and 401 recovery in isolation.
export const USER_PAYLOAD_NO_ORGS = {
  data: {
    id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    createdDate: "2022-01-01T00:00:00Z",
    updatedDate: "2022-01-01T00:00:00Z",
    name: "Test User",
    email: "user@example.com",
    organisations: [] as const,
  },
};

// tests/test_schema.py::test_user_without_name_validates — the API omits
// `name` entirely for accounts that never set one.
export const USER_PAYLOAD_NO_NAME = {
  data: {
    id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    createdDate: "2022-01-01T00:00:00Z",
    updatedDate: "2022-01-01T00:00:00Z",
    email: "user@example.com",
    organisations: [] as const,
    type: "User",
  },
};

// -- Charge points, v2 flat envelope (tests/test_cli_resources.py) ----------

/** Mirrors `tests/test_cli_resources.py::_charge_point_item`. */
export function chargePointItem(cpId: string, name: string, serial: string) {
  return {
    id: cpId,
    createdDate: "2024-01-01T00:00:00Z",
    updatedDate: "2024-06-01T00:00:00Z",
    networkStatusUpdatedDate: "2024-06-01T00:00:00Z",
    name,
    ocppChargePointId: serial,
    serial,
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
      coordinates: { latitude: "-41.2865", longitude: "174.7762" },
      chargePointCount: 1,
    },
    details: { model: "E2", vendor: "Evnex", firmware: "1.2.3" },
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
        meter: {
          powerType: "AC_1_PHASE",
          updatedDate: "2024-06-01T00:00:00Z",
          power: 0,
          register: 12345.6,
          frequency: 50,
        },
      },
    ],
    lastHeard: "2024-06-01T00:00:00Z",
    maxCurrent: 32,
    tokenRequired: false,
    needsRegistrationInformation: false,
  };
}

export const CHARGE_POINTS_PAYLOAD = {
  data: { items: [chargePointItem("cp-0000001", "Garage Charger", "SN0000001")] },
};

export const TWO_CHARGE_POINTS_PAYLOAD = {
  data: {
    items: [
      chargePointItem("cp-0000001", "Garage Charger", "SN0000001"),
      chargePointItem("cp-0000002", "Driveway Charger", "SN0000002"),
    ],
  },
};

// -- Charge point detail, v3 JSON:API envelope -------------------------------

export const DETAIL_V3_PAYLOAD = {
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
          meter: {
            currentL1: 16,
            frequency: 50,
            power: 3600,
            register: 12345.6,
            supplyActivePower: 400,
            updatedDate: "2024-06-01T00:00:00Z",
            voltageL1N: 230,
          },
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
      profiles: {
        chargeSchedule: {
          enabled: true,
          chargingSchedulePeriods: [
            { limit: 32, startPeriod: 0 },
            { limit: 0, startPeriod: 79200 },
          ],
        },
      },
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

// -- Sessions, v3 JSON:API envelope ------------------------------------------

export const SESSIONS_PAYLOAD = {
  data: [
    {
      id: "session-0000001",
      type: "session",
      attributes: {
        connectorId: "1",
        createdDate: "2024-06-02T08:00:00Z",
        evseId: "1",
        sessionStatus: "InProgress",
        startDate: "2024-06-02T08:00:00Z",
        updatedDate: "2024-06-02T08:30:00Z",
        endDate: null,
        totalPowerUsage: 3500,
        totalCost: null,
      },
    },
    {
      id: "session-0000002",
      type: "session",
      attributes: {
        connectorId: "1",
        createdDate: "2024-06-01T08:00:00Z",
        evseId: "1",
        sessionStatus: "Completed",
        startDate: "2024-06-01T08:00:00Z",
        updatedDate: "2024-06-01T09:00:00Z",
        endDate: "2024-06-01T09:00:00Z",
        totalPowerUsage: 7000,
        totalCost: { currency: "NZD", amount: 1.96, distribution: null },
      },
    },
  ],
};

// -- Org insights -------------------------------------------------------------

export const INSIGHTS_PAYLOAD = {
  data: [
    {
      attributes: {
        carbonOffset: 1.1,
        carbonUsage: 0.9,
        cost: { currency: "NZD", cost: 1.5 },
        duration: 3600,
        powerUsage: 1000,
        sessions: 1,
        startDate: "2024-06-10T00:00:00Z",
      },
    },
    {
      attributes: {
        carbonOffset: 1.1,
        carbonUsage: 0.9,
        cost: { currency: "NZD", cost: 2.5 },
        duration: 7200,
        powerUsage: 2000,
        sessions: 2,
        startDate: "2024-06-11T00:00:00Z",
      },
    },
  ],
};

// -- Locations, v3 JSON:API envelope -----------------------------------------

export const LOCATIONS_PAYLOAD = {
  data: [
    {
      id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      type: "locations",
      attributes: {
        name: "Home",
        address: {
          address1: "1 Test Street",
          address2: "",
          city: "Wellington",
          postCode: "6011",
          state: "",
          country: "NZ",
        },
        coordinates: { latitude: "-41.2865", longitude: "174.7762" },
        isPublic: false,
        updated: "2024-06-01T00:00:00Z",
        created: "2024-01-01T00:00:00Z",
        icpNumber: "0000123456UN789",
        icpDetails: {
          electricityRetailer: "Example Energy",
          electricityDistributor: "Example Networks",
          networkConnectionPoint: "EXP0001",
        },
        timeZone: "Pacific/Auckland",
      },
      relationships: {
        chargePoints: { data: [{ type: "chargePoint", id: "cp-0000001" }] },
        // Fields the client's zod schema does not model (organisation, users) —
        // kept to prove the response validates with them present, exactly like
        // the Python fixture's comment on `included` below.
        organisation: { data: null },
        users: { data: [] as const },
      },
    },
  ],
  // Full charge point objects the client does not model; kept to prove the
  // response validates with them present.
  included: [
    {
      id: "cp-0000001",
      type: "chargePoint",
      attributes: { name: "Garage Charger" },
    },
  ],
};

/** A location on an account that has not filled in address or ICP details. */
export const LOCATION_MINIMAL = {
  id: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
  type: "locations",
  attributes: { name: "Depot" },
};

// -- Org connector summary, v3 JSON:API envelope -----------------------------

export const CONNECTOR_SUMMARY_PAYLOAD = {
  data: {
    attributes: {
      connectors: {
        available: 3,
        charging: 1,
        disabled: 0,
        faulted: 0,
        occupied: 1,
        offline: 2,
        reserved: 0,
      },
    },
  },
};

// -- Connector meter, standalone (tests/test_schema.py) ----------------------

// Captured from a live v3 charge point detail response for a charger with the
// PowerSensor feature (CT clamp) installed.
export const CONNECTOR_METER_WITH_POWER_SENSOR_PAYLOAD = {
  currentL1: 24.2,
  frequency: 50,
  power: 5380,
  register: 7502488,
  supplyActivePower: 7730,
  updatedDate: "2026-07-16T10:25:00.000Z",
  voltageL1N: 222.3,
};

export const CONNECTOR_METER_WITHOUT_POWER_SENSOR_PAYLOAD = {
  frequency: 50,
  power: 5380,
  register: 7502488,
  updatedDate: "2026-07-16T10:25:00.000Z",
};
