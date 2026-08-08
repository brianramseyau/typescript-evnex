/**
 * Shared JSON-output helper — ported from pydantic's `model_dump(mode="json")`
 * behaviour used throughout `evnex/cli/_resources.py`.
 *
 * Recursively converts `Date` -> ISO string, drops `undefined` values (object
 * keys whose value is `undefined` are omitted entirely, matching pydantic's
 * `exclude_none=False` default where an *absent* field never appears — Zod's
 * `.nullish()` fields decode to `undefined` when the wire omitted them), and
 * preserves `null` (pydantic keeps explicit `None` in the dump). Every CLI
 * `--json` path uses this so output is byte-comparable with Python's CLI
 * (PLAN.md §2.6).
 */

export function toJson(value: unknown): unknown {
  if (value instanceof Date) {
    // pydantic's `model_dump(mode="json")` renders a datetime with zero
    // microseconds *without* a fractional-seconds component at all (e.g.
    // "2024-06-01T00:00:00Z", not "2024-06-01T00:00:00.000Z") — verified
    // against pydantic v2 directly, and it is what every captured Evnex
    // fixture in the Python test suite actually is (whole-second or
    // millisecond-exact timestamps only). `Date#toISOString()` always emits
    // ".000Z" for a whole-second instant, so that suffix is stripped here to
    // stay byte-identical to Python for every timestamp this API sends.
    //
    // This is a best-effort match, not a full one: a JS `Date` only ever
    // carries millisecond precision, while pydantic renders genuine
    // sub-second values at microsecond precision (6 digits, e.g.
    // ".123000Z" for input ".123Z"). No fixture exercises that path, so it
    // is flagged rather than "fixed" by pulling in a bignum-precision date
    // library for a case the live API has never produced.
    return value.toISOString().replace(/\.000Z$/, "Z");
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJson(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      result[key] = toJson(entry);
    }
    return result;
  }
  // Primitives (string, number, boolean) and `null` pass through unchanged.
  return value;
}
