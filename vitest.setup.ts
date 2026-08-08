/**
 * Global vitest setup (PLAN.md §5 A9).
 *
 * NOT yet wired up: `vitest.config.ts` belongs to the integrator (PLAN.md
 * §4.4 rule 1 — agents write only their owned files), so this file exists but
 * is inert until `vitest.config.ts`'s `test.setupFiles` lists it. See A9's
 * report for the exact one-line change needed.
 *
 * Pins a deterministic default timezone. Nothing in this codebase should
 * depend on whatever `TZ` happens to be set in the environment running the
 * suite — `formatDateTime` (A10, PLAN.md §10.8) is the sharpest example, but
 * any `Date`-touching code is equally at risk. Tests that need a specific
 * zone (e.g. the half-hour-offset `Australia/Adelaide` case, or one crossing
 * a UTC day boundary) set `process.env.TZ` themselves; this hook resets it to
 * the default after every test so that choice cannot leak into an unrelated
 * one that forgot to pin its own.
 */

import { afterEach } from "vitest";

const DEFAULT_TZ = "UTC";
process.env["TZ"] = DEFAULT_TZ;

afterEach(() => {
  process.env["TZ"] = DEFAULT_TZ;
});
