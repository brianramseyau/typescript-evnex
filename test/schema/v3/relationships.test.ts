import { describe, expect, it } from "vitest";
import {
  EvnexRelationship,
  EvnexRelationships,
  EvnexRelationshipWrapper,
} from "../../../src/schema/v3/relationships.js";

describe("EvnexRelationship", () => {
  it("parses id/type", () => {
    expect(EvnexRelationship.parse({ id: "cp-1", type: "chargePoint" })).toEqual({
      id: "cp-1",
      type: "chargePoint",
    });
  });
});

describe("EvnexRelationshipWrapper", () => {
  it("accepts a present relationship", () => {
    expect(
      EvnexRelationshipWrapper.parse({ data: { id: "cp-1", type: "chargePoint" } }),
    ).toEqual({ data: { id: "cp-1", type: "chargePoint" } });
  });

  it("accepts an explicit null and omission (data is nullish)", () => {
    expect(EvnexRelationshipWrapper.parse({ data: null })).toEqual({ data: null });
    expect(EvnexRelationshipWrapper.parse({})).toEqual({});
  });
});

describe("EvnexRelationships", () => {
  it("parses all three keys when present", () => {
    const payload = {
      chargePoint: { data: { id: "cp-1", type: "chargePoint" } },
      location: { data: { id: "loc-1", type: "location" } },
      organisation: { data: { id: "org-1", type: "organisation" } },
    };
    expect(EvnexRelationships.parse(payload)).toEqual(payload);
  });

  it("tolerates a bare empty object — every key is optional", () => {
    expect(EvnexRelationships.parse({})).toEqual({});
  });
});
