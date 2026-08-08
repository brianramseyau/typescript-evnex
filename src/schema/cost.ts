/**
 * Cost schema — ported from `evnex/schema/cost.py`.
 *
 * TODO(A3): implement (`.parse()` should already work correctly against the
 * shape below; add tests, transforms, and refinements as needed).
 */

import { z } from "zod";

export const EvnexCost = z.object({
  currency: z.string().nullish(),
  cost: z.number().nullish(),
});
export type EvnexCost = z.infer<typeof EvnexCost>;
