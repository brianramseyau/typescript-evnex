/**
 * CLI output formatting — ported from the `_kw`, `_kwh`, `_fmt_dt`,
 * `_fmt_period`, and `_print_table` helpers in `evnex/cli/_resources.py`.
 *
 * TODO(A10): implement.
 *
 * `printTable` pads to the max cell width per column and joins with two
 * spaces — match exactly so output diffs cleanly against Python's.
 *
 * `formatDateTime` must use `Intl.DateTimeFormat.formatToParts()` with an
 * explicit `hourCycle: "h23"` — never `.format()` (locale-ordered, and
 * 12-hour by default, so `00:30` comes back as hour 12) and never
 * `.toISOString().slice(...)` (reads the UTC day, moving evening sessions
 * onto the wrong date). Both mistakes are live-observed (PLAN.md §10.8).
 * Python's `_fmt_dt` formats in the **host** timezone (`astimezone()`), so
 * parity means formatting in the host zone too — only the mechanism changes.
 */

/** Watts, as "12.34 kW", or "-" for `null`/`undefined`. */
export function kW(watts: number | null | undefined): string {
  throw new Error("TODO(A10)");
}

/** Watt-hours, as "12.34 kWh", or "-" for `null`/`undefined`. */
export function kWh(wattHours: number | null | undefined): string {
  throw new Error("TODO(A10)");
}

/** Local-readable ISO-8601 with second resolution, or "-" for `null`/`undefined`. */
export function formatDateTime(value: Date | null | undefined): string {
  throw new Error("TODO(A10)");
}

/** Seconds from midnight, as "HH:MM". */
export function formatPeriod(seconds: number): string {
  throw new Error("TODO(A10)");
}

/** Print `rows` (with `headers`) to stdout as columns padded to a common width. */
export function printTable(headers: readonly string[], rows: readonly string[][]): void {
  throw new Error("TODO(A10)");
}
