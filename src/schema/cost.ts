/**
 * Cost schema — ported from `evnex/schema/cost.py`.
 */

import { z } from "zod";

export const EvnexCost = z.object({
  currency: z.string().nullish(),
  cost: z.number().nullish(),
});
export type EvnexCost = z.infer<typeof EvnexCost>;
