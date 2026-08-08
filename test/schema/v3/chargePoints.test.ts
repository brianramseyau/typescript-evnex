import { describe, expect, it } from "vitest";
import {
  EvnexChargePointConnectionConfiguration,
  EvnexChargePointConnector,
  EvnexChargePointConnectorMeter,
  EvnexChargePointDetail,
  EvnexChargePointFeature,
  EvnexChargePointFeatures,
  EvnexChargePointSession,
  EvnexChargeProfile,
  EvnexChargeSchedule,
  EvnexChargeSchedulePeriod,
  EvnexEnergyTransaction,
  EvnexEnergyUsage,
  EvnexGetChargePointSessionsResponse,
  OBSERVED_SESSION_STATUSES,
  sessionEnergyWh,
  type EvnexChargePointSessionAttributes,
} from "../../../src/schema/v3/chargePoints.js";

describe("EvnexEnergyTransaction", () => {
  it("parses a completed transaction", () => {
    const payload = {
      meterStart: 1000,
      startDate: "2026-01-01T00:00:00Z",
      meterStop: 2000,
      endDate: "2026-01-01T01:00:00Z",
      reason: "Local",
    };
    const parsed = EvnexEnergyTransaction.parse(payload);
    expect(parsed.meterStart).toBe(1000);
    expect(parsed.meterStop).toBe(2000);
  });

  it("tolerates an in-progress transaction with only the required fields", () => {
    const parsed = EvnexEnergyTransaction.parse({
      meterStart: 0,
      startDate: "2026-01-01T00:00:00Z",
    });
    expect(parsed.meterStart).toBe(0);
    expect(parsed.meterStop).toBeUndefined();
  });
});

describe("EvnexEnergyUsage", () => {
  it("parses total and tolerates unknown distribution shapes", () => {
    const parsed = EvnexEnergyUsage.parse({
      total: 12.3,
      distributionByTariff: { peak: 12.3 },
      distributionByEnergySource: null,
    });
    expect(parsed.total).toBe(12.3);
    expect(parsed.distributionByTariff).toEqual({ peak: 12.3 });
    expect(parsed.distributionByEnergySource).toBeNull();
  });
});

describe("charge schedule / profile schemas", () => {
  it("parses a charging schedule period and schedule", () => {
    const period = EvnexChargeSchedulePeriod.parse({ limit: 32, startPeriod: 0 });
    expect(period).toEqual({ limit: 32, startPeriod: 0 });

    const schedule = EvnexChargeSchedule.parse({
      enabled: true,
      chargingSchedulePeriods: [{ limit: 32, startPeriod: 0 }],
    });
    expect(schedule.chargingSchedulePeriods).toHaveLength(1);
  });

  it("parses a profile with and without a charge schedule", () => {
    expect(EvnexChargeProfile.parse({})).toEqual({});
    expect(
      EvnexChargeProfile.parse({
        chargeSchedule: { enabled: false, chargingSchedulePeriods: [] },
      }).chargeSchedule,
    ).toEqual({ enabled: false, chargingSchedulePeriods: [] });
  });
});

describe("EvnexChargePointFeature(s)", () => {
  it("parses the three named features", () => {
    const parsed = EvnexChargePointFeatures.parse({
      PowerSensor: { unlocked: true },
      Solar: { unlocked: false },
      VehicleIntegration: { unlocked: false },
    });
    expect(parsed.PowerSensor).toEqual({ unlocked: true });
    expect(EvnexChargePointFeature.parse({ unlocked: true })).toEqual({ unlocked: true });
  });
});

// Mirrors upstream tests/test_schema.py::test_connector_meter_exposes_supply_active_power
// and ::test_connector_meter_without_power_sensor.
describe("EvnexChargePointConnectorMeter", () => {
  it("exposes supplyActivePower when a power sensor (CT clamp) is installed", () => {
    // Captured shape from a live v3 charge point detail response for a
    // charger with the PowerSensor feature installed.
    const payload = {
      currentL1: 24.2,
      frequency: 50,
      power: 5380,
      register: 7502488,
      supplyActivePower: 7730,
      updatedDate: "2026-07-16T10:25:00.000Z",
      voltageL1N: 222.3,
    };
    const meter = EvnexChargePointConnectorMeter.parse(payload);
    expect(meter.supplyActivePower).toBe(7730);
  });

  it("leaves supplyActivePower absent (not zero) when there is no power sensor", () => {
    const payload = {
      frequency: 50,
      power: 5380,
      register: 7502488,
      updatedDate: "2026-07-16T10:25:00.000Z",
    };
    const meter = EvnexChargePointConnectorMeter.parse(payload);
    expect(meter.supplyActivePower).toBeUndefined();
    expect("supplyActivePower" in meter).toBe(false);
  });

  it("aliases the wire field `register` to `rawRegister`", () => {
    const meter = EvnexChargePointConnectorMeter.parse({
      frequency: 50,
      power: 5380,
      register: 7502488,
      updatedDate: "2026-07-16T10:25:00.000Z",
    });
    expect(meter.rawRegister).toBe(7502488);
    expect("register" in meter).toBe(false);
  });
});

