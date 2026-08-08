/**
 * Charge point schemas (v2 / flat envelope) — ported from
 * `evnex/schema/charge_points.py`.
 *
 * TODO(A3): implement/refine and add tests, including the `toJson()`
 * round-trip fixtures described in PLAN.md §2.6.
 */

import { z } from "zod";
import { EvnexCost } from "./cost.js";

export const ChargingLogic = z.enum([
  "Unavailable",
  "NoVehicle",
  "Vehicle",
  "Transfer",
  "Fault",
]);
export type ChargingLogic = z.infer<typeof ChargingLogic>;
export const ChargingLogicValues: Record<
  "UNAVAILABLE" | "NOVEHICLE" | "VEHICLE" | "TRANSFER" | "FAULT",
  ChargingLogic
> = {
  UNAVAILABLE: "Unavailable",
  NOVEHICLE: "NoVehicle",
  VEHICLE: "Vehicle",
  TRANSFER: "Transfer",
  FAULT: "Fault",
};

export const ChargingCurrentControl = z.enum([
  "FullPower",
  "ThermalLimited",
  "LLMLimited",
  "WaitingSchedule",
  "WaitingSolar",
  "SolarControl",
  "ScheduleLimited",
  "SupplyLimited",
]);
export type ChargingCurrentControl = z.infer<typeof ChargingCurrentControl>;
export const ChargingCurrentControlValues: Record<
  | "FULLPOWER"
  | "THERMALLIMITED"
  | "LLMLIMITED"
  | "WAITINGSCHEDULE"
  | "WAITINGSOLAR"
  | "SOLARCONTROL"
  | "SCHEDULELIMITED"
  | "SUPPLYLIMITED",
  ChargingCurrentControl
> = {
  FULLPOWER: "FullPower",
  THERMALLIMITED: "ThermalLimited",
  LLMLIMITED: "LLMLimited",
  WAITINGSCHEDULE: "WaitingSchedule",
  WAITINGSOLAR: "WaitingSolar",
  SOLARCONTROL: "SolarControl",
  SCHEDULELIMITED: "ScheduleLimited",
  SUPPLYLIMITED: "SupplyLimited",
};

export const E2LEDState = z.enum([
  "Off",
  "Idle",
  "Charging",
  "ChargeNowCharging",
  "ChargeNowNotCharging",
  "Fault",
  "Disabled",
  "WaitSchedule",
  "WaitSolar",
  "WaitVehicle",
  "ShuttingDown",
]);
export type E2LEDState = z.infer<typeof E2LEDState>;
export const E2LEDStateValues: Record<
  | "OFF"
  | "IDLE"
  | "CHARGING"
  | "CHARGENOWCHARGING"
  | "CHARGENOWNOTCHARGING"
  | "FAULT"
  | "DISABLED"
  | "WAITSCHEDULE"
  | "WAITSOLAR"
  | "WAITVEHICLE"
  | "SHUTTINGDOWN",
  E2LEDState
> = {
  OFF: "Off",
  IDLE: "Idle",
  CHARGING: "Charging",
  CHARGENOWCHARGING: "ChargeNowCharging",
  CHARGENOWNOTCHARGING: "ChargeNowNotCharging",
  FAULT: "Fault",
  DISABLED: "Disabled",
  WAITSCHEDULE: "WaitSchedule",
  WAITSOLAR: "WaitSolar",
  WAITVEHICLE: "WaitVehicle",
  SHUTTINGDOWN: "ShuttingDown",
};

export const AntiSleepState = z.enum(["Disabled", "Enabled", "Active", "NA"]);
export type AntiSleepState = z.infer<typeof AntiSleepState>;
export const AntiSleepStateValues: Record<
  "DISABLED" | "ENABLED" | "ACTIVE" | "NA",
  AntiSleepState
> = {
  DISABLED: "Disabled",
  ENABLED: "Enabled",
  ACTIVE: "Active",
  NA: "NA",
};

export const ChargePointStatus = z.object({
  chargeNow: z.boolean(),
  chargingLogic: ChargingLogic,
  chargingCurrentControl: ChargingCurrentControl,
  LEDState: E2LEDState,
  AntiSleep: AntiSleepState,
});
export type ChargePointStatus = z.infer<typeof ChargePointStatus>;

