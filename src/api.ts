/**
 * The EVNEX API client — ported from `evnex/api.py`'s `Evnex` class (all 20
 * methods, including the deprecated v2 pair). PLAN.md §5 B3.
 *
 * Every method composes A8's `Transport` (base URL / headers / timeouts),
 * `withAuthFlow` (bare-token injection + single 401 refresh-and-resend) and
 * `withRetry` (the tenacity-equivalent policy). Retry non-retryable sets are
 * transcribed verbatim from PLAN.md §2.5's table; the four write methods with
 * no Python retry decorator (`setChargerAvailability`, `unlockCharger`,
 * `setChargerLoadProfile`, `setChargePointSchedule`) get none here either.
 */

import { z } from "zod";
import type { EvnexAuth } from "./auth/index.js";
import { EvnexConfig } from "./config.js";
import { EvnexConfigurationError, EvnexValidationError } from "./errors.js";
import { withAuthFlow } from "./http/authFlow.js";
import { EvnexHttpError, EvnexTimeoutError } from "./http/errors.js";
import { withRetry } from "./http/retry.js";
import { checkApiResponse, ensureSuccess, Transport } from "./http/transport.js";
import type { FetchLike, RequestSpec } from "./http/transport.js";
import { EvnexCommandResponse } from "./schema/commands.js";
import {
  EvnexChargeProfileSegment,
  EvnexChargePointEnergyMeterReadingResponse,
  EvnexChargePointLoadSchedule,
  EvnexChargePointOverrideConfig,
  EvnexChargePointSolarConfig,
  EvnexChargePointStatusResponse,
  EvnexGetChargePointDetailResponse,
  EvnexGetChargePointTransactionsResponse,
  EvnexGetChargePointsResponse,
} from "./schema/chargePoints.js";
import type {
  EvnexChargePoint,
  EvnexChargePointDetail,
  EvnexChargePointTransaction,
} from "./schema/chargePoints.js";
import { EvnexGetOrgInsights, EvnexGetOrgSummaryStatusResponse } from "./schema/org.js";
import type { EvnexOrgInsightEntry, EvnexOrgSummaryStatus } from "./schema/org.js";
import { EvnexGetUserResponse } from "./schema/user.js";
import type { EvnexUserDetail } from "./schema/user.js";
import {
  EvnexChargePointDetail as EvnexChargePointDetailV3Schema,
  EvnexGetChargePointSessionsResponse,
} from "./schema/v3/chargePoints.js";
import type {
  EvnexChargePointDetail as EvnexChargePointDetailV3,
  EvnexChargePointSession,
} from "./schema/v3/chargePoints.js";
import { EvnexCommandResponse as EvnexCommandResponseV3 } from "./schema/v3/commands.js";
import { evnexV3ApiResponse } from "./schema/v3/generic.js";
import type { EvnexV3APIResponse } from "./schema/v3/generic.js";
import { EvnexGetLocationsResponse } from "./schema/v3/locations.js";
import type { EvnexLocation } from "./schema/v3/locations.js";
import { EvnexGetOrgConnectorSummaryResponse } from "./schema/v3/org.js";

export interface EvnexOptions {
  /** The authentication component owning the session tokens. */
  auth: EvnexAuth;
  /** Injection point replacing "optionally pass in an httpx client". */
  fetch?: FetchLike;
  /** Override API endpoints or the default org. */
  config?: EvnexConfig;
}

export interface SetChargePointOverrideOptions {
  chargePointId: string;
  chargeNow: boolean;
  connectorId?: number;
}

export interface StopChargePointOptions {
  chargePointId: string;
  orgId?: string;
  connectorId?: string;
  /** Default 10_000, matching Python's `timeout=10`. */
  timeoutMs?: number;
}

export interface ChargerAvailabilityTarget {
  orgId: string;
  chargePointId: string;
  connectorId?: number | string;
}

export interface SetChargerAvailabilityOptions extends ChargerAvailabilityTarget {
  available?: boolean;
  /** Default 10_000, matching Python's `timeout=10`. */
  timeoutMs?: number;
}

export interface UnlockChargerOptions {
  chargePointId: string;
  available?: boolean;
  connectorId?: string;
  /** Default 10_000, matching Python's `timeout=10`. */
  timeoutMs?: number;
}

export interface SetChargerLoadProfileOptions {
  chargePointId: string;
  chargingProfilePeriods: EvnexChargeProfileSegment[];
  enabled?: boolean;
  /** Seconds; default 86_400 (24h). */
  duration?: number;
  units?: string;
  /** Default 10_000, matching Python's `timeout=10`. */
  timeoutMs?: number;
}

