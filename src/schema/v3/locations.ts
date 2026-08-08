/**
 * v3 location schemas — ported from `evnex/schema/v3/locations.py`.
 *
 */

import { z } from "zod";

export const EvnexLocationAddress = z.object({
  address1: z.string().nullish(),
  address2: z.string().nullish(),
  city: z.string().nullish(),
  postCode: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
});
export type EvnexLocationAddress = z.infer<typeof EvnexLocationAddress>;

export const EvnexLocationCoordinates = z.object({
  latitude: z.string().nullish(),
  longitude: z.string().nullish(),
});
export type EvnexLocationCoordinates = z.infer<typeof EvnexLocationCoordinates>;

export const EvnexLocationIcpDetails = z.object({
  electricityRetailer: z.string().nullish(),
  electricityDistributor: z.string().nullish(),
  networkConnectionPoint: z.string().nullish(),
});
export type EvnexLocationIcpDetails = z.infer<typeof EvnexLocationIcpDetails>;

export const EvnexLocationAttributes = z.object({
  name: z.string(),
  address: EvnexLocationAddress.nullish(),
  coordinates: EvnexLocationCoordinates.nullish(),
  isPublic: z.boolean().nullish(),
  updated: z.coerce.date().nullish(),
  created: z.coerce.date().nullish(),
  icpNumber: z.string().nullish(),
  icpDetails: EvnexLocationIcpDetails.nullish(),
  timeZone: z.string().nullish(),
});
export type EvnexLocationAttributes = z.infer<typeof EvnexLocationAttributes>;

export const EvnexLocationChargePointRef = z.object({
  type: z.string(),
  id: z.string(),
});
export type EvnexLocationChargePointRef = z.infer<typeof EvnexLocationChargePointRef>;

export const EvnexLocationChargePoints = z.object({
  data: z.array(EvnexLocationChargePointRef).default([]),
});
export type EvnexLocationChargePoints = z.infer<typeof EvnexLocationChargePoints>;

export const EvnexLocationRelationships = z.object({
  chargePoints: EvnexLocationChargePoints.default({ data: [] }),
});
export type EvnexLocationRelationships = z.infer<typeof EvnexLocationRelationships>;

export const EvnexLocation = z.object({
  id: z.string(),
  type: z.string(),
  attributes: EvnexLocationAttributes,
  relationships: EvnexLocationRelationships.default({ chargePoints: { data: [] } }),
});
export type EvnexLocation = z.infer<typeof EvnexLocation>;

export const EvnexGetLocationsResponse = z.object({
  data: z.array(EvnexLocation),
});
export type EvnexGetLocationsResponse = z.infer<typeof EvnexGetLocationsResponse>;
