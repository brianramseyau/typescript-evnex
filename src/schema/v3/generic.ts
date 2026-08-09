/**
 * Generic JSON:API envelope — ported from `evnex/schema/v3/generic.py`.
 *
 * `EvnexV3APIResponse[T]` becomes a factory function, per PLAN.md §5 (A4):
 * pydantic's `Generic[T]` has no direct Zod equivalent, so the envelope is
 * parameterised by constructing a fresh schema per attributes type.
 */

import { z } from "zod";
import { EvnexRelationships } from "./relationships.js";

export const EvnexV3Include = z.object({
  id: z.string(),
  type: z.string(),
  attributes: z.record(z.string(), z.unknown()),
});
export type EvnexV3Include = z.infer<typeof EvnexV3Include>;

/**
 * Factory for the generic `EvnexV3APIResponse[T]` / `EvnexV3Data[T]` envelope.
 *
 * `included` is `.nullish()` here (absent, `null`, or an array all parse):
 * Python's `included: list[EvnexV3Include] | None` carries no `= None`
 * default, which under pydantic v2 semantics makes the *key* required
 * (nullable, but must be present) — so this schema is strictly more
 * permissive than upstream on that one field. Both captured fixtures carry
 * the key, but both descend from python-evnex's own test suite rather than
 * from live traffic, so they corroborate the Python model rather than
 * independently confirming it; nothing here has yet been checked against a
 * real response. Erring permissive matches this project's general policy of
 * never using `.strict()` against an API that adds fields without warning — but
 * unlike the `timezone` divergence in `EvnexChargePointLoadSchedule`, this
 * one was not a deliberate call by whoever wrote this factory; it was not
 * caught until a later parity audit (see `PARITY.md`'s "Defects found but
 * not fixed" #1). Left as `.nullish()` rather than tightened to
 * `.nullable()`, since tightening is a behaviour change outside this file's
 * remit.
 */
export const evnexV3ApiResponse = <T extends z.ZodTypeAny>(attributes: T) =>
  z.object({
    data: z.object({
      id: z.string(),
      type: z.string(),
      attributes,
      relationships: EvnexRelationships,
    }),
    included: z.array(EvnexV3Include).nullish(),
  });

/** The parsed shape `evnexV3ApiResponse(schemaFor<T>())` produces. */
export type EvnexV3APIResponse<T> = ReturnType<
  typeof evnexV3ApiResponse<z.ZodType<T>>
> extends z.ZodType<infer O>
  ? O
  : never;
