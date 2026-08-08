import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
  EvnexV3Include,
  evnexV3ApiResponse,
  type EvnexV3APIResponse,
} from "../../../src/schema/v3/generic.js";
import { EvnexChargePointDetail } from "../../../src/schema/v3/chargePoints.js";

// A minimal-but-complete EvnexChargePointDetail fixture — every field the
// schema requires with no default.
function chargePointDetailFixture(): unknown {
  return {
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
  };
}

describe("EvnexV3Include", () => {
  it("parses a JSON:API included resource", () => {
    const payload = { id: "loc-1", type: "location", attributes: { name: "Home" } };
    expect(EvnexV3Include.parse(payload)).toEqual(payload);
  });
});

describe("evnexV3ApiResponse factory", () => {
  const ChargePointDetailResponse = evnexV3ApiResponse(EvnexChargePointDetail);

  it("type-infers data.attributes as EvnexChargePointDetail", () => {
    type Parsed = z.infer<typeof ChargePointDetailResponse>;
    expectTypeOf<Parsed["data"]["attributes"]>().toEqualTypeOf<EvnexChargePointDetail>();
    // The standalone exported alias must agree with the factory's own inference.
    expectTypeOf<Parsed>().toEqualTypeOf<EvnexV3APIResponse<EvnexChargePointDetail>>();
  });

  it("parses a full v3 detail envelope with included omitted", () => {
    const payload = {
      data: {
        id: "cp-1",
        type: "chargePoint",
        attributes: chargePointDetailFixture(),
        relationships: {},
      },
    };
    const parsed = ChargePointDetailResponse.parse(payload);
    expect(parsed.included).toBeUndefined();
    expect(parsed.data.attributes.timeZone).toBe("Pacific/Auckland");
    expect(parsed.data.id).toBe("cp-1");
  });

  it("accepts included as an explicit null and as a populated array", () => {
    const base = {
      data: {
        id: "cp-1",
        type: "chargePoint",
        attributes: chargePointDetailFixture(),
        relationships: {},
      },
    };
    expect(ChargePointDetailResponse.parse({ ...base, included: null }).included).toBeNull();

    const withIncluded = {
      ...base,
      included: [{ id: "loc-1", type: "location", attributes: { name: "Home" } }],
    };
    expect(ChargePointDetailResponse.parse(withIncluded).included).toEqual(
      withIncluded.included,
    );
  });

  it("builds a distinct schema per attributes type (not a shared singleton)", () => {
    const OtherResponse = evnexV3ApiResponse(EvnexV3Include);
    expect(OtherResponse).not.toBe(ChargePointDetailResponse);
  });
});
