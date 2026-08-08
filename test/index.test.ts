import { describe, expect, it } from "vitest";
import * as evnex from "../src/index.js";

// src/index.ts is a pure re-export barrel (F0's real deliverable, PLAN.md §5).
// Loading it exercises every export declaration; this test also pins the
// public surface so an accidental rename/removal is caught immediately.
describe("evnex public surface", () => {
  it("exports the API client and its option types are usable", () => {
    expect(evnex.Evnex).toBeTypeOf("function");
  });

  it("exports the config class", () => {
    expect(evnex.EvnexConfig).toBeTypeOf("function");
  });

  it("exports the full error hierarchy", () => {
    expect(evnex.EvnexError).toBeTypeOf("function");
    expect(evnex.EvnexAuthError).toBeTypeOf("function");
    expect(evnex.InvalidCredentialsError).toBeTypeOf("function");
    expect(evnex.ReauthenticationRequiredError).toBeTypeOf("function");
    expect(evnex.ChallengeExpiredError).toBeTypeOf("function");
    expect(evnex.PasswordChangeRequiredError).toBeTypeOf("function");
    expect(evnex.InvalidChallengeResponseError).toBeTypeOf("function");
    expect(evnex.EvnexConfigurationError).toBeTypeOf("function");
    expect(evnex.EvnexValidationError).toBeTypeOf("function");
    expect(evnex.EvnexHttpError).toBeTypeOf("function");
    expect(evnex.EvnexTimeoutError).toBeTypeOf("function");
  });

  it("exports status enums", () => {
    expect(evnex.DeviceStatus).toBeDefined();
    expect(evnex.DeviceStatusValues.OFFLINE).toBe("OFFLINE");
    expect(evnex.ConnectorOcppStatus).toBeDefined();
  });

  it("exports model parsing", () => {
    expect(evnex.parseModel).toBeTypeOf("function");
  });

  it("exports the shared JSON helper", () => {
    expect(evnex.toJson).toBeTypeOf("function");
  });

  it("exports v2 charge point schemas without collision", () => {
    expect(evnex.EvnexChargePoint).toBeDefined();
    expect(evnex.EvnexChargePointDetail).toBeDefined();
    expect(evnex.EvnexChargePointLocation).toBeDefined();
    expect(evnex.EvnexElectricityCostBrief).toBeDefined();
    expect(evnex.EvnexCommandResponse).toBeDefined();
  });

  it("exports v3 charge point schemas, aliased where they'd collide with v2", () => {
    expect(evnex.EvnexChargePointDetailV3).toBeDefined();
    expect(evnex.EvnexChargePointConnectorV3).toBeDefined();
    expect(evnex.EvnexChargePointConnectorMeterV3).toBeDefined();
    expect(evnex.EvnexElectricityCostV3).toBeDefined();
    expect(evnex.EvnexCommandResponseV3).toBeDefined();
    expect(evnex.EvnexLocation).toBeDefined();
    expect(evnex.OBSERVED_SESSION_STATUSES).toEqual([
      "Pending",
      "Authorized",
      "Active",
      "Closed",
      "Completed",
      "Invalid",
    ]);
    expect(evnex.sessionEnergyWh).toBeTypeOf("function");
    expect(evnex.evnexV3ApiResponse).toBeTypeOf("function");
  });
});