// register (wire) -> rawRegister, per PLAN.md §2.1 — inherited from Python's
// own `Field(..., alias="register")` rename (raw_register). Preserve it, do
// not silently drop the rename back to `register`.
export const EvnexChargePointConnectorMeter = z
  .object({
    powerType: z.string(), // "AC_1_PHASE"
    updatedDate: z.coerce.date(),
    power: z.number(),
    register: z.number(),
    frequency: z.number(),
  })
  .transform(({ register, ...rest }) => ({ ...rest, rawRegister: register }));
export type EvnexChargePointConnectorMeter = z.infer<
  typeof EvnexChargePointConnectorMeter
>;

export const Coordinates = z.object({
  latitude: z.number(),
  longitude: z.number(),
});
export type Coordinates = z.infer<typeof Coordinates>;

export const EvnexAddress = z.object({
  address1: z.string(),
  address2: z.string().nullish(),
  address3: z.string().nullish(),
  city: z.string().nullish(),
  postCode: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string(),
});
export type EvnexAddress = z.infer<typeof EvnexAddress>;

export const EvnexLocation = z.object({
  id: z.string(),
  name: z.string(),
  createdDate: z.coerce.date(),
  updatedDate: z.coerce.date(),
  address: EvnexAddress.nullish(),
  coordinates: Coordinates.nullish(),
  chargePointCount: z.number(),
});
export type EvnexLocation = z.infer<typeof EvnexLocation>;

export const EvnexChargePointConnector = z.object({
  powerType: z.string(), // AC_1_PHASE
  connectorId: z.string(),
  evseId: z.string(),
  updatedDate: z.coerce.date(),
  connectorType: z.string(),
  amperage: z.number(),
  voltage: z.number(),
  connectorFormat: z.string(),
  ocppStatus: z.string(),
  status: z.string(), // OCCUPIED, CHARGING
  ocppCode: z.string(), // CHARGING
  meter: EvnexChargePointConnectorMeter.nullish(),
});
export type EvnexChargePointConnector = z.infer<typeof EvnexChargePointConnector>;

export const EvnexChargePointDetails = z.object({
  model: z.string(),
  vendor: z.string(),
  firmware: z.string(),
  iccid: z.string().nullish(),
});
export type EvnexChargePointDetails = z.infer<typeof EvnexChargePointDetails>;

export const EvnexChargePointSolarConfig = z.object({
  solarWithSchedule: z.boolean(),
  powerSensorInstalled: z.boolean(),
  solarStartExportPower: z.number(),
  solarStopImportPower: z.number(),
});
export type EvnexChargePointSolarConfig = z.infer<typeof EvnexChargePointSolarConfig>;

export const EvnexChargePointOverrideConfig = z.object({
  chargeNow: z.union([z.boolean(), z.literal("NotSupported")]),
});
export type EvnexChargePointOverrideConfig = z.infer<
  typeof EvnexChargePointOverrideConfig
>;

export const EvnexChargePointStatus = z.object({
  commandResultStatus: z.string(),
  chargePointStatus: ChargePointStatus.nullish(),
});
export type EvnexChargePointStatus = z.infer<typeof EvnexChargePointStatus>;

export const EvnexChargePointStatusResponse = z.object({
  data: EvnexChargePointStatus,
});
export type EvnexChargePointStatusResponse = z.infer<
  typeof EvnexChargePointStatusResponse
>;

export const EvnexChargePointEnergyMeterReading = z.object({
  timestamp: z.coerce.date(),
  chargingActivePower: z.number(),
  supplyActivePower: z.number(),
});
export type EvnexChargePointEnergyMeterReading = z.infer<
  typeof EvnexChargePointEnergyMeterReading
>;

export const EvnexChargePointEnergyMeterReadingResponse = z.object({
  data: EvnexChargePointEnergyMeterReading,
  status: z.string(),
});
export type EvnexChargePointEnergyMeterReadingResponse = z.infer<
  typeof EvnexChargePointEnergyMeterReadingResponse
>;

