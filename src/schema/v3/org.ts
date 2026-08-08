/**
 * v3 organisation connector summary — ported from `evnex/schema/v3/org.py`.
 *
 * TODO(A4): implement/refine and add tests.
 */

import { z } from "zod";
import { EvnexOrgSummaryStatus } from "../org.js";

export const EvnexOrgConnectorSummaryAttributes = z.object({
  // Same per-status connector counts as the flat EvnexOrgSummaryStatus, just
  // nested one level deeper in this endpoint's JSON:API-style response.
  connectors: EvnexOrgSummaryStatus,
});
export type EvnexOrgConnectorSummaryAttributes = z.infer<
  typeof EvnexOrgConnectorSummaryAttributes
>;

export const EvnexOrgConnectorSummaryData = z.object({
  attributes: EvnexOrgConnectorSummaryAttributes,
});
export type EvnexOrgConnectorSummaryData = z.infer<typeof EvnexOrgConnectorSummaryData>;

export const EvnexGetOrgConnectorSummaryResponse = z.object({
  data: EvnexOrgConnectorSummaryData,
});
export type EvnexGetOrgConnectorSummaryResponse = z.infer<
  typeof EvnexGetOrgConnectorSummaryResponse
>;
