/**
 * Charge point schemas (v3 / JSON:API envelope) — ported from
 * `evnex/schema/v3/charge_points.py`.
 *
 * TODO(A4): implement/refine and add tests, including
 * `test_connector_meter_exposes_supply_active_power` and
 * `test_connector_meter_without_power_sensor` analogues.
 */

import { z } from "zod";
import { EvnexElectricityCost, EvnexElectricityCostTotal } from "./cost.js";
import { EvnexRelationships } from "./relationships.js";

export const EvnexEnergyTransaction = z.object({
  meterStart: z.number(),
  startDate: z.coerce.date(),
  meterStop: z.number().nullish(),
  endDate: z.coerce.date().nullish(),
  reason: z.string().nullish(),
});
export type EvnexEnergyTransaction = z.infer<typeof EvnexEnergyTransaction>;

export const EvnexEnergyUsage = z.object({
  total: z.number(),
  distributionByTariff: z.unknown().nullish(),
  distributionByEnergySource: z.unknown().nullish(),
});
export type EvnexEnergyUsage = z.infer<typeof EvnexEnergyUsage>;

export const EvnexChargeSchedulePeriod = z.object({
  limit: z.number(),
  startPeriod: z.number(),
});
export type EvnexChargeSchedulePeriod = z.infer<typeof EvnexChargeSchedulePeriod>;

export const EvnexChargeSchedule = z.object({
  enabled: z.boolean(),
  chargingSchedulePeriods: z.array(EvnexChargeSchedulePeriod),
});
export type EvnexChargeSchedule = z.infer<typeof EvnexChargeSchedule>;

export const EvnexChargeProfile = z.object({
  chargeSchedule: EvnexChargeSchedule.nullish(),
});
export type EvnexChargeProfile = z.infer<typeof EvnexChargeProfile>;

export const EvnexChargePointFeature = z.object({
  unlocked: z.boolean(),
});
export type EvnexChargePointFeature = z.infer<typeof EvnexChargePointFeature>;

export const EvnexChargePointFeatures = z.object({
  PowerSensor: EvnexChargePointFeature,
  Solar: EvnexChargePointFeature,
  VehicleIntegration: EvnexChargePointFeature,
});
export type EvnexChargePointFeatures = z.infer<typeof EvnexChargePointFeatures>;

// register (wire) -> rawRegister, same rename as the v2 connector meter
// (PLAN.md §2.1). supplyActivePower is only present when a power sensor is
// installed (features.PowerSensor.unlocked) — the CLI's grid-power display
// depends on distinguishing "absent" from "zero".
export const EvnexChargePointConnectorMeter = z
  .object({
    currentL1: z.number().nullish(),
    currentL2: z.number().nullish(),
    currentL3: z.number().nullish(),
    frequency: z.number(),
    power: z.number(),
    register: z.number(),
    supplyActivePower: z.number().nullish(),
    updatedDate: z.coerce.date(),
    temperature: z.number().nullish(),
    voltageL1N: z.number().nullish(),
    voltageL2N: z.number().nullish(),
    voltageL3N: z.number().nullish(),
  })
  .transform(({ register, ...rest }) => ({ ...rest, rawRegister: register }));
export type EvnexChargePointConnectorMeter = z.infer<
  typeof EvnexChargePointConnectorMeter
>;

export const EvnexChargePointConnector = z.object({
  evseId: z.string(),
  connectorFormat: z.string(), // CABLE
  connectorType: z.string(),
  ocppStatus: z.string(),
  powerType: z.string(), // AC_1_PHASE
  connectorId: z.string(),
  ocppCode: z.string(), // CHARGING
  updatedDate: z.coerce.date(),
  meter: EvnexChargePointConnectorMeter.nullish(),
  maxVoltage: z.number(),
  maxAmperage: z.number(),
});
export type EvnexChargePointConnector = z.infer<typeof EvnexChargePointConnector>;

export const EvnexChargePointConnectionConfiguration = z.object({
  automaticallyManaged: z.boolean(),
  preferredConnectionType: z.string(), // Cell
  updatedDate: z.coerce.date(),
  wifiConnected: z.boolean(),
});
export type EvnexChargePointConnectionConfiguration = z.infer<
  typeof EvnexChargePointConnectionConfiguration
