import { describe, expect, it } from "vitest";
import {
  EvnexElectricityCost,
  EvnexElectricityCostTotal,
  EvnexElectricityTariff,
} from "../../../src/schema/v3/cost.js";

describe("EvnexElectricityTariff", () => {
  it("parses a flat tariff", () => {
    expect(EvnexElectricityTariff.parse({ start: 0, rate: 0.32, type: "Flat" })).toEqual({
      start: 0,
      rate: 0.32,
      type: "Flat",
    });
  });
});

describe("EvnexElectricityCost", () => {
  it("parses with cost present", () => {
    const payload = {
      currency: "NZD",
      tariffs: [{ start: 0, rate: 0.32, type: "Flat" }],
      tariffType: "Flat",
      cost: 4.5,
    };
    expect(EvnexElectricityCost.parse(payload)).toEqual(payload);
  });

  it("defaults cost to undefined when omitted (nullish)", () => {
    const parsed = EvnexElectricityCost.parse({
      currency: "NZD",
      tariffs: [],
      tariffType: "Flat",
    });
    expect(parsed.cost).toBeUndefined();
  });
});

describe("EvnexElectricityCostTotal", () => {
  it("parses amount and tolerates an unknown distribution shape", () => {
    const parsed = EvnexElectricityCostTotal.parse({
      currency: "NZD",
      amount: 12.34,
      distribution: { tariff: 12.34 },
    });
    expect(parsed.amount).toBe(12.34);
    expect(parsed.distribution).toEqual({ tariff: 12.34 });
  });

  it("tolerates distribution being entirely absent", () => {
    const parsed = EvnexElectricityCostTotal.parse({ currency: "NZD", amount: 0 });
    expect(parsed.distribution).toBeUndefined();
  });
});