export interface SetChargePointScheduleOptions {
  chargePointId: string;
  chargingProfilePeriods: EvnexChargeProfileSegment[];
  enabled?: boolean;
  /** Seconds; default 86_400 (24h). */
  duration?: number;
  /** Default 10_000, matching Python's `timeout=10`. */
  timeoutMs?: number;
}

export interface GetOrgInsightOptions {
  days: number;
  orgId?: string;
  /** Default 12. */
  tzOffset?: number;
}

// -- Envelope schemas for endpoints whose response wraps the payload in a
// bare `{ "data": ... }` object not otherwise modelled as its own named type
// (mirrors Python's `.model_validate(json_data["data"])` call sites).
const commandResponseEnvelope = z.object({ data: EvnexCommandResponse });
const commandResponseV3Envelope = z.object({ data: EvnexCommandResponseV3 });
const loadScheduleEnvelope = z.object({ data: EvnexChargePointLoadSchedule });
const chargePointDetailV3Response = evnexV3ApiResponse(EvnexChargePointDetailV3Schema);

export class Evnex {
  /** The org id resolved so far — set explicitly, from config, or by `getUserDetail`. */
  orgId: string | undefined;
  /** The installed package version, sent as part of the `User-Agent` header. */
  readonly version: string;

  private readonly transport: Transport;
  private readonly sendAuthed: (spec: RequestSpec) => Promise<Response>;
  // Python's `warnings.warn` deduplicates identical warnings by default; this
  // per-instance flag is the closest faithful analogue for a library object
  // (module-global dedup would leak state between unrelated clients/tests).
  private chargePointDetailWarned = false;
  private chargePointTransactionsWarned = false;

  constructor(options: EvnexOptions) {
    const config = options.config ?? new EvnexConfig();
    this.transport = new Transport({
      baseUrl: config.EVNEX_BASE_URL,
      fetch: options.fetch,
    });
    this.sendAuthed = withAuthFlow(this.transport, options.auth);
    this.orgId = config.EVNEX_ORG_ID;
    this.version = this.transport.version;
  }

  /**
   * Close the underlying transport. Safe to call more than once.
   *
   * No persistent per-client resource actually needs releasing: unlike
   * `httpx.AsyncClient` (closed via `client.httpx_client.aclose()` in the
   * Python CLI's `open_client`, see `evnex/cli/_resources.py`), a plain
   * `fetch` — native or injected — owns no connection-pool object this class
   * holds a reference to. Kept so callers written against that cleanup idiom
   * can `await client.close()` unconditionally.
   */
  async close(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Return the organisation id to use, falling back to the configured/
   * resolved default. Raises rather than emitting a request against a
   * literal `undefined` in the path.
   */
  private resolveOrgId(orgId?: string): string {
    const resolved = orgId || this.orgId;
    if (!resolved) {
      throw new EvnexConfigurationError(
        "No organisation id available: pass orgId, set EVNEX_ORG_ID, or call " +
          "getUserDetail() first to resolve the default org.",
      );
    }
    return resolved;
  }

  /** Send an authenticated request and return its parsed JSON body. */
  private async fetchJson(spec: RequestSpec): Promise<unknown> {
    const response = await this.sendAuthed(spec);
    return checkApiResponse(response, spec.path);
  }

  /** Parse `json` against `schema`, wrapping a validation failure per PLAN.md §2.2. */
  private parse<T>(schema: z.ZodType<T>, json: unknown): T {
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new EvnexValidationError(
        "The EVNEX API response did not match the expected shape — the API " +
          "may have changed since this version of evnex was released.",
        { cause: result.error },
      );
    }
    return result.data;
  }

  async getUserDetail(): Promise<EvnexUserDetail> {
    return withRetry(async () => {
      const json = await this.fetchJson({ method: "GET", path: "/v2/apps/user" });
      const data = this.parse(EvnexGetUserResponse, json).data;

      // Default to the user's first org, but never override an org id that
      // was configured explicitly (EVNEX_ORG_ID) or already resolved. A
      // blank EVNEX_ORG_ID counts as unset, matching resolveOrgId's falsy
      // check.
      const [firstOrg] = data.organisations;
      if (!this.orgId && firstOrg) {
        this.orgId = firstOrg.id;
      }

      return data;
    });
  }

