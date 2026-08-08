/**
 * The EVNEX API client — ported from `evnex/api.py`'s `Evnex` class (all 20
 * methods, including the deprecated v2 pair). PLAN.md §5 B3.
 *
 * TODO(B3): implement, composing A8's `Transport` / `withAuthFlow` /
 * `withRetry` and validating every response with its schema from
 * `./schema/**`. Port the retry policy of PLAN.md §2.5's table exactly, per
 * method — including the methods that carry **no** retry decorator at all
 * (`setChargerAvailability`, `unlockCharger`, `setChargerLoadProfile`,
 * `setChargePointSchedule`).
 */

import type { EvnexAuth } from "./auth/index.js";
import type { EvnexConfig } from "./config.js";
import type { FetchLike } from "./http/transport.js";
import type { EvnexCommandResponse } from "./schema/commands.js";
import type { EvnexOrgInsightEntry, EvnexOrgSummaryStatus } from "./schema/org.js";
import type {
  EvnexChargePoint,
  EvnexChargePointDetail,
  EvnexChargePointEnergyMeterReadingResponse,
  EvnexChargePointLoadSchedule,
  EvnexChargePointOverrideConfig,
  EvnexChargePointSolarConfig,
  EvnexChargePointStatusResponse,
  EvnexChargePointTransaction,
  EvnexChargeProfileSegment,
} from "./schema/chargePoints.js";
import type {
  EvnexChargePointDetail as EvnexChargePointDetailV3,
  EvnexChargePointSession,
} from "./schema/v3/chargePoints.js";
import type { EvnexCommandResponse as EvnexCommandResponseV3 } from "./schema/v3/commands.js";
import type { EvnexV3APIResponse } from "./schema/v3/generic.js";
import type { EvnexLocation } from "./schema/v3/locations.js";
import type { EvnexUserDetail } from "./schema/user.js";

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

export class Evnex {
  /** The org id resolved so far — set explicitly, from config, or by `getUserDetail`. */
  orgId: string | undefined;
  /** The installed package version, sent as part of the `User-Agent` header. */
  readonly version!: string;

  constructor(options: EvnexOptions) {
    throw new Error("TODO(B3)");
  }

  /** Close the underlying transport. Safe to call more than once. */
  async close(): Promise<void> {
    throw new Error("TODO(B3)");
  }

  async getUserDetail(): Promise<EvnexUserDetail> {
    throw new Error("TODO(B3)");
  }

  async getOrgChargePoints(orgId?: string): Promise<EvnexChargePoint[]> {
    throw new Error("TODO(B3)");
  }

  async getOrgInsight(options: GetOrgInsightOptions): Promise<EvnexOrgInsightEntry[]> {
    throw new Error("TODO(B3)");
  }

  async getOrgSummaryStatus(orgId?: string): Promise<EvnexOrgSummaryStatus> {
    throw new Error("TODO(B3)");
  }

  async getOrgLocations(orgId?: string): Promise<EvnexLocation[]> {
    throw new Error("TODO(B3)");
  }

  /**
   * Per-status connector counts across the organisation. Wraps a newer
   * endpoint than `getOrgSummaryStatus`; the two report the same counts
   * through different response shapes and coexist so callers of either keep
   * working.
   */
  async getOrgConnectorSummary(orgId?: string): Promise<EvnexOrgSummaryStatus> {
    throw new Error("TODO(B3)");
  }

  /** @deprecated use {@link getChargePointDetailV3} */
  async getChargePointDetail(chargePointId: string): Promise<EvnexChargePointDetail> {
    throw new Error("TODO(B3)");
  }

  async getChargePointDetailV3(
    chargePointId: string,
  ): Promise<EvnexV3APIResponse<EvnexChargePointDetailV3>> {
    throw new Error("TODO(B3)");
  }

  /** @throws {import("./http/errors.js").EvnexTimeoutError} the charge point is offline */
  async getChargePointSolarConfig(
    chargePointId: string,
  ): Promise<EvnexChargePointSolarConfig> {
    throw new Error("TODO(B3)");
  }

  /** @throws {import("./http/errors.js").EvnexTimeoutError} the charge point is offline */
  async getChargePointOverride(
    chargePointId: string,
  ): Promise<EvnexChargePointOverrideConfig> {
    throw new Error("TODO(B3)");
  }

  /**
   * A `EvnexTimeoutError` means the charge point did not acknowledge the
   * command in time (typically offline or not responding); fails fast
   * rather than retrying, which only prolongs the hang and could resubmit
   * the command. Matches `stopChargePoint`'s policy for the same reason.
   */
  async setChargePointOverride(options: SetChargePointOverrideOptions): Promise<boolean> {
    throw new Error("TODO(B3)");
  }

  /** @throws {import("./http/errors.js").EvnexTimeoutError} the charge point is offline */
  async getChargePointStatus(
    chargePointId: string,
  ): Promise<EvnexChargePointStatusResponse> {
    throw new Error("TODO(B3)");
  }

  /** @throws {import("./http/errors.js").EvnexTimeoutError} the charge point is offline */
  async getChargePointEnergyMeterReading(
    chargePointId: string,
  ): Promise<EvnexChargePointEnergyMeterReadingResponse> {
    throw new Error("TODO(B3)");
  }

  /** @deprecated use {@link getChargePointSessions} */
  async getChargePointTransactions(
    chargePointId: string,
  ): Promise<EvnexChargePointTransaction[]> {
    throw new Error("TODO(B3)");
  }

  async getChargePointSessions(chargePointId: string): Promise<EvnexChargePointSession[]> {
    throw new Error("TODO(B3)");
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
    throw new Error("TODO(B3)");
  }

  async enableCharger(options: ChargerAvailabilityTarget): Promise<void> {
    throw new Error("TODO(B3)");
  }

  async disableCharger(options: ChargerAvailabilityTarget): Promise<void> {
    throw new Error("TODO(B3)");
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
    throw new Error("TODO(B3)");
  }

  /**
   * Tell the charger to try to retract the connector-locking pin (socketed
   * chargers only). Some sockets have no sensor for this and always report
   * success whether or not it actually worked. Also re-enables a disabled
   * charger. No retry decorator in Python — none is added here either.
   */
  async unlockCharger(options: UnlockChargerOptions): Promise<EvnexCommandResponse> {
    throw new Error("TODO(B3)");
  }

  /**
   * Set a load management profile for the charger, controlling its maximum
   * output. No retry decorator in Python — none is added here either.
   */
  async setChargerLoadProfile(
    options: SetChargerLoadProfileOptions,
  ): Promise<EvnexChargePointLoadSchedule> {
    throw new Error("TODO(B3)");
  }

  /**
   * Configure times a charge point will charge between. Defaults to a daily
   * period; segments are seconds from midnight, in the charger's configured
   * timezone. No retry decorator in Python — none is added here either.
   */
  async setChargePointSchedule(
    options: SetChargePointScheduleOptions,
  ): Promise<EvnexChargePointLoadSchedule> {
    throw new Error("TODO(B3)");
  }
}
