/**
 * Shared JSON-output helper — ported from pydantic's `model_dump(mode="json")`
 * behaviour used throughout `evnex/cli/_resources.py`.
 *
 * TODO(A3): implement. Recursively converts `Date` → `.toISOString()`, drops
 * `undefined` values, and preserves `null`, so every CLI `--json` path
 * produces output byte-comparable with the Python CLI's (PLAN.md §2.6).
 */

export function toJson(value: unknown): unknown {
  throw new Error("TODO(A3)");
}
