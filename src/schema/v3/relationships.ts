/**
 * JSON:API relationship schemas — ported from `evnex/schema/v3/relationships.py`.
 *
 */

import { z } from "zod";

export const EvnexRelationship = z.object({
  id: z.string(),
  type: z.string(),
});
export type EvnexRelationship = z.infer<typeof EvnexRelationship>;

export const EvnexRelationshipWrapper = z.object({
  data: EvnexRelationship.nullish(),
});
export type EvnexRelationshipWrapper = z.infer<typeof EvnexRelationshipWrapper>;

export const EvnexRelationships = z.object({
  chargePoint: EvnexRelationshipWrapper.nullish(),
  location: EvnexRelationshipWrapper.nullish(),
  organisation: EvnexRelationshipWrapper.nullish(),
});
export type EvnexRelationships = z.infer<typeof EvnexRelationships>;
