/**
 * Charger model-code parsing — ported from `evnex/models.py`.
 *
 * ⚠ No upstream tests exist for this module (PLAN.md §6.3) — A2's tests are
 * the first verification this logic has ever had.
 *
 * TODO(A2): implement `parseModel` for the E2, X and E7 series, including
 * every lookup table and each "Unknown" fallback path. Note the Python E7
 * branch sets `power: "7"` (not `"7 kW"`) — that asymmetry is in the
 * original and must be preserved verbatim; flag it in PARITY.md as an
 * upstream quirk carried forward deliberately.
 */

export interface EvnexModelInfo {
  name: string;
  connector: string;
  cableLength: string;
  colour: string;
  /** Only for X-series (and "7" — not "7 kW" — for E7-series). */
  power: string;
  /** Only for X-series. */
  powerSensor: string;
  /** Only for X-series. */
  configuration: string;
}

/** Parse either an E2-series, X-series, or E7-series model id. */
export function parseModel(modelId: string): EvnexModelInfo {
  throw new Error("TODO(A2)");
}
