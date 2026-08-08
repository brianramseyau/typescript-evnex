import { describe, expect, it } from "vitest";
import {
  EvnexGetLocationsResponse,
  EvnexLocation,
  EvnexLocationAddress,
  EvnexLocationChargePointRef,
  EvnexLocationChargePoints,
  EvnexLocationCoordinates,
  EvnexLocationIcpDetails,
  EvnexLocationRelationships,
} from "../../../src/schema/v3/locations.js";

describe("EvnexLocationAddress / EvnexLocationCoordinates / EvnexLocationIcpDetails", () => {
  it("parse fully populated objects", () => {
    expect(
      EvnexLocationAddress.parse({
        address1: "1 Test St",
        address2: null,
        city: "Auckland",
        postCode: "1010",
        state: null,
        country: "NZ",
      }),
    ).toMatchObject({ address1: "1 Test St", city: "Auckland" });

    expect(EvnexLocationCoordinates.parse({ latitude: "-36.8", longitude: "174.7" })).toEqual({
      latitude: "-36.8",
      longitude: "174.7",
    });

    expect(
      EvnexLocationIcpDetails.parse({
        electricityRetailer: "Retailer",
        electricityDistributor: "Distributor",
        networkConnectionPoint: "NCP1",
      }),
    ).toEqual({
      electricityRetailer: "Retailer",
      electricityDistributor: "Distributor",
      networkConnectionPoint: "NCP1",
    });
  });

  it("tolerate a bare empty object — every field is nullish", () => {
    expect(EvnexLocationAddress.parse({})).toEqual({});
    expect(EvnexLocationCoordinates.parse({})).toEqual({});
    expect(EvnexLocationIcpDetails.parse({})).toEqual({});
  });
});

describe("EvnexLocationChargePointRef / EvnexLocationChargePoints", () => {
  it("parses a ref and defaults an absent data array to []", () => {
    expect(EvnexLocationChargePointRef.parse({ type: "chargePoint", id: "cp-1" })).toEqual({
      type: "chargePoint",
      id: "cp-1",
    });
    expect(EvnexLocationChargePoints.parse({})).toEqual({ data: [] });
    expect(
      EvnexLocationChargePoints.parse({ data: [{ type: "chargePoint", id: "cp-1" }] }),
    ).toEqual({ data: [{ type: "chargePoint", id: "cp-1" }] });
  });
});

describe("EvnexLocationRelationships", () => {
  it("defaults to an empty chargePoints wrapper (default_factory port)", () => {
    expect(EvnexLocationRelationships.parse({})).toEqual({ chargePoints: { data: [] } });
  });
});

describe("EvnexLocation / EvnexGetLocationsResponse", () => {
  it("parses a minimal location, defaulting relationships", () => {
    const parsed = EvnexLocation.parse({
      id: "loc-1",
      type: "location",
      attributes: { name: "Home" },
    });
    expect(parsed.relationships).toEqual({ chargePoints: { data: [] } });
  });

  it("parses a fully populated location list response", () => {
    const payload = {
      data: [
        {
          id: "loc-1",
          type: "location",
          attributes: {
            name: "Home",
            address: { city: "Auckland" },
            coordinates: { latitude: "-36.8", longitude: "174.7" },
            isPublic: false,
            updated: "2026-01-01T00:00:00Z",
            created: "2025-01-01T00:00:00Z",
            icpNumber: "ICP123",
            icpDetails: { electricityRetailer: "Retailer" },
            timeZone: "Pacific/Auckland",
          },
          relationships: { chargePoints: { data: [{ type: "chargePoint", id: "cp-1" }] } },
        },
      ],
    };
    const parsed = EvnexGetLocationsResponse.parse(payload);
    expect(parsed.data[0]?.attributes.timeZone).toBe("Pacific/Auckland");
    expect(parsed.data[0]?.relationships.chargePoints.data).toHaveLength(1);
  });
});