describe("EvnexChargePointConnector", () => {
  it("parses a connector with a meter", () => {
    const parsed = EvnexChargePointConnector.parse({
      evseId: "evse-1",
      connectorFormat: "CABLE",
      connectorType: "Type2",
      ocppStatus: "Available",
      powerType: "AC_1_PHASE",
      connectorId: "1",
      ocppCode: "CHARGING",
      updatedDate: "2026-01-01T00:00:00Z",
      meter: {
        frequency: 50,
        power: 0,
        register: 100,
        updatedDate: "2026-01-01T00:00:00Z",
      },
      maxVoltage: 240,
      maxAmperage: 32,
    });
    expect(parsed.meter?.rawRegister).toBe(100);
  });

  it("parses a connector without a meter", () => {
    const parsed = EvnexChargePointConnector.parse({
      evseId: "evse-1",
      connectorFormat: "CABLE",
      connectorType: "Type2",
      ocppStatus: "Available",
      powerType: "AC_1_PHASE",
      connectorId: "1",
      ocppCode: "CHARGING",
      updatedDate: "2026-01-01T00:00:00Z",
      maxVoltage: 240,
      maxAmperage: 32,
    });
    expect(parsed.meter).toBeUndefined();
  });
});

describe("EvnexChargePointConnectionConfiguration", () => {
  it("parses", () => {
    const parsed = EvnexChargePointConnectionConfiguration.parse({
      automaticallyManaged: true,
      preferredConnectionType: "Cell",
      updatedDate: "2026-01-01T00:00:00Z",
      wifiConnected: false,
    });
    expect(parsed.preferredConnectionType).toBe("Cell");
  });
});

describe("EvnexChargePointDetail", () => {
  it("parses the required fields and carries the authoritative timeZone", () => {
    const parsed = EvnexChargePointDetail.parse({
      connectors: [],
      createdDate: "2026-01-01T00:00:00Z",
      electricityCost: { currency: "NZD", tariffs: [], tariffType: "Flat" },
      firmware: "1.0.0",
      maxCurrent: 32,
      model: "Test Charger",
      name: "Test Charger",
      networkStatus: "ONLINE",
      networkStatusUpdatedDate: "2026-01-01T00:00:00Z",
      ocppChargePointId: "ocpp-1",
      profiles: {},
      serial: "SN123",
      timeZone: "Australia/Melbourne",
      tokenRequired: false,
      updatedDate: "2026-01-01T00:00:00Z",
      vendor: "Test Vendor",
    });
    expect(parsed.timeZone).toBe("Australia/Melbourne");
    expect(parsed.features).toBeUndefined();
    expect(parsed.iccid).toBeUndefined();
  });

  it("parses the optional fields when present", () => {
    const parsed = EvnexChargePointDetail.parse({
      connectors: [],
      createdDate: "2026-01-01T00:00:00Z",
      electricityCost: { currency: "NZD", tariffs: [], tariffType: "Flat" },
      firmware: "1.0.0",
      maxCurrent: 32,
      model: "Test Charger",
      name: "Test Charger",
      networkStatus: "ONLINE",
      networkStatusUpdatedDate: "2026-01-01T00:00:00Z",
      ocppChargePointId: "ocpp-1",
      profiles: {},
      serial: "SN123",
      timeZone: "Pacific/Auckland",
      tokenRequired: false,
      updatedDate: "2026-01-01T00:00:00Z",
      vendor: "Test Vendor",
      connectionConfiguration: {
        automaticallyManaged: true,
        preferredConnectionType: "Cell",
        updatedDate: "2026-01-01T00:00:00Z",
        wifiConnected: true,
      },
      features: {
        PowerSensor: { unlocked: true },
        Solar: { unlocked: false },
        VehicleIntegration: { unlocked: false },
      },
      iccid: "89310000000000000000",
      isSolarEnabled: true,
    });
    expect(parsed.features?.PowerSensor.unlocked).toBe(true);
    expect(parsed.iccid).toBe("89310000000000000000");
    expect(parsed.isSolarEnabled).toBe(true);
  });
});

