/**
 * v3 cost schemas — ported from `evnex/schema/v3/cost.py`.
 *
 */

import { z } from "zod";

// Live-verified (D5 schema sweep, docs/schema-sweep.md): the wire sends
// `rate` and `amount` as numeric strings ("0.3", "21.9396"), not numbers —
// z.coerce.number() so callers (e.g. the CLI's `.toFixed(2)` display) keep
// getting an actual number, rather than pushing the string/number question
// onto every consumer.
export const EvnexElectricityTariff = z.object({
  start: z.number(),
  rate: z.coerce.number(),
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
  amount: z.coerce.number(),
  distribution: z.unknown().nullish(),
});
export type EvnexElectricityCostTotal = z.infer<typeof EvnexElectricityCostTotal>;
