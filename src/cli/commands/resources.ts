/**
 * Resource read commands — ported from `cmd_live_status`,
 * `cmd_charge_points_list`, `cmd_charge_points_show`, `cmd_sessions_list`,
 * `cmd_locations_list`, `cmd_insights`, `cmd_schedule_show` in
 * `evnex/cli/_resources.py` (PLAN.md §5 C3).
 *
 * TODO(C3): implement.
 *
 * `--json` emits a single JSON document on stdout via `toJson()`
 * (`../../schema/json.js`); **all** diagnostics go to stderr — several
 * Python tests assert stdout purity. Sessions are explicitly sorted
 * newest-first (the API documents no ordering). `--limit` defaults to 10
 * and rejects non-positive values. `insights --days` accepts only
 * `7 | 14 | 30`, defaulting to 7.
 */

import type { Evnex } from "../../api.js";
import type { Command, ParsedArgs } from "../parser.js";

/** Sign in, build an `Evnex` client, and always release it on exit. */
export async function openClient(
  args: ParsedArgs,
): Promise<{ client: Evnex; close: () => Promise<void> }> {
  throw new Error("TODO(C3)");
}

/**
 * The top-level resource commands: `status`, `charge-points` (list/show),
 * `sessions` (list), `locations` (list), `insights`, `schedule` (show).
 */
export function createResourceCommands(): Command[] {
  throw new Error("TODO(C3)");
}
