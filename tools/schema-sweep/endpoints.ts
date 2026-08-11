/**
 * The resource graph the sweep walks — PLAN.md's D5 schema sweep subsection:
 * "user detail → org → charge points → per-charge-point detail (both v2 and
 * v3), status, energy meter reading, override, solar config, transactions
 * (v2) and sessions → locations, insight, summary status, connector
 * summary."
 *
 * **Read-only by construction.** Every request here is built by hand from
 * the same path templates `src/api.ts`'s read methods use — never by
 * importing `Evnex` (`src/api.ts`) or the package barrel (`src/index.ts`,
 * which re-exports `Evnex`). Only individual schema modules, and nothing
 * from `src/api.ts`, are imported below. `test/tools/readonly-import.test.ts`
 * enforces this by walking the actual import graph and asserting
 * `src/api.ts` is never reached, plus grepping this whole directory for the
 * eight mutating method names by name.
 *
 * Four of the fourteen endpoints below (`get-status`, `get-energy-meter-reading`,
 * `get-override`, `get-solar`) are HTTP `POST`s in the real API — they are
 * still read-only commands (no charger state changes), which is why PLAN.md
 * explicitly lists "status, energy meter reading, override, solar config"
 * alongside the plain `GET` endpoints in the same walk. What is excluded,
 * deliberately and completely, is every endpoint that changes charger state:
 * `set-override`, `remote-stop-transaction`, `change-availability`,
 * `unlock-connector`, `load-management`, `charge-schedule`.
 */

import { EvnexHttpError } from "../../src/http/errors.js";
import { EvnexTimeoutError } from "../../src/http/errors.js";
import type { RequestSpec } from "../../src/http/transport.js";
import {
  EvnexChargePointEnergyMeterReadingResponse,
  EvnexChargePointOverrideConfig,
  EvnexChargePointSolarConfig,
  EvnexChargePointStatusResponse,
  EvnexGetChargePointDetailResponse,
  EvnexGetChargePointTransactionsResponse,
  EvnexGetChargePointsResponse,
} from "../../src/schema/chargePoints.js";
import {
  EvnexGetOrgInsights,
  EvnexGetOrgSummaryStatusResponse,
} from "../../src/schema/org.js";
import { EvnexGetUserResponse } from "../../src/schema/user.js";
import {
  EvnexChargePointDetail as EvnexChargePointDetailV3Schema,
  EvnexGetChargePointSessionsResponse,
} from "../../src/schema/v3/chargePoints.js";
import { evnexV3ApiResponse } from "../../src/schema/v3/generic.js";
import { EvnexGetLocationsResponse } from "../../src/schema/v3/locations.js";
import { EvnexGetOrgConnectorSummaryResponse } from "../../src/schema/v3/org.js";
import type { EndpointDefinition, SweepContext } from "./types.js";

const chargePointDetailV3Response = evnexV3ApiResponse(EvnexChargePointDetailV3Schema);

/** Best-effort read of `data.organisations[0].id` from a raw (unvalidated) user-detail body. */
function extractOrgId(rawJson: unknown): string | undefined {
  const data = (rawJson as { data?: unknown } | null)?.data as
    { organisations?: unknown } | undefined;
  const organisations = data?.organisations;
  if (!Array.isArray(organisations) || organisations.length === 0) return undefined;
  const first = organisations[0] as { id?: unknown } | undefined;
  return typeof first?.id === "string" ? first.id : undefined;
}

/** Best-effort read of `data.items[0].id` from a raw (unvalidated) charge-points-list body. */
function extractChargePointId(rawJson: unknown): string | undefined {
  const data = (rawJson as { data?: unknown } | null)?.data as
    { items?: unknown } | undefined;
  const items = data?.items;
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const first = items[0] as { id?: unknown } | undefined;
  return typeof first?.id === "string" ? first.id : undefined;
}

/**
 * Best-effort read of `data.items[0].location.id` from the same
 * charge-points-list body. Not needed to build any request path — this
 * endpoint's own `location` object is embedded inline — but a location id
 * ties directly to a residential address, and it also appears independently
 * in `orgLocations` and the v3 charge point detail's `included` array.
 * Capturing it here lets the report redact it everywhere, the same way it
 * already does for org/charge point id.
 */
function extractLocationId(rawJson: unknown): string | undefined {
  const data = (rawJson as { data?: unknown } | null)?.data as
    { items?: unknown } | undefined;
  const items = data?.items;
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const first = items[0] as { location?: unknown } | undefined;
  const location = first?.location as { id?: unknown } | undefined;
  return typeof location?.id === "string" ? location.id : undefined;
}