// Attributes shared by brief and detail endpoints
export const EvnexChargePointBase = z.object({
  id: z.string(),
  createdDate: z.coerce.date(),
  updatedDate: z.coerce.date(),
  networkStatusUpdatedDate: z.coerce.date(),
  name: z.string(),
  ocppChargePointId: z.string(),
  serial: z.string(),
  networkStatus: z.string(), // Could probably be an enum ONLINE
  location: EvnexLocation,
});
export type EvnexChargePointBase = z.infer<typeof EvnexChargePointBase>;

export const EvnexChargePoint = EvnexChargePointBase.extend({
  details: EvnexChargePointDetails,
  connectors: z.array(EvnexChargePointConnector).nullish(),
  lastHeard: z.coerce.date().nullish(),
  maxCurrent: z.number(),
  tokenRequired: z.boolean(),
  needsRegistrationInformation: z.boolean(),
});
export type EvnexChargePoint = z.infer<typeof EvnexChargePoint>;

export const EvnexGetChargePointsItem = z.object({
  items: z.array(EvnexChargePoint),
});
export type EvnexGetChargePointsItem = z.infer<typeof EvnexGetChargePointsItem>;

export const EvnexGetChargePointsResponse = z.object({
  data: EvnexGetChargePointsItem,
});
export type EvnexGetChargePointsResponse = z.infer<typeof EvnexGetChargePointsResponse>;

export const EvnexElectricityCostSegment = z.object({
  cost: z.number(),
  start: z.number(),
});
export type EvnexElectricityCostSegment = z.infer<typeof EvnexElectricityCostSegment>;

export const EvnexChargeProfileSegment = z.object({
  limit: z.number(),
  start: z.number(),
});
export type EvnexChargeProfileSegment = z.infer<typeof EvnexChargeProfileSegment>;

export const EvnexElectricityCost = z.object({
  currency: z.string(),
  duration: z.number().nullish(),
  costs: z.array(EvnexElectricityCostSegment),
});
export type EvnexElectricityCost = z.infer<typeof EvnexElectricityCost>;

export const EvnexChargePointConfiguration = z.object({
  maxCurrent: z.number(),
  plugAndCharge: z.boolean(),
});
export type EvnexChargePointConfiguration = z.infer<
  typeof EvnexChargePointConfiguration
>;

export const EvnexChargePointLoadSchedule = z.object({
  duration: z.number(),
  enabled: z.boolean(),
  // Deliberate divergence from python-evnex, which marks this required with
  // no default: the live API does not send it, so pydantic raises
  // ValidationError on every response carrying a load schedule. See
  // PLAN.md §10.1 — do NOT "restore parity" by making this required again.
  timezone: z.string().nullish(),
  units: z.string(),
  chargingProfilePeriods: z.array(EvnexChargeProfileSegment),
});
export type EvnexChargePointLoadSchedule = z.infer<typeof EvnexChargePointLoadSchedule>;

export const EvnexChargePointDetail = EvnexChargePointBase.extend({
  configuration: EvnexChargePointConfiguration,
  electricityCost: EvnexElectricityCost,
  loadSchedule: EvnexChargePointLoadSchedule,
  connectors: z.array(EvnexChargePointConnector),
});
export type EvnexChargePointDetail = z.infer<typeof EvnexChargePointDetail>;

export const EvnexGetChargePointDetailResponse = z.object({
  data: EvnexChargePointDetail,
});
export type EvnexGetChargePointDetailResponse = z.infer<
  typeof EvnexGetChargePointDetailResponse
>;

export const EvnexChargePointTransaction = z.object({
  id: z.string(),
  connectorId: z.string(),
  endDate: z.coerce.date().nullish(),
  evseId: z.string(),
  powerUsage: z.number(),
  reason: z.string().nullish(), // EVDisconnected, Other
  startDate: z.coerce.date(),
  carbonOffset: z.number().nullish(),
  electricityCost: EvnexCost.nullish(),
});
export type EvnexChargePointTransaction = z.infer<typeof EvnexChargePointTransaction>;

export const EvnexChargePointTransactions = z.object({
  items: z.array(EvnexChargePointTransaction),
});
export type EvnexChargePointTransactions = z.infer<typeof EvnexChargePointTransactions>;

export const EvnexGetChargePointTransactionsResponse = z.object({
  data: EvnexChargePointTransactions,
});
export type EvnexGetChargePointTransactionsResponse = z.infer<
  typeof EvnexGetChargePointTransactionsResponse
>;
