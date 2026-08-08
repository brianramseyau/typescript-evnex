/**
 * v3 cost schemas — ported from `evnex/schema/v3/cost.py`.
 *
 */

import { z } from "zod";

export const EvnexElectricityTariff = z.object({
  start: z.number(),
  rate: z.number(),
  type: z.string(), // Flat
});
export type EvnexElectricityTariff = z.infer<typeof EvnexElectricityTariff>;

export const EvnexElectricityCost = z.object({
  currency: z.string(), // NZD
  tariffs: z.array(EvnexElectricityTariff),
  tariffType: z.string(),
  cost: z.number().nullish(),
});
export type EvnexElectricityCost = z.infer<typeof EvnexElectricityCost>;

export const EvnexElectricityCostTotal = z.object({
  currency: z.string(), // NZD
  amount: z.number(),
  distribution: z.unknown().nullish(),
});
export type EvnexElectricityCostTotal = z.infer<typeof EvnexElectricityCostTotal>;
