/**
 * Charging control commands — ported from `cmd_charge_now`, `cmd_charge_auto`,
 * `cmd_charge_stop` in `evnex/cli/_resources.py` (PLAN.md §5 C4).
 *
 * TODO(C4): implement.
 *
 * `charge stop` confirms interactively unless `--yes`, and translates
 * `EvnexTimeoutError` into "No active charging session on X to stop." with
 * exit 1 — the API answers a stop with no active session as a 504, which
 * surfaces as a read timeout.
 */

import type { Command } from "../parser.js";

/** The `charge` command group: `now`, `auto`, `stop`. */
export function createChargeCommand(): Command {
  throw new Error("TODO(C4)");
}
