/**
 * Fixture-validation acceptance test (PLAN.md §5 A9) — the
 * `test_fixtures_validate_against_models` analogue from
 * `tests/test_cli_resources.py`. Every fixture in `./fixtures.ts` must parse
 * against the real (already-implemented, non-stub) Zod schema for its
 * endpoint, exactly as the upstream Python fixtures validate against their
 * pydantic models.
 *
 * If a fixture fails here, first suspect the schema, not the fixture — these
 * payloads are transcribed verbatim from a real API response captured by the
 * Python test suite (PLAN.md §10.1 is exactly this kind of finding: a schema
 * that was wrong about what the live API actually sends). Bending a fixture
 * to fit a schema defeats the point of porting it.
 */

import { describe, expect, it } from "vitest";
import { EvnexGetUserResponse } from "../../src/schema/user.js";
import { EvnexGetChargePointsResponse } from "../../src/schema/chargePoints.js";
import { evnexV3ApiResponse } from "../../src/schema/v3/generic.js";
import {
  EvnexChargePointConnectorMeter,
  EvnexChargePointDetail as EvnexChargePointDetailV3,
  EvnexGetChargePointSessionsResponse,
} from "../../src/schema/v3/chargePoints.js";
import { EvnexGetOrgInsights } from "../../src/schema/org.js";
import { EvnexGetLocationsResponse } from "../../src/schema/v3/locations.js";
import { EvnexGetOrgConnectorSummaryResponse } from "../../src/schema/v3/org.js";
import {
  CHARGE_POINTS_PAYLOAD,
  CONNECTOR_METER_WITHOUT_POWER_SENSOR_PAYLOAD,
  CONNECTOR_METER_WITH_POWER_SENSOR_PAYLOAD,
  CONNECTOR_SUMMARY_PAYLOAD,
  DETAIL_V3_PAYLOAD,
  INSIGHTS_PAYLOAD,
  LOCATIONS_PAYLOAD,
  LOCATION_MINIMAL,
  SESSIONS_PAYLOAD,
  TWO_CHARGE_POINTS_PAYLOAD,
  USER_PAYLOAD,
  USER_PAYLOAD_NO_NAME,
  USER_PAYLOAD_NO_ORGS,
} from "./fixtures.js";

describe("fixtures validate against their schemas", () => {
  it("user (with organisations)", () => {
    const user = EvnexGetUserResponse.parse(USER_PAYLOAD).data;
    expect(user.name).toBe("Test User");
    expect(user.organisations[0]?.id).toBe("org-0000");
  });

  it("user (no organisations, tests/test_auth.py fixture)", () => {
    const user = EvnexGetUserResponse.parse(USER_PAYLOAD_NO_ORGS).data;
    expect(user.organisations).toEqual([]);
  });

  it("user without a name still validates (tests/test_schema.py::test_user_without_name_validates)", () => {
    const user = EvnexGetUserResponse.parse(USER_PAYLOAD_NO_NAME).data;
    expect(user.name).toBeUndefined();
    expect(user.email).toBe("user@example.com");
  });

  it("charge points list (v2 flat envelope)", () => {
    const items = EvnexGetChargePointsResponse.parse(CHARGE_POINTS_PAYLOAD).data.items;
    expect(items).toHaveLength(1);
    expect(items[0]?.serial).toBe("SN0000001");
    // The wire key is `register`; the parsed field is `rawRegister` (PLAN.md §2.1).
    expect(items[0]?.connectors?.[0]?.meter?.rawRegister).toBe(12345.6);
  });

  it("two charge points (disambiguation fixture)", () => {
    const items = EvnexGetChargePointsResponse.parse(TWO_CHARGE_POINTS_PAYLOAD).data.items;
    expect(items.map((item) => item.id)).toEqual(["cp-0000001", "cp-0000002"]);
  });

  it("charge point detail (v3 JSON:API envelope)", () => {
    const responseSchema = evnexV3ApiResponse(EvnexChargePointDetailV3);
    const detail = responseSchema.parse(DETAIL_V3_PAYLOAD);
    // Same field-rename assertion as the Python fixture: the JSON key is
    // `register`, the parsed attribute is `rawRegister`.
    expect(detail.data.attributes.connectors[0]?.meter?.rawRegister).toBe(12345.6);
    expect(detail.data.attributes.timeZone).toBe("Pacific/Auckland");
    expect(detail.included).toBeNull();
  });

  it("charge point sessions (v3 JSON:API envelope)", () => {
    const sessions = EvnexGetChargePointSessionsResponse.parse(SESSIONS_PAYLOAD);
    // Unlike an *absent* key, an explicit `null` in the wire payload survives
    // parsing as `null` (`.nullish()` accepts, and passes through, both) —
    // the in-progress session's endDate is a real `null`, not an omitted field.
    expect(sessions.data[0]?.attributes.endDate).toBeNull();
    expect(sessions.data[1]?.attributes.endDate).toBeInstanceOf(Date);
  });

  it("org insights", () => {
    const insights = EvnexGetOrgInsights.parse(INSIGHTS_PAYLOAD);
    expect(insights.data[0]?.attributes.sessions).toBe(1);
  });

  it("locations (v3 JSON:API envelope)", () => {
    const locations = EvnexGetLocationsResponse.parse(LOCATIONS_PAYLOAD);
    expect(locations.data[0]?.attributes.address?.city).toBe("Wellington");
    expect(locations.data[0]?.relationships.chargePoints.data[0]?.id).toBe("cp-0000001");
  });

  it("a location missing its optional sub-objects still validates", () => {
    const minimal = EvnexGetLocationsResponse.parse({ data: [LOCATION_MINIMAL] });
    // An absent optional field decodes to `undefined` (never sent by the
    // wire, never present on the object) — see src/schema/json.ts's docstring
    // on why `undefined` is the "field was absent" signal in this port.
    expect(minimal.data[0]?.attributes.address).toBeUndefined();
    expect(minimal.data[0]?.relationships.chargePoints.data).toEqual([]);
  });

  it("org connector summary (v3 JSON:API envelope)", () => {
    const summary = EvnexGetOrgConnectorSummaryResponse.parse(CONNECTOR_SUMMARY_PAYLOAD);
    expect(summary.data.attributes.connectors.available).toBe(3);
  });

  it("connector meter with a power sensor installed (tests/test_schema.py)", () => {
    const meter = EvnexChargePointConnectorMeter.parse(
      CONNECTOR_METER_WITH_POWER_SENSOR_PAYLOAD,
    );
    expect(meter.supplyActivePower).toBe(7730);
  });

  it("connector meter without a power sensor (tests/test_schema.py)", () => {
    const meter = EvnexChargePointConnectorMeter.parse(
      CONNECTOR_METER_WITHOUT_POWER_SENSOR_PAYLOAD,
    );
    expect(meter.supplyActivePower).toBeUndefined();
  });
});
