/**
 * Sanity-checks the resource graph itself: all 14 endpoints from PLAN.md's
 * D5 walk order are present exactly once, every `buildRequest` respects its
 * declared `requires` (returns `undefined` until resolved, a real spec once
 * it is), and every path template matches the real path `buildRequest`
 * produces once the placeholder is filled in — catching a copy/paste drift
 * between the two.
 */

import { describe, expect, it } from "vitest";
import { ENDPOINTS, ENDPOINTS_BY_ID } from "../../tools/schema-sweep/endpoints.js";

const EXPECTED_IDS = [
  "userDetail",
  "orgChargePoints",
  "chargePointDetailV2",
  "chargePointDetailV3",
  "chargePointStatus",
  "chargePointEnergyMeterReading",
  "chargePointOverride",
  "chargePointSolarConfig",
  "chargePointTransactionsV2",
  "chargePointSessions",
  "orgLocations",
  "orgInsight",
  "orgSummaryStatusV2",
  "orgConnectorSummaryV3",
];

describe("ENDPOINTS", () => {
  it("declares exactly the 14 endpoints from PLAN.md's D5 walk order, once each", () => {
    expect(ENDPOINTS.map((e) => e.id)).toEqual(EXPECTED_IDS);
    expect(new Set(ENDPOINTS.map((e) => e.id)).size).toBe(ENDPOINTS.length);
  });

  it("marks exactly the two v2-deprecated endpoints as deprecated", () => {
    const deprecated = ENDPOINTS.filter((e) => e.deprecated).map((e) => e.id);
    expect(deprecated.sort()).toEqual(
      ["chargePointDetailV2", "chargePointTransactionsV2"].sort(),
    );
  });

  it("every endpoint requiring 'chargePoint' returns undefined until chargePointId is resolved", () => {
    for (const endpoint of ENDPOINTS.filter((e) => e.requires.includes("chargePoint"))) {
      expect(endpoint.buildRequest({})).toBeUndefined();
      expect(endpoint.buildRequest({ orgId: "org-1" })).toBeUndefined();
      expect(endpoint.buildRequest({ chargePointId: "cp-1" })).toBeDefined();
    }
  });

  it("every endpoint requiring 'org' returns undefined until orgId is resolved", () => {
    for (const endpoint of ENDPOINTS.filter((e) => e.requires.includes("org"))) {
      expect(endpoint.buildRequest({})).toBeUndefined();
      expect(endpoint.buildRequest({ chargePointId: "cp-1" })).toBeUndefined();
      expect(endpoint.buildRequest({ orgId: "org-1" })).toBeDefined();
    }
  });

  it("userDetail needs no context at all", () => {
    const userDetail = ENDPOINTS_BY_ID.get("userDetail");
    expect(userDetail?.buildRequest({})).toEqual({
      method: "GET",
      path: "/v2/apps/user",
    });
  });

  it("the resolved request path matches the endpoint's own pathTemplate with placeholders substituted", () => {
    const ctx = { orgId: "org-1", chargePointId: "cp-1" };
    for (const endpoint of ENDPOINTS) {
      const spec = endpoint.buildRequest(ctx);
      expect(spec).toBeDefined();
      const expectedPath = endpoint.pathTemplate
        .replace("{orgId}", ctx.orgId)
        .replace("{chargePointId}", ctx.chargePointId);
      expect(spec?.path).toBe(expectedPath);
      expect(spec?.method).toBe(endpoint.method);
    }
  });

  it("every endpoint has at least one python-comparison note (report item 4 is never silently empty)", () => {
    for (const endpoint of ENDPOINTS) {
      expect(
        endpoint.pythonNotes.length,
        `${endpoint.id} has no pythonNotes`,
      ).toBeGreaterThan(0);
    }
  });

  it("chargePointOverride carries the same 15s timeout as the real client method", () => {
    const spec = ENDPOINTS_BY_ID.get("chargePointOverride")?.buildRequest({
      chargePointId: "cp-1",
    });
    expect(spec?.timeoutMs).toBe(15_000);
  });

  it("orgInsight queries with the same days/tz-offset defaults as the real client method", () => {
    const spec = ENDPOINTS_BY_ID.get("orgInsight")?.buildRequest({ orgId: "org-1" });
    expect(spec?.query).toEqual({ days: 7, "tz-offset": 12 });
  });

  it("userDetail's extractContext reads the first organisation's id, defensively", () => {
    const userDetail = ENDPOINTS_BY_ID.get("userDetail");
    expect(
      userDetail?.extractContext?.({ data: { organisations: [{ id: "org-a" }] } }, {}),
    ).toEqual({
      orgId: "org-a",
    });
    expect(userDetail?.extractContext?.({ data: { organisations: [] } }, {})).toEqual({
      orgId: undefined,
    });
    expect(userDetail?.extractContext?.(null, {})).toEqual({ orgId: undefined });
    expect(userDetail?.extractContext?.({ data: "not-an-object" }, {})).toEqual({
      orgId: undefined,
    });
  });

  it("orgChargePoints' extractContext reads the first charge point's id, defensively", () => {
    const orgChargePoints = ENDPOINTS_BY_ID.get("orgChargePoints");
    expect(
      orgChargePoints?.extractContext?.({ data: { items: [{ id: "cp-a" }] } }, {}),
    ).toEqual({ chargePointId: "cp-a", locationId: undefined });
    expect(orgChargePoints?.extractContext?.({ data: { items: [] } }, {})).toEqual({
      chargePointId: undefined,
      locationId: undefined,
    });
    expect(orgChargePoints?.extractContext?.(undefined, {})).toEqual({
      chargePointId: undefined,
      locationId: undefined,
    });
  });

  it("orgChargePoints' extractContext also reads the first charge point's location id — it ties to a physical address, so the report redacts it the same as org/charge point id", () => {
    const orgChargePoints = ENDPOINTS_BY_ID.get("orgChargePoints");
    expect(
      orgChargePoints?.extractContext?.(
        { data: { items: [{ id: "cp-a", location: { id: "loc-a" } }] } },
        {},
      ),
    ).toEqual({ chargePointId: "cp-a", locationId: "loc-a" });
    expect(
      orgChargePoints?.extractContext?.({ data: { items: [{ id: "cp-a" }] } }, {}),
    ).toEqual({ chargePointId: "cp-a", locationId: undefined });
  });
});