export const ENDPOINTS: readonly EndpointDefinition[] = [
  {
    id: "userDetail",
    title: "User detail",
    deprecated: false,
    requires: [],
    method: "GET",
    pathTemplate: "/v2/apps/user",
    buildRequest: (): RequestSpec => ({ method: "GET", path: "/v2/apps/user" }),
    schema: EvnexGetUserResponse,
    pythonNotes: [
      'evnex/schema/user.py: EvnexUserDetail — name is `str | None = None` (optional, matches our .nullish()); id/createdDate/updatedDate/email/organisations required in both; type defaults to "User" in both.',
      "evnex/schema/org.py: EvnexOrgBrief — tierDetails: Any = None (optional in both); namespacePrefix optional in both; all other 7 fields required in both. No known divergence.",
    ],
    extractContext: (rawJson) => ({ orgId: extractOrgId(rawJson) }),
  },
  {
    id: "orgChargePoints",
    title: "Org charge points (v2, flat envelope)",
    deprecated: false,
    requires: ["org"],
    method: "GET",
    pathTemplate: "/v2/apps/organisations/{orgId}/charge-points",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.orgId === undefined
        ? undefined
        : { method: "GET", path: `/v2/apps/organisations/${ctx.orgId}/charge-points` },
    schema: EvnexGetChargePointsResponse,
    nonRetryable: [EvnexHttpError],
    pythonNotes: [
      "evnex/schema/charge_points.py: EvnexChargePoint — connectors/lastHeard optional (`| None = None`) in both; maxCurrent/tokenRequired/needsRegistrationInformation required in both. No known divergence.",
    ],
    extractContext: (rawJson) => ({
      chargePointId: extractChargePointId(rawJson),
      locationId: extractLocationId(rawJson),
    }),
  },
  {
    id: "chargePointDetailV2",
    title: "Charge point detail (v2, deprecated)",
    deprecated: true,
    requires: ["chargePoint"],
    method: "GET",
    pathTemplate: "/v2/apps/charge-points/{chargePointId}",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.chargePointId === undefined
        ? undefined
        : { method: "GET", path: `/v2/apps/charge-points/${ctx.chargePointId}` },
    schema: EvnexGetChargePointDetailResponse,
    pythonNotes: [
      "*** TOP PRIORITY — no live fixture exists for this endpoint in either python-evnex or this project (PARITY.md's EvnexChargePointDetail (v2) row says so explicitly). This is the sweep's main reason to exist. ***",
      "evnex/schema/charge_points.py: EvnexChargePointDetail(EvnexChargePointBase) — configuration, electricityCost, loadSchedule, and connectors (a plain, non-optional list, unlike EvnexChargePoint's optional connectors) are ALL required with no default in Python. The port preserves that requiredness exactly (has not loosened anything to compensate for the missing fixture).",
      "evnex/schema/charge_points.py: EvnexChargePointLoadSchedule.timezone is `str` (required, no default) in Python — this is the confirmed §10.1 upstream bug (the live API omits it from every load-schedule response). Our EvnexChargePointLoadSchedule.timezone is .nullish() (deliberate fix, see src/schema/chargePoints.ts's comment). If this capture's loadSchedule is present, check whether `timezone` is actually absent — that is the live confirmation §10.1 predicted but never had.",
      "If this endpoint 404s, times out, or otherwise fails outright: that is itself a finding worth recording (deprecated endpoints sometimes get withdrawn entirely) — capture it as such, do not treat a hard failure here as a tooling bug.",
    ],
  },
  {
    id: "chargePointDetailV3",
    title: "Charge point detail (v3, JSON:API envelope)",
    deprecated: false,
    requires: ["chargePoint"],
    method: "GET",
    pathTemplate: "/charge-points/{chargePointId}",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.chargePointId === undefined
        ? undefined
        : { method: "GET", path: `/charge-points/${ctx.chargePointId}` },
    schema: chargePointDetailV3Response,
    nonRetryable: [TypeError],
    pythonNotes: [
      "evnex/schema/v3/charge_points.py: EvnexChargePointDetail — timeZone required (no default) in both; connectionConfiguration/features/iccid/isSolarEnabled optional in both. No known divergence on the attributes object itself.",
      "evnex/schema/v3/generic.py: EvnexV3APIResponse.included — Python's `list[EvnexV3Include] | None` has NO `= None` default, which under pydantic v2 semantics makes the *key* required (nullable, but must be present). Our evnexV3ApiResponse's `included` is `.nullish()` — optional AND nullable, strictly more lenient. Check this capture's raw body for whether the top-level `included` key is present at all (even as `null`) — PARITY.md's 'Defects found but not fixed' #1 flags this as unverified against a live account.",
    ],
  },
  {
    id: "chargePointStatus",
    title: "Charge point status (command: get-status)",
    deprecated: false,
    requires: ["chargePoint"],
    method: "POST",
    pathTemplate: "/charge-points/{chargePointId}/commands/get-status",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.chargePointId === undefined
        ? undefined
        : {
            method: "POST",
            path: `/charge-points/${ctx.chargePointId}/commands/get-status`,
          },
    schema: EvnexChargePointStatusResponse,
    nonRetryable: [EvnexTimeoutError],
    pythonNotes: [
      "evnex/schema/charge_points.py: EvnexChargePointStatus — chargePointStatus optional in both (offline chargers report commandResultStatus without a nested status). ChargePointStatus's 5 fields are all required in both when present. No known divergence.",
      "A timeout here (EvnexTimeoutError) means the charge point is offline — expected and not itself a schema defect; the examples/getChargePointDetail.ts script deliberately skips this and later calls for an OFFLINE charge point for exactly this reason.",
    ],
  },
  {
    id: "chargePointEnergyMeterReading",
    title: "Charge point energy meter reading (command: get-energy-meter-reading)",
    deprecated: false,
    requires: ["chargePoint"],
    method: "POST",
    pathTemplate: "/charge-points/{chargePointId}/commands/get-energy-meter-reading",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.chargePointId === undefined
        ? undefined
        : {
            method: "POST",
            path: `/charge-points/${ctx.chargePointId}/commands/get-energy-meter-reading`,
          },
    schema: EvnexChargePointEnergyMeterReadingResponse,
    nonRetryable: [EvnexTimeoutError],
    pythonNotes: [
      "evnex/schema/charge_points.py: EvnexChargePointEnergyMeterReading — all 3 fields (timestamp, chargingActivePower, supplyActivePower) required, no optionality anywhere in Python or ours — unlike the v3 connector meter's supplyActivePower, which is optional there. Confirm this capture actually carries all 3 fields; if supplyActivePower is ever absent here that would be a genuine new finding, not merely corroborating the known v3 divergence.",
    ],
  },
  {
    id: "chargePointOverride",
    title: "Charge point override config (command: get-override)",
    deprecated: false,
    requires: ["chargePoint"],
    method: "POST",
    pathTemplate: "/charge-points/{chargePointId}/commands/get-override",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.chargePointId === undefined
        ? undefined
        : {
            method: "POST",
            path: `/charge-points/${ctx.chargePointId}/commands/get-override`,
            timeoutMs: 15_000,
          },
    schema: EvnexChargePointOverrideConfig,
    nonRetryable: [EvnexTimeoutError],
    pythonNotes: [
      'evnex/schema/charge_points.py: EvnexChargePointOverrideConfig.chargeNow — `bool | Literal["NotSupported"]`, required in both, ported as z.union([z.boolean(), z.literal("NotSupported")]). Confirm this capture\'s value is one of those two shapes and not, e.g., a bare string status like "Enabled"/"Disabled" that would silently fail the union.',
    ],
  },
  {
    id: "chargePointSolarConfig",
    title: "Charge point solar config (command: get-solar)",
    deprecated: false,
    requires: ["chargePoint"],
    method: "POST",
    pathTemplate: "/charge-points/{chargePointId}/commands/get-solar",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.chargePointId === undefined
        ? undefined
        : {
            method: "POST",
            path: `/charge-points/${ctx.chargePointId}/commands/get-solar`,
          },
    schema: EvnexChargePointSolarConfig,
    nonRetryable: [EvnexTimeoutError],
    pythonNotes: [
      "evnex/schema/charge_points.py: EvnexChargePointSolarConfig — all 4 fields required in both, no known divergence. No fixture existed in either project prior to this sweep for a charger the sweep operator actually owns; capture is genuinely new evidence either way.",
    ],
  },
  {
    id: "chargePointTransactionsV2",
    title: "Charge point transactions (v2, deprecated)",
    deprecated: true,
    requires: ["chargePoint"],
    method: "GET",
    pathTemplate: "/v2/apps/charge-points/{chargePointId}/transactions",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.chargePointId === undefined
        ? undefined
        : {
            method: "GET",
            path: `/v2/apps/charge-points/${ctx.chargePointId}/transactions`,
          },
    schema: EvnexGetChargePointTransactionsResponse,
    pythonNotes: [
      "evnex/schema/charge_points.py: EvnexChargePointTransaction — endDate/reason/carbonOffset/electricityCost optional in both; startDate required (no default) in both. No known divergence. Like the v2 detail endpoint, this is deprecated and may return nothing at all on an account with no history through it — a clean empty items:[] response, an HTTP error, or a timeout are all plausible and all informative.",
    ],
  },
  {
    id: "chargePointSessions",
    title: "Charge point sessions (v3, JSON:API envelope)",
    deprecated: false,
    requires: ["chargePoint"],
    method: "GET",
    pathTemplate: "/charge-points/{chargePointId}/sessions",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.chargePointId === undefined
        ? undefined
        : { method: "GET", path: `/charge-points/${ctx.chargePointId}/sessions` },
    schema: EvnexGetChargePointSessionsResponse,
    pythonNotes: [
      "evnex/schema/v3/charge_points.py: EvnexChargePointSessionAttributes — every one of the 17 fields is `= None` (optional) in Python, including startDate/sessionStatus; the port matches exactly (all .nullish()). No known divergence. This is the endpoint PLAN.md §10.3/§10.4 warn hardest against ever tightening.",
    ],
  },
  {
    id: "orgLocations",
    title: "Org locations (v3, JSON:API envelope)",
    deprecated: false,
    requires: ["org"],
    method: "GET",
    pathTemplate: "/v2/apps/organisations/{orgId}/locations",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.orgId === undefined
        ? undefined
        : { method: "GET", path: `/v2/apps/organisations/${ctx.orgId}/locations` },
    schema: EvnexGetLocationsResponse,
    nonRetryable: [EvnexHttpError],
    pythonNotes: [
      "evnex/schema/v3/locations.py: EvnexLocationAttributes — only `name` required, all 8 others optional in both. EvnexLocationCoordinates.latitude/longitude are `str | None`, not float — the port deliberately keeps them as z.string().nullish() rather than 'correcting' them to numbers. No known divergence. Note: latitude/longitude are redacted in this capture's stored body regardless of their string/number wire type.",
    ],
  },
  {
    id: "orgInsight",
    title: "Org insight (7-day)",
    deprecated: false,
    requires: ["org"],
    method: "GET",
    pathTemplate: "/organisations/{orgId}/summary/insights",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.orgId === undefined
        ? undefined
        : {
            method: "GET",
            path: `/organisations/${ctx.orgId}/summary/insights`,
            query: { days: 7, "tz-offset": 12 },
          },
    schema: EvnexGetOrgInsights,
    pythonNotes: [
      "evnex/schema/org.py: EvnexOrgInsightEntry — only carbonUsage optional in both; cost (nested EvnexCost) itself required in both, though EvnexCost's own 2 fields are optional. No known divergence.",
    ],
  },
  {
    id: "orgSummaryStatusV2",
    title: "Org summary status (v2, flat)",
    deprecated: false,
    requires: ["org"],
    method: "GET",
    pathTemplate: "/v2/apps/organisations/{orgId}/summary/status",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.orgId === undefined
        ? undefined
        : { method: "GET", path: `/v2/apps/organisations/${ctx.orgId}/summary/status` },
    schema: EvnexGetOrgSummaryStatusResponse,
    pythonNotes: [
      "evnex/schema/org.py: EvnexOrgSummaryStatus — all 7 per-status connector counts required in both, no optionality anywhere. No known divergence. No fixture existed in either project prior to this sweep for this specific (v2) endpoint — test/support/fixtures.ts's CONNECTOR_SUMMARY_PAYLOAD is the *v3* orgConnectorSummary endpoint's fixture, a structurally different envelope for the same counts.",
    ],
  },
  {
    id: "orgConnectorSummaryV3",
    title: "Org connector summary (v3, JSON:API-ish envelope)",
    deprecated: false,
    requires: ["org"],
    method: "GET",
    pathTemplate: "/organisations/{orgId}/summary/status",
    buildRequest: (ctx): RequestSpec | undefined =>
      ctx.orgId === undefined
        ? undefined
        : { method: "GET", path: `/organisations/${ctx.orgId}/summary/status` },
    schema: EvnexGetOrgConnectorSummaryResponse,
    pythonNotes: [
      "evnex/schema/v3/org.py: EvnexOrgConnectorSummaryAttributes just nests the same EvnexOrgSummaryStatus one level deeper (`attributes.connectors`) — same requiredness as the v2 endpoint above. No known divergence.",
    ],
  },
] as const;

/** Convenience map for capture.ts / walk.ts's by-id lookups. */
export const ENDPOINTS_BY_ID: ReadonlyMap<string, EndpointDefinition> = new Map(
  ENDPOINTS.map((endpoint) => [endpoint.id, endpoint]),
);

// Re-exported so callers building a SweepContext by hand (tests, the CLI's
// --org/--charge-point flags) share the exact same type as buildRequest.
export type { SweepContext };