  async getOrgChargePoints(orgId?: string): Promise<EvnexChargePoint[]> {
    return withRetry(
      async () => {
        const resolvedOrgId = this.resolveOrgId(orgId);
        const json = await this.fetchJson({
          method: "GET",
          path: `/v2/apps/organisations/${resolvedOrgId}/charge-points`,
        });
        return this.parse(EvnexGetChargePointsResponse, json).data.items;
      },
      { nonRetryable: [EvnexHttpError] },
    );
  }

  async getOrgInsight(options: GetOrgInsightOptions): Promise<EvnexOrgInsightEntry[]> {
    return withRetry(async () => {
      const resolvedOrgId = this.resolveOrgId(options.orgId);
      const json = await this.fetchJson({
        method: "GET",
        path: `/organisations/${resolvedOrgId}/summary/insights`,
        query: { days: options.days, "tz-offset": options.tzOffset ?? 12 },
      });
      return this.parse(EvnexGetOrgInsights, json).data.map((entry) => entry.attributes);
    });
  }

  async getOrgSummaryStatus(orgId?: string): Promise<EvnexOrgSummaryStatus> {
    return withRetry(async () => {
      const resolvedOrgId = this.resolveOrgId(orgId);
      const json = await this.fetchJson({
        method: "GET",
        path: `/v2/apps/organisations/${resolvedOrgId}/summary/status`,
      });
      return this.parse(EvnexGetOrgSummaryStatusResponse, json).data;
    });
  }

  async getOrgLocations(orgId?: string): Promise<EvnexLocation[]> {
    return withRetry(
      async () => {
        const resolvedOrgId = this.resolveOrgId(orgId);
        const json = await this.fetchJson({
          method: "GET",
          path: `/v2/apps/organisations/${resolvedOrgId}/locations`,
        });
        return this.parse(EvnexGetLocationsResponse, json).data;
      },
      { nonRetryable: [EvnexHttpError] },
    );
  }

  /**
   * Per-status connector counts across the organisation. Wraps a newer
   * endpoint than `getOrgSummaryStatus`; the two report the same counts
   * through different response shapes and coexist so callers of either keep
   * working.
   */
  async getOrgConnectorSummary(orgId?: string): Promise<EvnexOrgSummaryStatus> {
    return withRetry(async () => {
      const resolvedOrgId = this.resolveOrgId(orgId);
      const json = await this.fetchJson({
        method: "GET",
        path: `/organisations/${resolvedOrgId}/summary/status`,
      });
      return this.parse(EvnexGetOrgConnectorSummaryResponse, json).data.attributes
        .connectors;
    });
  }

  /** @deprecated use {@link Evnex.getChargePointDetailV3} */
  async getChargePointDetail(chargePointId: string): Promise<EvnexChargePointDetail> {
    if (!this.chargePointDetailWarned) {
      this.chargePointDetailWarned = true;
      process.emitWarning(
        "getChargePointDetail is deprecated. See getChargePointDetailV3.",
        "DeprecationWarning",
      );
    }
    return withRetry(async () => {
      const json = await this.fetchJson({
        method: "GET",
        path: `/v2/apps/charge-points/${chargePointId}`,
      });
      return this.parse(EvnexGetChargePointDetailResponse, json).data;
    });
  }

  async getChargePointDetailV3(
    chargePointId: string,
  ): Promise<EvnexV3APIResponse<EvnexChargePointDetailV3>> {
    return withRetry(
      async () => {
        const json = await this.fetchJson({
          method: "GET",
          path: `/charge-points/${chargePointId}`,
        });
        return this.parse(chargePointDetailV3Response, json);
      },
      { nonRetryable: [TypeError] },
    );
  }

  /** @throws {import("./http/errors.js").EvnexTimeoutError} the charge point is offline */
  async getChargePointSolarConfig(
    chargePointId: string,
  ): Promise<EvnexChargePointSolarConfig> {
    return withRetry(
      async () => {
        const json = await this.fetchJson({
          method: "POST",
          path: `/charge-points/${chargePointId}/commands/get-solar`,
        });
        return this.parse(EvnexChargePointSolarConfig, json);
      },
      { nonRetryable: [EvnexTimeoutError] },
    );
  }

  /** @throws {import("./http/errors.js").EvnexTimeoutError} the charge point is offline */
  async getChargePointOverride(
    chargePointId: string,
  ): Promise<EvnexChargePointOverrideConfig> {
    return withRetry(
      async () => {
        const json = await this.fetchJson({
          method: "POST",
          path: `/charge-points/${chargePointId}/commands/get-override`,
          timeoutMs: 15_000,
        });
        return this.parse(EvnexChargePointOverrideConfig, json);
      },
      { nonRetryable: [EvnexTimeoutError] },
    );
  }

