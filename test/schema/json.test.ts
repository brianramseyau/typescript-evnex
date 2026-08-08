/**
 * `toJson()` (`src/schema/json.ts`) — ported behaviour from pydantic's
 * `model_dump(mode="json")`, consumed by every CLI `--json` path and by A9's
 * fixture tests (PLAN.md §2.6, §5 A3).
 */

import { describe, expect, it } from "vitest";
import { toJson } from "../../src/schema/json.js";
import { EvnexGetChargePointsResponse } from "../../src/schema/chargePoints.js";
import { CHARGE_POINTS_PAYLOAD } from "../support/fixtures.js";

describe("toJson", () => {
  it("passes strings, numbers, and booleans through unchanged", () => {
    expect(toJson("hello")).toBe("hello");
    expect(toJson(42)).toBe(42);
    expect(toJson(0)).toBe(0);
    expect(toJson(true)).toBe(true);
    expect(toJson(false)).toBe(false);
  });

  it("preserves null", () => {
    expect(toJson(null)).toBeNull();
  });

  it("passes undefined through at the top level", () => {
    // Only object *keys* whose value is undefined get dropped; a bare
    // undefined value itself is a primitive as far as toJson is concerned.
    expect(toJson(undefined)).toBeUndefined();
  });

  it("converts a whole-second Date to an ISO string with no fractional component", () => {
    // pydantic's model_dump(mode="json") renders a zero-microsecond datetime
    // without a fractional-seconds suffix at all; Date#toISOString() always
    // emits ".000Z", so that suffix must be stripped to match.
    const date = new Date("2024-06-01T00:00:00.000Z");
    expect(toJson(date)).toBe("2024-06-01T00:00:00Z");
  });

  it("keeps a genuine sub-second Date's fractional component", () => {
    const date = new Date("2026-07-16T10:25:00.123Z");
    expect(toJson(date)).toBe("2026-07-16T10:25:00.123Z");
  });

  it("recurses into arrays, converting each element", () => {
    const input = [1, "two", new Date("2024-01-01T00:00:00.000Z"), null];
    expect(toJson(input)).toEqual([1, "two", "2024-01-01T00:00:00Z", null]);
  });

  it("keeps undefined array elements in place (does not filter them out)", () => {
    // Array.prototype.map never removes elements — only an object *key* with
    // an undefined value is dropped, not an undefined array member.
    const input: unknown[] = [1, undefined, 3];
    expect(toJson(input)).toEqual([1, undefined, 3]);
  });

  it("recurses into nested plain objects", () => {
    const input = {
      a: 1,
      b: { c: 2, d: { e: new Date("2024-01-01T00:00:00.000Z") } },
    };
    expect(toJson(input)).toEqual({
      a: 1,
      b: { c: 2, d: { e: "2024-01-01T00:00:00Z" } },
    });
  });

  it("drops object keys whose value is undefined", () => {
    const input = { a: 1, b: undefined, c: null };
    const result = toJson(input);
    expect(result).toEqual({ a: 1, c: null });
    expect(Object.prototype.hasOwnProperty.call(result, "b")).toBe(false);
  });

  it("preserves null-valued object keys", () => {
    const input = { a: null };
    expect(toJson(input)).toEqual({ a: null });
  });

  it("handles an object nested inside an array nested inside an object", () => {
    const input = {
      items: [
        { id: 1, deletedAt: undefined, seenAt: null },
        { id: 2, deletedAt: new Date("2024-06-01T00:00:00.000Z"), seenAt: null },
      ],
    };
    expect(toJson(input)).toEqual({
      items: [
        { id: 1, seenAt: null },
        { id: 2, deletedAt: "2024-06-01T00:00:00Z", seenAt: null },
      ],
    });
  });

  it("handles an empty object and an empty array", () => {
    expect(toJson({})).toEqual({});
    expect(toJson([])).toEqual([]);
  });

  it("round-trips a fully populated v2 charge point to output byte-identical to Python's model_dump(mode='json')", () => {
    const chargePoint = EvnexGetChargePointsResponse.parse(CHARGE_POINTS_PAYLOAD).data
      .items[0];
    expect(chargePoint).toBeDefined();

    const dumped = toJson(chargePoint);

    // Every datetime becomes a whole-second ISO string (no ".000Z"); the wire
    // `register` key surfaces as `rawRegister` per the §2.1 alias (the one
    // deliberate field-name divergence: Python's own aliased field name is
    // `raw_register`, snake_case, while the TS port renders it camelCase per
    // its own naming convention — the alias *behaviour* matches, the
    // identifier spelling follows each language's convention). Every other
    // field name and value is byte-identical to what Python's
    // model_dump(mode="json") produces for this same payload.
    expect(dumped).toEqual({
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
            rawRegister: 12345.6,
            frequency: 50,
          },
        },
      ],
      lastHeard: "2024-06-01T00:00:00Z",
      maxCurrent: 32,
      tokenRequired: false,
      needsRegistrationInformation: false,
    });

    // No key in the dump is ever the JS sentinel `undefined` — every field
    // this fixture omits (e.g. no optional field was omitted here) simply
    // does not appear as an own key, matching pydantic's default dump shape.
    expect(JSON.parse(JSON.stringify(dumped))).toEqual(dumped);
  });
});