>;

export const EvnexChargePointDetail = z.object({
  connectors: z.array(EvnexChargePointConnector),
  createdDate: z.coerce.date(),
  electricityCost: EvnexElectricityCost,
  firmware: z.string(),
  maxCurrent: z.number(),
  model: z.string(),
  name: z.string(),
  networkStatus: z.string(),
  networkStatusUpdatedDate: z.coerce.date(),
  ocppChargePointId: z.string(),
  profiles: EvnexChargeProfile,
  serial: z.string(),
  /**
   * The authoritative IANA timezone (e.g. "Pacific/Auckland"). Only present
   * on this v3 detail endpoint — the charge-points list endpoint carries no
   * `timeZone` at all, so a consumer that needs one must fetch the detail
   * per charge point (PLAN.md §10.2).
   */
  timeZone: z.string(),
  tokenRequired: z.boolean(),
  updatedDate: z.coerce.date(),
  vendor: z.string(),
  connectionConfiguration: EvnexChargePointConnectionConfiguration.nullish(),
  features: EvnexChargePointFeatures.nullish(),
  iccid: z.string().nullish(),
  isSolarEnabled: z.boolean().nullish(),
});
export type EvnexChargePointDetail = z.infer<typeof EvnexChargePointDetail>;

/**
 * Observed values of `sessionStatus`, for narrowing — the parsed type stays
 * `string` (an unobserved value must not throw). Test for a terminal state
 * with `=== "Invalid"`, never `!== "Completed"`: a status-less session is
 * common and must not be treated as invalid (PLAN.md §10.4).
 */
export const OBSERVED_SESSION_STATUSES = [
  "Pending",
  "Authorized",
  "Active",
  "Closed",
  "Completed",
  "Invalid",
] as const;

export const EvnexChargePointSessionAttributes = z.object({
  totalCarbonUsage: z.number().nullish(),
  chargingStarted: z.coerce.date().nullish(),
  chargingStopped: z.coerce.date().nullish(),
  connectorId: z.string().nullish(),
  createdDate: z.coerce.date().nullish(),
  evseId: z.string().nullish(),
  sessionStatus: z.string().nullish(),
  startDate: z.coerce.date().nullish(),
  updatedDate: z.coerce.date().nullish(),
  authorizationMethod: z.string().nullish(),
  electricityCost: EvnexElectricityCost.nullish(),
  endDate: z.coerce.date().nullish(),
  totalChargingTime: z.number().nullish(),
  totalDuration: z.number().nullish(),
  totalEnergyUsage: EvnexEnergyUsage.nullish(),
  totalCost: EvnexElectricityCostTotal.nullish(),
  totalPowerUsage: z.number().nullish(),
  transaction: EvnexEnergyTransaction.nullish(),
});
export type EvnexChargePointSessionAttributes = z.infer<
  typeof EvnexChargePointSessionAttributes
>;

export const EvnexChargePointSession = z.object({
  attributes: EvnexChargePointSessionAttributes,
  id: z.string(),
  type: z.string(),
  relationships: EvnexRelationships.nullish(),
});
export type EvnexChargePointSession = z.infer<typeof EvnexChargePointSession>;

export const EvnexGetChargePointSessionsResponse = z.object({
  data: z.array(EvnexChargePointSession),
});
export type EvnexGetChargePointSessionsResponse = z.infer<
  typeof EvnexGetChargePointSessionsResponse
>;

/**
 * Session energy in watt-hours from the meter delta — the authoritative
 * figure (PLAN.md §10.3). `null` while charging is still in progress (no
 * `meterStop` yet), or when the session carries no `transaction` at all.
 *
 * Deliberately tests for field *presence*, never truthiness: `meterStart: 0`
 * is a legitimate register reading, not an absent one.
 *
 * TODO(A4): implement.
 */
export function sessionEnergyWh(session: EvnexChargePointSession): number | null {
  throw new Error("TODO(A4)");
}