  /**
   * A `EvnexTimeoutError` means the charge point did not acknowledge the
   * command in time (typically offline or not responding); fails fast
   * rather than retrying, which only prolongs the hang and could resubmit
   * the command. Matches `stopChargePoint`'s policy for the same reason.
   */
  async setChargePointOverride(options: SetChargePointOverrideOptions): Promise<boolean> {
    return withRetry(
      async () => {
        const path = `/charge-points/${options.chargePointId}/commands/set-override`;
        const response = await this.sendAuthed({
          method: "POST",
          path,
          json: { connectorId: options.connectorId ?? 1, chargeNow: options.chargeNow },
          timeoutMs: 10_000,
        });
        ensureSuccess(response, path);
        return true;
      },
      { nonRetryable: [EvnexHttpError, EvnexTimeoutError] },
    );
  }

  /** @throws {import("./http/errors.js").EvnexTimeoutError} the charge point is offline */
  async getChargePointStatus(
    chargePointId: string,
  ): Promise<EvnexChargePointStatusResponse> {
    return withRetry(
      async () => {
        const json = await this.fetchJson({
          method: "POST",
          path: `/charge-points/${chargePointId}/commands/get-status`,
        });
        return this.parse(EvnexChargePointStatusResponse, json);
      },
      { nonRetryable: [EvnexTimeoutError] },
    );
  }

  /** @throws {import("./http/errors.js").EvnexTimeoutError} the charge point is offline */
  async getChargePointEnergyMeterReading(
    chargePointId: string,
  ): Promise<EvnexChargePointEnergyMeterReadingResponse> {
    return withRetry(
      async () => {
        const json = await this.fetchJson({
          method: "POST",
          path: `/charge-points/${chargePointId}/commands/get-energy-meter-reading`,
        });
        return this.parse(EvnexChargePointEnergyMeterReadingResponse, json);
      },
      { nonRetryable: [EvnexTimeoutError] },
    );
  }

  /** @deprecated use {@link Evnex.getChargePointSessions} */
  async getChargePointTransactions(
    chargePointId: string,
  ): Promise<EvnexChargePointTransaction[]> {
    if (!this.chargePointTransactionsWarned) {
      this.chargePointTransactionsWarned = true;
      process.emitWarning(
        "getChargePointTransactions is deprecated. See getChargePointSessions.",
        "DeprecationWarning",
      );
    }
    return withRetry(async () => {
      const json = await this.fetchJson({
        method: "GET",
        path: `/v2/apps/charge-points/${chargePointId}/transactions`,
      });
      return this.parse(EvnexGetChargePointTransactionsResponse, json).data.items;
    });
  }

  /**
   * List charging sessions for a charge point. Unlike `getOrgChargePoints`,
   * this v3 endpoint carries no `/v2/apps` prefix, and its envelope is
   * JSON:API (`data[].attributes`), not the flat `data.items` shape of the
   * v2 list endpoints — a genuine difference between endpoints, not a
   * transcription slip (PLAN.md §10.2).
   */
  async getChargePointSessions(
    chargePointId: string,
  ): Promise<EvnexChargePointSession[]> {
    return withRetry(async () => {
      const json = await this.fetchJson({
        method: "GET",
        path: `/charge-points/${chargePointId}/sessions`,
      });
      return this.parse(EvnexGetChargePointSessionsResponse, json).data;
    });
  }

  /**
   * Stop an active charging session. The vehicle will need to be unplugged
   * before starting a new session.
   *
   * @throws {import("./http/errors.js").EvnexTimeoutError} there is no
   *   active charging session — the server answers with a 504 Gateway
   *   Timeout, which surfaces as a read timeout. Raised immediately, without
   *   retry.
   */
  async stopChargePoint(options: StopChargePointOptions): Promise<EvnexCommandResponse> {
    return withRetry(
      async () => {
        const resolvedOrgId = this.resolveOrgId(options.orgId);
        const json = await this.fetchJson({
          method: "POST",
          path:
            `/v2/apps/organisations/${resolvedOrgId}/charge-points/${options.chargePointId}` +
            "/commands/remote-stop-transaction",
          json: { connectorId: options.connectorId ?? "1" },
          timeoutMs: options.timeoutMs ?? 10_000,
        });
        return this.parse(commandResponseEnvelope, json).data;
      },
      { nonRetryable: [EvnexHttpError, EvnexTimeoutError] },
    );
  }

  async enableCharger(options: ChargerAvailabilityTarget): Promise<void> {
    await this.setChargerAvailability({ ...options, available: true });
  }

