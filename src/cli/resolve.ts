/**
 * Charge point selection — ported from `_match_charge_point` and
 * `_resolve_one` in `evnex/cli/_resources.py` (PLAN.md §5 C4).
 *
 * Resolution order: exact id wins; otherwise case-insensitive substring
 * match on name **or** serial. Zero or multiple matches print the
 * candidates to stderr and exit 2 — part of the CLI contract, not an
 * incidental detail.
 */

import type { EvnexChargePoint } from "../schema/chargePoints.js";

/** Print `message` to stderr and exit with `code`. */
function abort(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  return process.exit(code);
}

/** Resolve `selector` to a single charge point, or exit(2) with candidates on stderr. */
export function matchChargePoint(
  chargePoints: readonly EvnexChargePoint[],
  selector: string,
): EvnexChargePoint {
  const exact = chargePoints.find((chargePoint) => chargePoint.id === selector);
  if (exact !== undefined) return exact;

  const needle = selector.toLowerCase();
  const matches = chargePoints.filter(
    (chargePoint) =>
      chargePoint.name.toLowerCase().includes(needle) ||
      chargePoint.serial.toLowerCase().includes(needle),
  );
  if (matches.length === 1) {
    // noUncheckedIndexedAccess: length check above proves this is defined.
    return matches[0] as EvnexChargePoint;
  }
  if (matches.length === 0) {
    abort(`No charge point matches '${selector}'`, 2);
  }
  const lines = [`'${selector}' matches several charge points; be more specific:`];
  for (const chargePoint of matches) {
    lines.push(`  ${chargePoint.id}  ${chargePoint.name}`);
  }
  abort(lines.join("\n"), 2);
}

/**
 * Resolve the target charge point: `selector` if given, else the sole
 * charge point if there is exactly one, else exit(2) listing the choices.
 */
export function resolveOne(
  chargePoints: readonly EvnexChargePoint[],
  selector: string | undefined,
): EvnexChargePoint {
  if (selector !== undefined) {
    return matchChargePoint(chargePoints, selector);
  }
  if (chargePoints.length === 1) {
    // noUncheckedIndexedAccess: length check above proves this is defined.
    return chargePoints[0] as EvnexChargePoint;
  }
  const lines = ["Select a charge point with --charge-point:"];
  for (const chargePoint of chargePoints) {
    lines.push(`  ${chargePoint.id}  ${chargePoint.name}`);
  }
  abort(lines.join("\n"), 2);
}
