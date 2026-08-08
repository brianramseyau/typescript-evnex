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

/** Factory for the generic `EvnexV3APIResponse[T]` / `EvnexV3Data[T]` envelope. */
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

export type EvnexV3APIResponse<T> = ReturnType<
  typeof evnexV3ApiResponse<z.ZodType<T>>
> extends z.ZodType<infer O>
  ? O
  : never;