  async disableCharger(options: ChargerAvailabilityTarget): Promise<void> {
    await this.setChargerAvailability({ ...options, available: false });
  }

  /**
   * Change availability of a charger (or, if it supports multiple
   * connectors, one specific connector). No retry decorator in Python —
   * none is added here either.
   *
   * When a charge point is disabled the charge point detail will include
   * `ocppStatus: "UNAVAILABLE"`, `ocppCode: "NoError"`.
   */
  async setChargerAvailability(
    options: SetChargerAvailabilityOptions,
  ): Promise<EvnexCommandResponseV3> {
    const availability = (options.available ?? true) ? "Operative" : "Inoperative";
    const json = await this.fetchJson({
      method: "POST",
      path:
        `/v2/apps/organisations/${options.orgId}/charge-points/${options.chargePointId}` +
        "/commands/change-availability",
      json: {
        connectorId: options.connectorId ?? 1,
        changeAvailabilityType: availability,
      },
      timeoutMs: options.timeoutMs ?? 10_000,
    });
    return this.parse(commandResponseV3Envelope, json).data;
  }

  /**
   * Tell the charger to try to retract the connector-locking pin (socketed
   * chargers only). Some sockets have no sensor for this and always report
   * success whether or not it actually worked. Also re-enables a disabled
   * charger. No retry decorator in Python — none is added here either.
   */
  async unlockCharger(options: UnlockChargerOptions): Promise<EvnexCommandResponse> {
    // Python's unlock_charger uses `self.org_id` directly rather than
    // `_resolve_org_id`, so an unset org id becomes the literal string
    // "None" in the request path instead of a clear error — a genuine bug
    // (see this file's PARITY notes). resolveOrgId() gives this method the
    // same fail-fast behaviour every other org-scoped method already has,
    // without changing what org id is actually used when one is set.
    const resolvedOrgId = this.resolveOrgId();
    const availability = (options.available ?? true) ? "Operative" : "Inoperative";
    const json = await this.fetchJson({
      method: "POST",
      path:
        `/v2/apps/organisations/${resolvedOrgId}/charge-points/${options.chargePointId}` +
        "/commands/unlock-connector",
      json: {
        connectorId: options.connectorId ?? "0",
        changeAvailabilityType: availability,
      },
      timeoutMs: options.timeoutMs ?? 10_000,
    });
    return this.parse(commandResponseEnvelope, json).data;
  }

  /**
   * Set a load management profile for the charger, controlling its maximum
   * output. No retry decorator in Python — none is added here either.
   */
  async setChargerLoadProfile(
    options: SetChargerLoadProfileOptions,
  ): Promise<EvnexChargePointLoadSchedule> {
    // Re-validate (and strip to known fields) each segment, mirroring
    // Python's `pydantic.parse_obj_as(list[EvnexChargeProfileSegment], ...)`
    // step before it re-serialises the list into the request body.
    const chargingProfilePeriods = options.chargingProfilePeriods.map((segment) =>
      EvnexChargeProfileSegment.parse(segment),
    );
    const json = await this.fetchJson({
      method: "PUT",
      path: `/v2/apps/charge-points/${options.chargePointId}/load-management`,
      json: {
        chargingProfilePeriods,
        enabled: options.enabled ?? true,
        units: options.units ?? "A",
        duration: options.duration ?? 86_400,
      },
      timeoutMs: options.timeoutMs ?? 10_000,
    });
    return this.parse(loadScheduleEnvelope, json).data;
  }

  /**
   * Configure times a charge point will charge between. Defaults to a daily
   * period; segments are seconds from midnight, in the charger's configured
   * timezone. No retry decorator in Python — none is added here either.
   */
  async setChargePointSchedule(
    options: SetChargePointScheduleOptions,
  ): Promise<EvnexChargePointLoadSchedule> {
    const chargingProfilePeriods = options.chargingProfilePeriods.map((segment) =>
      EvnexChargeProfileSegment.parse(segment),
    );
    const json = await this.fetchJson({
      method: "PUT",
      path: `/v2/apps/charge-points/${options.chargePointId}/charge-schedule`,
      json: {
        chargingProfilePeriods,
        enabled: options.enabled ?? true,
        // No "units" or "timezone" — Python leaves both out (the latter is
        // commented out in the original source, per PLAN.md §10.1).
        duration: options.duration ?? 86_400,
      },
      timeoutMs: options.timeoutMs ?? 10_000,
    });
    return this.parse(loadScheduleEnvelope, json).data;
  }
}
