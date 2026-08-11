/**
 * v2 charge-point schema tests — ported/regression tests from
 * `evnex/schema/charge_points.py` and PLAN.md §5 A3 / §10.1.
 */

import { describe, expect, it } from "vitest";
import {
  AntiSleepState,
  AntiSleepStateValues,
  ChargingCurrentControl,
  ChargingCurrentControlValues,
  ChargingLogic,
  ChargingLogicValues,
  ChargePointStatus,
  Coordinates,
  E2LEDState,
  E2LEDStateValues,
  EvnexChargePointConnectorMeter,
  EvnexChargePointLoadSchedule,
  EvnexChargePointSolarConfig,
  EvnexGetChargePointsResponse,
} from "../../src/schema/chargePoints.js";
import { CHARGE_POINTS_PAYLOAD } from "../support/fixtures.js";

describe("StrEnum ports", () => {
  it("ChargingLogic is a z.enum and exposes a values object", () => {
    expect(ChargingLogic.parse("Vehicle")).toBe("Vehicle");
    expect(() => ChargingLogic.parse("NotARealValue")).toThrow();
    expect(ChargingLogicValues.VEHICLE).toBe("Vehicle");
    expect(ChargingLogicValues.UNAVAILABLE).toBe("Unavailable");
    expect(ChargingLogicValues.NOVEHICLE).toBe("NoVehicle");
    expect(ChargingLogicValues.TRANSFER).toBe("Transfer");
    expect(ChargingLogicValues.FAULT).toBe("Fault");
  });

  it("ChargingCurrentControl is a z.enum and exposes a values object", () => {
    expect(ChargingCurrentControl.parse("SolarControl")).toBe("SolarControl");
    expect(() => ChargingCurrentControl.parse("bogus")).toThrow();
    expect(ChargingCurrentControlValues.FULLPOWER).toBe("FullPower");
    expect(ChargingCurrentControlValues.THERMALLIMITED).toBe("ThermalLimited");
    expect(ChargingCurrentControlValues.LLMLIMITED).toBe("LLMLimited");
    expect(ChargingCurrentControlValues.WAITINGSCHEDULE).toBe("WaitingSchedule");
    expect(ChargingCurrentControlValues.WAITINGSOLAR).toBe("WaitingSolar");
    expect(ChargingCurrentControlValues.SOLARCONTROL).toBe("SolarControl");
    expect(ChargingCurrentControlValues.SCHEDULELIMITED).toBe("ScheduleLimited");
    expect(ChargingCurrentControlValues.SUPPLYLIMITED).toBe("SupplyLimited");
  });

  it("E2LEDState is a z.enum and exposes a values object", () => {
    expect(E2LEDState.parse("ChargeNowCharging")).toBe("ChargeNowCharging");
    expect(() => E2LEDState.parse("bogus")).toThrow();
    expect(E2LEDStateValues.OFF).toBe("Off");
    expect(E2LEDStateValues.IDLE).toBe("Idle");
    expect(E2LEDStateValues.CHARGING).toBe("Charging");
    expect(E2LEDStateValues.CHARGENOWCHARGING).toBe("ChargeNowCharging");
    expect(E2LEDStateValues.CHARGENOWNOTCHARGING).toBe("ChargeNowNotCharging");
    expect(E2LEDStateValues.FAULT).toBe("Fault");
    expect(E2LEDStateValues.DISABLED).toBe("Disabled");
    expect(E2LEDStateValues.WAITSCHEDULE).toBe("WaitSchedule");
    expect(E2LEDStateValues.WAITSOLAR).toBe("WaitSolar");
    expect(E2LEDStateValues.WAITVEHICLE).toBe("WaitVehicle");
    expect(E2LEDStateValues.SHUTTINGDOWN).toBe("ShuttingDown");
  });

  it("AntiSleepState is a z.enum and exposes a values object", () => {
    expect(AntiSleepState.parse("Active")).toBe("Active");
    expect(() => AntiSleepState.parse("bogus")).toThrow();
    expect(AntiSleepStateValues.DISABLED).toBe("Disabled");
    expect(AntiSleepStateValues.ENABLED).toBe("Enabled");
    expect(AntiSleepStateValues.ACTIVE).toBe("Active");
    expect(AntiSleepStateValues.NA).toBe("NA");
  });

  it("the four enums compose into ChargePointStatus", () => {
    const parsed = ChargePointStatus.parse({
      chargeNow: true,
      chargingLogic: "Vehicle",
      chargingCurrentControl: "FullPower",
      LEDState: "Charging",
      AntiSleep: "Enabled",
    });
    expect(parsed.chargingLogic).toBe("Vehicle");
  });
});

describe("EvnexChargePointConnectorMeter register -> rawRegister alias (§2.1)", () => {
  it("transforms the wire `register` key to `rawRegister`", () => {
    const parsed = EvnexChargePointConnectorMeter.parse({
      powerType: "AC_1_PHASE",
      updatedDate: "2024-06-01T00:00:00Z",
      power: 0,
      register: 12345.6,
      frequency: 50,
    });
    expect(parsed.rawRegister).toBe(12345.6);
    expect((parsed as unknown as Record<string, unknown>).register).toBeUndefined();
  });

  it("is exercised end-to-end through the v2 charge-points envelope", () => {
    const items = EvnexGetChargePointsResponse.parse(CHARGE_POINTS_PAYLOAD).data.items;
    expect(items[0]?.connectors?.[0]?.meter?.rawRegister).toBe(12345.6);
  });
});

