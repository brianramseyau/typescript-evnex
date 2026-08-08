/**
 * Organisation schemas — ported from `evnex/schema/org.py`.
 *
 * TODO(A3): implement/refine and add tests.
 */

import { z } from "zod";
import { EvnexCost } from "./cost.js";

export const EvnexOrgBrief = z.object({
  id: z.string(),
  isDefault: z.boolean(),
  role: z.number(),
  createdDate: z.coerce.date(),
  name: z.string(),
  slug: z.string(),
  tier: z.number(),
  tierDetails: z.unknown().nullish(),
  updatedDate: z.coerce.date(),
  namespacePrefix: z.string().nullish(),
});
export type EvnexOrgBrief = z.infer<typeof EvnexOrgBrief>;

export const EvnexOrgInsightEntry = z.object({
  carbonOffset: z.number(),
  carbonUsage: z.number().nullish(),
  cost: EvnexCost,
  duration: z.number(),
  // Watt-hours, like all energy figures in this API (the official app
  // and integrations render these via Wh sensors)
  powerUsage: z.number(),
  sessions: z.number(),
  startDate: z.coerce.date(),
});
export type EvnexOrgInsightEntry = z.infer<typeof EvnexOrgInsightEntry>;

export const EvnexInsightAttributeWrapper = z.object({
  attributes: EvnexOrgInsightEntry,
});
export type EvnexInsightAttributeWrapper = z.infer<typeof EvnexInsightAttributeWrapper>;

export const EvnexOrgSummaryStatus = z.object({
  charging: z.number(),
  available: z.number(),
  disabled: z.number(),
  faulted: z.number(),
  occupied: z.number(),
  offline: z.number(),
  reserved: z.number(),
});
export type EvnexOrgSummaryStatus = z.infer<typeof EvnexOrgSummaryStatus>;

export const EvnexGetOrgInsights = z.object({
  data: z.array(EvnexInsightAttributeWrapper),
});
export type EvnexGetOrgInsights = z.infer<typeof EvnexGetOrgInsights>;

export const EvnexGetOrgSummaryStatusResponse = z.object({
  data: EvnexOrgSummaryStatus,
});
export type EvnexGetOrgSummaryStatusResponse = z.infer<
  typeof EvnexGetOrgSummaryStatusResponse
>;