describe("OBSERVED_SESSION_STATUSES", () => {
  it("lists the six statuses observed live, and stays a tolerant string at parse time", () => {
    expect(OBSERVED_SESSION_STATUSES).toEqual([
      "Pending",
      "Authorized",
      "Active",
      "Closed",
      "Completed",
      "Invalid",
    ]);
    // An unobserved value must not throw — sessionStatus is a tolerant string.
    const attrs: EvnexChargePointSessionAttributes =
      EvnexChargePointSession.parse({
        id: "s-1",
        type: "session",
        attributes: { sessionStatus: "SomeFutureStatus" },
      }).attributes;
    expect(attrs.sessionStatus).toBe("SomeFutureStatus");
  });
});

describe("EvnexChargePointSession / EvnexGetChargePointSessionsResponse", () => {
  it("parses a session with relationships and a full attribute set", () => {
    const payload = {
      id: "session-1",
      type: "session",
      attributes: {
        totalCarbonUsage: 1.2,
        chargingStarted: "2026-01-01T00:00:00Z",
        chargingStopped: "2026-01-01T01:00:00Z",
        connectorId: "1",
        createdDate: "2026-01-01T00:00:00Z",
        evseId: "evse-1",
        sessionStatus: "Completed",
        startDate: "2026-01-01T00:00:00Z",
        updatedDate: "2026-01-01T01:00:00Z",
        authorizationMethod: "RFID",
        electricityCost: { currency: "NZD", tariffs: [], tariffType: "Flat" },
        endDate: "2026-01-01T01:00:00Z",
        totalChargingTime: 3600,
        totalDuration: 3600,
        totalEnergyUsage: { total: 5000 },
        totalCost: { currency: "NZD", amount: 1.6 },
        totalPowerUsage: 5000,
        transaction: { meterStart: 1000, startDate: "2026-01-01T00:00:00Z", meterStop: 6000 },
      },
      relationships: { chargePoint: { data: { id: "cp-1", type: "chargePoint" } } },
    };
    const parsed = EvnexChargePointSession.parse(payload);
    expect(parsed.relationships?.chargePoint?.data?.id).toBe("cp-1");
  });

  it("tolerates a session with only the required attributes object (all fields nullish)", () => {
    const parsed = EvnexChargePointSession.parse({
      id: "session-2",
      type: "session",
      attributes: {},
    });
    expect(parsed.relationships).toBeUndefined();
    expect(parsed.attributes.startDate).toBeUndefined();
    expect(parsed.attributes.sessionStatus).toBeUndefined();
  });

  it("parses a sessions-list response envelope", () => {
    const parsed = EvnexGetChargePointSessionsResponse.parse({
      data: [{ id: "session-1", type: "session", attributes: {} }],
    });
    expect(parsed.data).toHaveLength(1);
  });
});

// Mirrors PLAN.md §10.3 acceptance: meterStop absent -> null; meterStart: 0
// is a real reading and must not be treated as absent; no transaction -> null.
describe("sessionEnergyWh", () => {
  function sessionWith(
    attributes: Partial<EvnexChargePointSessionAttributes>,
  ): EvnexChargePointSession {
    return EvnexChargePointSession.parse({
      id: "session-1",
      type: "session",
      attributes,
    });
  }

  it("returns null when the session carries no transaction at all (key omitted)", () => {
    expect(sessionEnergyWh(sessionWith({}))).toBeNull();
  });

  it("returns null when transaction is explicitly null", () => {
    const session = sessionWith({});
    session.attributes.transaction = null;
    expect(sessionEnergyWh(session)).toBeNull();
  });

  it("returns null when meterStop is absent — session still charging", () => {
    const session = sessionWith({
      transaction: { meterStart: 500, startDate: new Date("2026-01-01T00:00:00Z") },
    });
    expect(sessionEnergyWh(session)).toBeNull();
  });

  it("returns null when meterStop is explicitly null", () => {
    const session = sessionWith({
      transaction: {
        meterStart: 500,
        startDate: new Date("2026-01-01T00:00:00Z"),
        meterStop: null,
      },
    });
    expect(sessionEnergyWh(session)).toBeNull();
  });

  it("treats meterStart: 0 as a real reading, not an absent one (the falsy trap)", () => {
    const session = sessionWith({
      transaction: {
        meterStart: 0,
        startDate: new Date("2026-01-01T00:00:00Z"),
        meterStop: 1500,
      },
    });
    expect(sessionEnergyWh(session)).toBe(1500);
  });

  it("returns the watt-hour delta for a completed session", () => {
    const session = sessionWith({
      transaction: {
        meterStart: 1000,
        startDate: new Date("2026-01-01T00:00:00Z"),
        meterStop: 6500,
      },
    });
    expect(sessionEnergyWh(session)).toBe(5500);
  });

  it("can legitimately be zero when the meter did not advance", () => {
    const session = sessionWith({
      transaction: {
        meterStart: 4200,
        startDate: new Date("2026-01-01T00:00:00Z"),
        meterStop: 4200,
      },
    });
    expect(sessionEnergyWh(session)).toBe(0);
  });
});
