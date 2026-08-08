/**
 * Charge point selection — ported from `_match_charge_point` and
 * `_resolve_one` in `evnex/cli/_resources.py` (PLAN.md §5 C4).
 *
 * TODO(C4): implement.
 *
 * Resolution order: exact id wins; otherwise case-insensitive substring
 * match on name **or** serial. Zero or multiple matches print the
 * candidates to stderr and exit 2 — part of the CLI contract, not an
 * incidental detail.
 */

import type { EvnexChargePoint } from "../schema/chargePoints.js";

/** Resolve `selector` to a single charge point, or exit(2) with candidates on stderr. */
export function matchChargePoint(
  chargePoints: readonly EvnexChargePoint[],
  selector: string,
): EvnexChargePoint {
  throw new Error("TODO(C4)");
}

/**
 * Resolve the target charge point: `selector` if given, else the sole
 * charge point if there is exactly one, else exit(2) listing the choices.
 */
export function resolveOne(
  chargePoints: readonly EvnexChargePoint[],
  selector: string | undefined,
): EvnexChargePoint {
  throw new Error("TODO(C4)");
}
