/**
 * User schema — ported from `evnex/schema/user.py`.
 *
 * TODO(A3): implement/refine and add tests. A user payload with no `name`
 * must validate (mirrors `test_user_without_name_validates`) — the API omits
 * the field entirely for accounts that never set one.
 */

import { z } from "zod";
import { EvnexOrgBrief } from "./org.js";

export const EvnexUserDetail = z.object({
  id: z.uuid(),
  createdDate: z.coerce.date(),
  updatedDate: z.coerce.date(),
  // The API omits name entirely for accounts that never set one
  name: z.string().nullish(),
  email: z.string(),
  organisations: z.array(EvnexOrgBrief),
  type: z.enum(["User", "Installer"]).default("User"),
});
export type EvnexUserDetail = z.infer<typeof EvnexUserDetail>;

export const EvnexGetUserResponse = z.object({
  data: EvnexUserDetail,
});
export type EvnexGetUserResponse = z.infer<typeof EvnexGetUserResponse>;
