import { describe, expect, it } from "vitest";
import {
  EvnexGetOrgConnectorSummaryResponse,
  EvnexOrgConnectorSummaryAttributes,
  EvnexOrgConnectorSummaryData,
} from "../../../src/schema/v3/org.js";

const connectorCounts = {
  charging: 1,
  available: 2,
  disabled: 0,
  faulted: 0,
  occupied: 0,
  offline: 0,
  reserved: 0,
};

describe("EvnexOrgConnectorSummaryAttributes / Data", () => {
  it("nests the same per-status counts as EvnexOrgSummaryStatus one level deeper", () => {
    expect(
      EvnexOrgConnectorSummaryAttributes.parse({ connectors: connectorCounts }),
    ).toEqual({ connectors: connectorCounts });

    expect(
      EvnexOrgConnectorSummaryData.parse({ attributes: { connectors: connectorCounts } }),
    ).toEqual({ attributes: { connectors: connectorCounts } });
  });
});

describe("EvnexGetOrgConnectorSummaryResponse", () => {
  it("parses the full JSON:API-style envelope", () => {
    const payload = { data: { attributes: { connectors: connectorCounts } } };
    expect(EvnexGetOrgConnectorSummaryResponse.parse(payload)).toEqual(payload);
  });
});
