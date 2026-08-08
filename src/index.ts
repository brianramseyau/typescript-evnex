/**
 * Public surface of the `evnex` package — ported from `evnex/__init__.py`.
 *
 * `import { Evnex } from "evnex"` gets you the API client and every response
 * type; `import { EvnexAuth } from "evnex/auth"` (see `./auth/index.ts`) gets
 * you authentication. This is a real barrel of re-exports, not a stub.
 *
 * Where python-evnex's v2 (flat envelope) and v3 (JSON:API envelope)
 * schemas declare a same-named model for genuinely different shapes (e.g.
 * both `evnex.schema.charge_points` and `evnex.schema.v3.locations` define
 * `EvnexLocation`), the v3 name wins unqualified — it is what the current
 * (non-deprecated) API methods return — and the v2 one is exported under a
 * disambiguating name. `api.ts` (B3) applies the same `...V3` convention
 * internally for its own imports; this barrel mirrors it.
 */

export {
  Evnex,
  type ChargerAvailabilityTarget,
  type EvnexOptions,
  type GetOrgInsightOptions,
  type SetChargePointOverrideOptions,
  type SetChargerAvailabilityOptions,
  type SetChargerLoadProfileOptions,
  type SetChargePointScheduleOptions,
  type StopChargePointOptions,
  type UnlockChargerOptions,
} from "./api.js";

export { EvnexConfig, type EvnexConfigOptions } from "./config.js";

export {
  EvnexError,
  EvnexAuthError,
  InvalidCredentialsError,
  ReauthenticationRequiredError,
  ChallengeExpiredError,
  PasswordChangeRequiredError,
  InvalidChallengeResponseError,
  EvnexConfigurationError,
  EvnexValidationError,
} from "./errors.js";

export {
  EvnexHttpError,
  EvnexTimeoutError,
  type EvnexHttpErrorOptions,
} from "./http/errors.js";

export {
  DeviceStatus,
  DeviceStatusValues,
  ConnectorOcppStatus,
} from "./status.js";

export { parseModel, type EvnexModelInfo } from "./models.js";

export { toJson } from "./schema/json.js";

// -- v2 (flat envelope) schemas -------------------------------------------

export {
  ChargingLogic,
  ChargingCurrentControl,
  E2LEDState,
  AntiSleepState,
  ChargePointStatus,
  EvnexChargePointConnectorMeter,
  Coordinates,
  EvnexAddress,
  EvnexLocation as EvnexChargePointLocation,
  EvnexChargePointConnector,
  EvnexChargePointDetails,
  EvnexChargePointSolarConfig,
  EvnexChargePointOverrideConfig,
  EvnexChargePointStatusResponse,
  EvnexChargePointEnergyMeterReading,
  EvnexChargePointEnergyMeterReadingResponse,
  EvnexChargePointBase,
  EvnexChargePoint,
  EvnexElectricityCostSegment,
  EvnexChargeProfileSegment,
  EvnexElectricityCost as EvnexElectricityCostBrief,
  EvnexChargePointConfiguration,
  EvnexChargePointLoadSchedule,
  EvnexChargePointDetail,
  EvnexChargePointTransaction,
} from "./schema/chargePoints.js";

export { EvnexCost } from "./schema/cost.js";
export { EvnexCommandResponse } from "./schema/commands.js";
export { EvnexUserDetail } from "./schema/user.js";
export {
  EvnexOrgBrief,
  EvnexOrgInsightEntry,
  EvnexOrgSummaryStatus,
} from "./schema/org.js";

// -- v3 (JSON:API envelope) schemas ---------------------------------------

export {
  evnexV3ApiResponse,
  EvnexV3Include,
  type EvnexV3APIResponse,
} from "./schema/v3/generic.js";
export {
  EvnexRelationship,
  EvnexRelationshipWrapper,
  EvnexRelationships,
} from "./schema/v3/relationships.js";
export {
  EvnexElectricityTariff,
  EvnexElectricityCost as EvnexElectricityCostV3,
  EvnexElectricityCostTotal,
} from "./schema/v3/cost.js";
export {
  EvnexEnergyTransaction,
  EvnexEnergyUsage,
  EvnexChargeSchedulePeriod,
  EvnexChargeSchedule,
  EvnexChargeProfile,
  EvnexChargePointFeature,
  EvnexChargePointFeatures,
  EvnexChargePointConnectorMeter as EvnexChargePointConnectorMeterV3,
  EvnexChargePointConnector as EvnexChargePointConnectorV3,
  EvnexChargePointConnectionConfiguration,
  EvnexChargePointDetail as EvnexChargePointDetailV3,
  OBSERVED_SESSION_STATUSES,
  EvnexChargePointSessionAttributes,
  EvnexChargePointSession,
  sessionEnergyWh,
} from "./schema/v3/chargePoints.js";
export { EvnexLocation } from "./schema/v3/locations.js";
export { EvnexOrgConnectorSummaryAttributes } from "./schema/v3/org.js";
export { EvnexCommandResponse as EvnexCommandResponseV3 } from "./schema/v3/commands.js";
