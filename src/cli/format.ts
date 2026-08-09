/**
 * CLI output formatting — ported from the `_kw`, `_kwh`, `_fmt_dt`,
 * `_fmt_period`, and `_print_table` helpers in `evnex/cli/_resources.py`.
 *
 * `printTable` pads to the max cell width per column and joins with two
 * spaces — match exactly so output diffs cleanly against Python's.
 *
 * `formatDateTime` must use `Intl.DateTimeFormat.formatToParts()` with an
 * explicit `hourCycle: "h23"` — never `.format()` (locale-ordered, and
 * 12-hour by default, which turns `00:30` into `12:30`) and never
 * `.toISOString().slice(...)` (reads the UTC day, moving evening sessions
 * onto the wrong date). Both mistakes are live-observed (PLAN.md §10.8).
 * Python's `_fmt_dt` formats in the **host** timezone (`astimezone()`), so
 * parity means formatting in the host zone too — only the mechanism
 * changes: `Date`'s own instant-aware `getTimezoneOffset()` already yields
 * the host zone's DST-correct offset for a given instant, same as
 * `formatToParts` does for the calendar fields.
 */

/** Watts, as "12.34 kW", or "-" for `null`/`undefined`. */
export function kW(watts: number | null | undefined): string {
  return watts == null ? "-" : `${(watts / 1000).toFixed(2)} kW`;
}

/** Watt-hours, as "12.34 kWh", or "-" for `null`/`undefined`. */
export function kWh(wattHours: number | null | undefined): string {
  return wattHours == null ? "-" : `${(wattHours / 1000).toFixed(2)} kWh`;
}

/**
 * Built fresh on every call rather than once at module scope: `TZ` is only
 * read when an `Intl.DateTimeFormat` is *constructed*, and a formatter
 * built before a test (or process) later reassigns `process.env.TZ` would
 * keep resolving to its original zone forever — unlike `Date`'s own
 * timezone-sensitive methods, which do re-read it. `vitest.setup.ts` resets
 * `TZ` between tests specifically because of sensitivity like this, so the
 * formatter has to match that per-call, not cache across it.
 */
function dateTimePartFormatter(): Intl.DateTimeFormat {
  // hourCycle "h23" (never the default "h12") is what keeps midnight at
  // "00" instead of wrapping to "12" — see the module docstring and
  // PLAN.md §10.8.
  return new Intl.DateTimeFormat("en-US", {
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** The signed "+HH:MM"/"-HH:MM" UTC offset in effect for `value` in the host timezone. */
function utcOffset(value: Date): string {
  // getTimezoneOffset() is UTC-minus-local (so positive west of Greenwich)
  // and, crucially, is evaluated for this specific instant — it already
  // accounts for DST the same way formatToParts does for the calendar
  // fields, so the two stay consistent with each other.
  const minutesEastOfUtc = -value.getTimezoneOffset();
  const sign = minutesEastOfUtc < 0 ? "-" : "+";
  const absMinutes = Math.abs(minutesEastOfUtc);
  return `${sign}${pad2(Math.floor(absMinutes / 60))}:${pad2(absMinutes % 60)}`;
}

/** Local-readable ISO-8601 with second resolution, or "-" for `null`/`undefined`. */
export function formatDateTime(value: Date | null | undefined): string {
  if (value == null) return "-";

  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of dateTimePartFormatter().formatToParts(value)) {
    parts[part.type] = part.value;
  }

  const datePart = `${parts.year}-${parts.month}-${parts.day}`;
  const timePart = `${parts.hour}:${parts.minute}:${parts.second}`;
  return `${datePart}T${timePart}${utcOffset(value)}`;
}

/** Seconds from midnight, as "HH:MM". */
export function formatPeriod(seconds: number): string {
  // Mirrors Python's `int(seconds) // 60`: truncate to whole seconds first,
  // then floor-divide into minutes.
  const totalMinutes = Math.floor(Math.trunc(seconds) / 60);
  return `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`;
}

/** Print `rows` (with `headers`) to stdout as columns padded to a common width. */
export function printTable(headers: readonly string[], rows: readonly string[][]): void {
  const widths = headers.map((header) => header.length);
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  for (const row of [headers, ...rows]) {
    // The `?? 0` below cannot be reached. The scan above assigns a width for
    // every index any row occupies, and every header index is seeded at
    // initialisation, so each cell rendered here has a defined width. It is
    // present only to satisfy noUncheckedIndexedAccess.
    /* v8 ignore next -- provably unreachable, see above */
    const line = row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
    process.stdout.write(`${line}\n`);
  }
}