describe("EvnexChargePointLoadSchedule.timezone (PLAN.md §10.1 regression)", () => {
  it("parses successfully when `timezone` is entirely absent, unlike upstream Python", () => {
    // Upstream declares `timezone: str` (required, no default), which raises
    // pydantic ValidationError on every real response, because the live API
    // never sends the field. This is the one test in this suite that
    // intentionally diverges from Python's behaviour — see PLAN.md §10.1.
    const payload = {
      duration: 3600,
      enabled: true,
      units: "W",
      chargingProfilePeriods: [{ limit: 32, start: 0 }],
    };
    const parsed = EvnexChargePointLoadSchedule.parse(payload);
    expect(parsed.timezone).toBeUndefined();
    expect(parsed.duration).toBe(3600);
  });

  it("still accepts an explicit timezone when the wire does send one", () => {
    const parsed = EvnexChargePointLoadSchedule.parse({
      duration: 3600,
      enabled: true,
      timezone: "Pacific/Auckland",
      units: "W",
      chargingProfilePeriods: [],
    });
    expect(parsed.timezone).toBe("Pacific/Auckland");
  });

  it("accepts an explicit null for timezone", () => {
    const parsed = EvnexChargePointLoadSchedule.parse({
      duration: 3600,
      enabled: true,
      timezone: null,
      units: "W",
      chargingProfilePeriods: [],
    });
    expect(parsed.timezone).toBeNull();
  });
});

describe("unknown fields are tolerated, not rejected (§2.2 — objects are never .strict())", () => {
  it("EvnexGetChargePointsResponse ignores a field the API adds without warning", () => {
    const payload = {
      data: {
        items: [
          {
            ...CHARGE_POINTS_PAYLOAD.data.items[0],
            // A field the API might add tomorrow that no schema here knows
            // about yet. pydantic ignores unknown fields by default; a
            // `.strict()` Zod object would instead throw and turn a benign
            // API addition into a hard outage for every consumer.
            newFieldFromTheFuture: "surprise",
          },
        ],
      },
    };
    expect(() => EvnexGetChargePointsResponse.parse(payload)).not.toThrow();
    const parsed = EvnexGetChargePointsResponse.parse(payload);
    expect(parsed.data.items[0]?.id).toBe("cp-0000001");
  });
});

describe("Coordinates (PLAN.md §10 / D5 schema sweep regression)", () => {
  it("parses latitude/longitude as strings, not numbers — live-verified: the wire sends '-41.2865', not -41.2865", () => {
    const parsed = Coordinates.parse({ latitude: "-41.2865", longitude: "174.7762" });
    expect(parsed).toEqual({ latitude: "-41.2865", longitude: "174.7762" });
  });

  it("rejects a numeric latitude/longitude — this schema deliberately does not coerce, matching src/schema/v3/locations.ts's EvnexLocationCoordinates", () => {
    expect(() => Coordinates.parse({ latitude: -41.2865, longitude: 174.7762 })).toThrow();
  });
});

describe("EvnexChargePointSolarConfig (PLAN.md §10 / D5 schema sweep regression)", () => {
  it("parses ordinary boolean/number values when solar control is supported", () => {
    const parsed = EvnexChargePointSolarConfig.parse({
      solarWithSchedule: true,
      powerSensorInstalled: true,
      solarStartExportPower: 100,
      solarStopImportPower: 50,
    });
    expect(parsed.solarWithSchedule).toBe(true);
    expect(parsed.solarStartExportPower).toBe(100);
  });

  it("parses every field as the literal 'NotSupported' when solar control is unsupported — the exact live-observed shape", () => {
    const parsed = EvnexChargePointSolarConfig.parse({
      numChargingPhases: "NotSupported",
      solarWithSchedule: "NotSupported",
      allowPhaseSwitchingOnSolar: "NotSupported",
      powerSensorInstalled: true,
      solarStartExportPower: "NotSupported",
      solarStopImportPower: "NotSupported",
      solarControlTargetOffset: "NotSupported",
      solarControlTargetPower: "NotSupported",
    });
    expect(parsed.solarWithSchedule).toBe("NotSupported");
    expect(parsed.solarStartExportPower).toBe("NotSupported");
    expect(parsed.solarStopImportPower).toBe("NotSupported");
    expect(parsed.numChargingPhases).toBe("NotSupported");
    expect(parsed.allowPhaseSwitchingOnSolar).toBe("NotSupported");
    expect(parsed.solarControlTargetOffset).toBe("NotSupported");
    expect(parsed.solarControlTargetPower).toBe("NotSupported");
  });

  it("tolerates the four newly-added fields being absent entirely — only ever observed live, never corroborated as required", () => {
    const parsed = EvnexChargePointSolarConfig.parse({
      solarWithSchedule: true,
      powerSensorInstalled: false,
      solarStartExportPower: 0,
      solarStopImportPower: 0,
    });
    expect(parsed.numChargingPhases).toBeUndefined();
    expect(parsed.allowPhaseSwitchingOnSolar).toBeUndefined();
    expect(parsed.solarControlTargetOffset).toBeUndefined();
    expect(parsed.solarControlTargetPower).toBeUndefined();
  });
});
