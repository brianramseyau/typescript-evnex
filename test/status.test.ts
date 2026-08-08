import { describe, it, expect } from "vitest";
import {
  DeviceStatus,
  DeviceStatusValues,
  ConnectorOcppStatus,
} from "../src/status.js";

describe("DeviceStatus enum", () => {
  it("has all expected statuses", () => {
    const statuses = [
      "OFFLINE",
      "AVAILABLE",
      "PREPARING",
      "CHARGING",
      "SUSPENDED_EVSE",
      "SUSPENDED_EV",
      "FINISHING",
      "RESERVED",
      "UNAVAILABLE",
      "FAULTED",
    ] as const;

    statuses.forEach((status) => {
      const parsed = DeviceStatus.safeParse(status);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toBe(status);
      }
    });
  });

  it("rejects invalid statuses", () => {
    const invalid = "INVALID_STATUS";
    const parsed = DeviceStatus.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it("DeviceStatusValues provides value access", () => {
    expect(DeviceStatusValues.OFFLINE).toBe("OFFLINE");
    expect(DeviceStatusValues.AVAILABLE).toBe("AVAILABLE");
    expect(DeviceStatusValues.PREPARING).toBe("PREPARING");
    expect(DeviceStatusValues.CHARGING).toBe("CHARGING");
    expect(DeviceStatusValues.SUSPENDED_EVSE).toBe("SUSPENDED_EVSE");
    expect(DeviceStatusValues.SUSPENDED_EV).toBe("SUSPENDED_EV");
    expect(DeviceStatusValues.FINISHING).toBe("FINISHING");
    expect(DeviceStatusValues.RESERVED).toBe("RESERVED");
    expect(DeviceStatusValues.UNAVAILABLE).toBe("UNAVAILABLE");
    expect(DeviceStatusValues.FAULTED).toBe("FAULTED");
  });
});

describe("ConnectorOcppStatus", () => {
  it("has entries for all DeviceStatus values", () => {
    const statuses: DeviceStatus[] = [
      "OFFLINE",
      "AVAILABLE",
      "PREPARING",
      "CHARGING",
      "SUSPENDED_EVSE",
      "SUSPENDED_EV",
      "FINISHING",
      "RESERVED",
      "UNAVAILABLE",
      "FAULTED",
    ];

    statuses.forEach((status) => {
      expect(ConnectorOcppStatus[status]).toBeDefined();
      expect(typeof ConnectorOcppStatus[status]).toBe("string");
    });
  });

  it("has exactly 10 entries (exhaustive)", () => {
    const entries = Object.entries(ConnectorOcppStatus);
    expect(entries).toHaveLength(10);
  });

  it("preserves verbatim strings from python-evnex", () => {
    // Values from evnex/status.py
    expect(ConnectorOcppStatus.AVAILABLE).toBe("Available");
    expect(ConnectorOcppStatus.CHARGING).toBe("Charging");
    expect(ConnectorOcppStatus.FAULTED).toBe("Faulted");
    expect(ConnectorOcppStatus.FINISHING).toBe(
      "Finished charging - unplug charge point"
    );
    expect(ConnectorOcppStatus.PREPARING).toBe("Preparing to charge");
    expect(ConnectorOcppStatus.RESERVED).toBe("Reserved");
    expect(ConnectorOcppStatus.SUSPENDED_EV).toBe(
      "The vehicle is not currently requesting energy"
    );
    expect(ConnectorOcppStatus.SUSPENDED_EVSE).toBe(
      "Charging has been paused by the charge point"
    );
    expect(ConnectorOcppStatus.UNAVAILABLE).toBe("Disabled");
    expect(ConnectorOcppStatus.OFFLINE).toBe("Offline");
  });

  it("can be indexed by DeviceStatus values", () => {
    // This test ensures that ConnectorOcppStatus can be indexed with DeviceStatus values
    const status: DeviceStatus = "CHARGING";
    const text = ConnectorOcppStatus[status];
    expect(text).toBe("Charging");
  });

  it("type-checks as exhaustive", () => {
    // This is a compile-time check, but we can verify it at runtime
    // by ensuring all keys are present
    const allStatuses: DeviceStatus[] = [
      "OFFLINE",
      "AVAILABLE",
      "PREPARING",
      "CHARGING",
      "SUSPENDED_EVSE",
      "SUSPENDED_EV",
      "FINISHING",
      "RESERVED",
      "UNAVAILABLE",
      "FAULTED",
    ];

    const missingKeys: (DeviceStatus | string)[] = [];
    allStatuses.forEach((status) => {
      if (!(status in ConnectorOcppStatus)) {
        missingKeys.push(status);
      }
    });
    expect(missingKeys).toEqual([]);
  });
});
