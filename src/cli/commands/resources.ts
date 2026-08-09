/**
 * Resource read commands — ported from `cmd_live_status`,
 * `cmd_charge_points_list`, `cmd_charge_points_show`, `cmd_sessions_list`,
 * `cmd_locations_list`, `cmd_insights`, `cmd_schedule_show` in
 * `evnex/cli/_resources.py` (PLAN.md §5 C3).
 *
 * `--json` emits a single JSON document on stdout via `toJson()`
 * (`../../schema/json.js`); **all** diagnostics go to stderr — several
 * Python tests assert stdout purity. Sessions are explicitly sorted
 * newest-first (the API documents no ordering). `--limit` defaults to 10
 * and rejects non-positive values; `insights --days` accepts only
 * `7 | 14 | 30`, defaulting to 7 — both defaults and the validation are
 * expressed through C1's `FlagSpec.default`/`choices`/`validate`, so by the
 * time a command's `run` sees `args`, the value is always present and
 * already valid.
 */

import { Evnex } from "../../api.js";
import { toJson } from "../../schema/json.js";
import type { EvnexChargePoint } from "../../schema/chargePoints.js";
import type { EvnexChargePointSession } from "../../schema/v3/chargePoints.js";
import { formatDateTime, formatPeriod, kW, kWh, printTable } from "../format.js";
import { cacheFlags, chargePointFlag, jsonFlag, otpFlags } from "../parser.js";
import type { Command, FlagGroup, ParsedArgs } from "../parser.js";
import { matchChargePoint, resolveOne } from "../resolve.js";
import { signedInAuth } from "./auth.js";

/** Sign in, build an `Evnex` client, and always release it on exit. */
export async function openClient(
  args: ParsedArgs,
): Promise<{ client: Evnex; close: () => Promise<void> }> {
  const auth = await signedInAuth(args);
  const client = new Evnex({ auth });
  return { client, close: () => client.close() };
}

/**
 * Run `fn` with a signed-in client, always releasing it afterwards — the
 * `async with open_client(args) as client:` analogue.
 */
async function withClient<T>(
  args: ParsedArgs,
  fn: (client: Evnex) => Promise<T>,
): Promise<T> {
  const { client, close } = await openClient(args);
  try {
    return await fn(client);
  } finally {
    await close();
  }
}

/** Fetch the account's charge points (and set the client's org id). */
async function listChargePoints(client: Evnex): Promise<EvnexChargePoint[]> {
  await client.getUserDetail();
  return client.getOrgChargePoints();
}

/** `--json`'s value, coerced to a plain boolean. */
function isJson(args: ParsedArgs): boolean {
  return args["json"] === true;
}

/** A declared string flag's value, or `undefined` if it was never given. */
function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Sessions newest-first. The API documents no ordering, so this sorts
 * rather than assumes one — a session with no `startDate` sorts last.
 */
function newestFirst(
  sessions: readonly EvnexChargePointSession[],
): EvnexChargePointSession[] {
  return [...sessions].sort((a, b) => {
    const aTime = a.attributes.startDate?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bTime = b.attributes.startDate?.getTime() ?? Number.NEGATIVE_INFINITY;
    return bTime - aTime;
  });
}

function latestSession(
  sessions: readonly EvnexChargePointSession[],
): EvnexChargePointSession | undefined {
  return newestFirst(sessions)[0];
}

/** Print `value` as a single indented JSON document on stdout — the only thing on stdout for `--json`. */
function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(toJson(value), null, 2)}\n`);
}

/**
 * Insight dates render in UTC, deliberately unlike `formatDateTime`: Python's
 * `entry.startDate.strftime("%Y-%m-%d")` never calls `.astimezone()`, so it
 * reads the aware (UTC) datetime's own calendar date rather than the host
 * zone's. `toISOString()` always reports UTC, so slicing its date part is
 * the direct equivalent.
 */
function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

const limitFlag: FlagGroup = {
  flags: [
    {
      name: "limit",
      type: "string",
      default: "10",
      help: "maximum number of sessions to show (default 10)",
      validate: (raw) => {
        const value = Number(raw);
        return Number.isInteger(value) && value > 0
          ? undefined
          : "must be a positive integer";
      },
    },
  ],
};

const daysFlag: FlagGroup = {
  flags: [
    {
      name: "days",
      type: "string",
      choices: ["7", "14", "30"],
      default: "7",
      help: "reporting window in days (default 7)",
    },
  ],
};

/**
 * `--token-cache` and `--otp`/`--otp-command`, attached to every command
 * that signs in. A function, not a module-scope constant: `parser.ts`
 * imports this file (to wire the real command tree into `buildParser`), so
 * this file importing `cacheFlags`/`otpFlags` back from `parser.ts` makes
 * the two modules mutually circular. A `const` computed eagerly at this
 * file's own module-body evaluation time can run *before* `parser.ts` has
 * finished initialising its exports (this file is reached partway through
 * `parser.ts` loading it, precisely because of the cycle); calling this
 * from inside `createResourceCommands()` instead defers the read until the
 * whole module graph has settled.
 */
function signInFlags(): FlagGroup[] {
  return [cacheFlags, otpFlags];
}

async function cmdLiveStatus(args: ParsedArgs): Promise<void> {
  await withClient(args, async (client) => {
    const chargePoints = await listChargePoints(client);
    const selector = stringFlag(args, "chargePoint");
    const targets =
      selector !== undefined ? [matchChargePoint(chargePoints, selector)] : chargePoints;
    const json = isJson(args);

    const payload: unknown[] = [];
    const blocks: string[][] = [];

    for (const chargePoint of targets) {
      const detail = await client.getChargePointDetailV3(chargePoint.id);
      const sessions = await client.getChargePointSessions(chargePoint.id);
      const attributes = detail.data.attributes;
      const latest = latestSession(sessions);

      if (json) {
        payload.push({ chargePoint: attributes, sessions });
        continue;
      }

      const lines = [`${attributes.name} (${attributes.serial})`];
      lines.push(`  Network: ${attributes.networkStatus}`);
      for (const connector of attributes.connectors) {
        lines.push(`  Connector ${connector.connectorId}: ${connector.ocppStatus}`);
        if (connector.meter != null) {
          lines.push(`    Charging power: ${kW(connector.meter.power)}`);
          if (connector.meter.supplyActivePower != null) {
            lines.push(`    Grid power: ${kW(connector.meter.supplyActivePower)}`);
          }
        }
      }
      if (latest !== undefined && latest.attributes.endDate == null) {
        const session = latest.attributes;
        let summary = `  Active session: ${kWh(session.totalPowerUsage)}`;
        if (session.totalCost != null) {
          summary += `, ${session.totalCost.amount.toFixed(2)} ${session.totalCost.currency}`;
        }
        lines.push(summary);
      }
      blocks.push(lines);
    }

    if (json) {
      writeJson(payload);
      return;
    }
    if (blocks.length === 0) {
      process.stderr.write("No charge points found\n");
      return;
    }
    process.stdout.write(`${blocks.map((block) => block.join("\n")).join("\n\n")}\n`);
  });
}

async function cmdChargePointsList(args: ParsedArgs): Promise<void> {
  await withClient(args, async (client) => {
    const chargePoints = await listChargePoints(client);
    if (isJson(args)) {
      writeJson(chargePoints);
      return;
    }
    const rows = chargePoints.map((cp) => [cp.id, cp.name, cp.serial, cp.networkStatus]);
    printTable(["ID", "Name", "Serial", "Network"], rows);
  });
}

async function cmdChargePointsShow(args: ParsedArgs): Promise<void> {
  await withClient(args, async (client) => {
    const chargePoints = await listChargePoints(client);
    const chargePoint = resolveOne(chargePoints, args.positionals[0]);
    const detail = await client.getChargePointDetailV3(chargePoint.id);
    const attributes = detail.data.attributes;

    if (isJson(args)) {
      writeJson(attributes);
      return;
    }

    const lines = [`${attributes.name} (${attributes.serial})`];
    lines.push(`  Model: ${attributes.model}`);
    lines.push(`  Firmware: ${attributes.firmware}`);
    lines.push(`  Serial: ${attributes.serial}`);
    lines.push(`  Network status: ${attributes.networkStatus}`);
    for (const connector of attributes.connectors) {
      lines.push(
        `  Connector ${connector.connectorId} (${connector.connectorType}): ${connector.ocppStatus}`,
      );
      if (connector.meter != null) {
        lines.push(`    Charging power: ${kW(connector.meter.power)}`);
        if (connector.meter.supplyActivePower != null) {
          lines.push(`    Grid power: ${kW(connector.meter.supplyActivePower)}`);
        }
      }
    }
    const schedule = attributes.profiles.chargeSchedule;
    const enabled = schedule != null && schedule.enabled ? "enabled" : "disabled";
    lines.push(`  Charge schedule: ${enabled}`);
    process.stdout.write(`${lines.join("\n")}\n`);
  });
}

async function cmdSessionsList(args: ParsedArgs): Promise<void> {
  await withClient(args, async (client) => {
    const chargePoints = await listChargePoints(client);
    const chargePoint = resolveOne(chargePoints, stringFlag(args, "chargePoint"));
    const limit = Number(stringFlag(args, "limit"));
    const sessions = newestFirst(
      await client.getChargePointSessions(chargePoint.id),
    ).slice(0, limit);

    if (isJson(args)) {
      writeJson(sessions);
      return;
    }

    const rows = sessions.map((session) => {
      const attributes = session.attributes;
      const end =
        attributes.endDate == null ? "active" : formatDateTime(attributes.endDate);
      const cost =
        attributes.totalCost != null
          ? `${attributes.totalCost.amount.toFixed(2)} ${attributes.totalCost.currency}`
          : "-";
      return [
        formatDateTime(attributes.startDate),
        end,
        kWh(attributes.totalPowerUsage),
        cost,
      ];
    });
    printTable(["Start", "End", "Energy", "Cost"], rows);
  });
}

async function cmdLocationsList(args: ParsedArgs): Promise<void> {
  await withClient(args, async (client) => {
    await client.getUserDetail();
    const locations = await client.getOrgLocations();

    if (isJson(args)) {
      writeJson(locations);
      return;
    }

    const rows = locations.map((location) => {
      const attributes = location.attributes;
      const city = attributes.address?.city;
      const retailer = attributes.icpDetails?.electricityRetailer;
      return [
        attributes.name,
        city || "-",
        attributes.icpNumber || "-",
        retailer || "-",
        attributes.timeZone || "-",
      ];
    });
    printTable(["Name", "City", "ICP", "Retailer", "Timezone"], rows);
  });
}

async function cmdInsights(args: ParsedArgs): Promise<void> {
  await withClient(args, async (client) => {
    await client.getUserDetail();
    const days = Number(stringFlag(args, "days"));
    const insights = await client.getOrgInsight({ days });

    if (isJson(args)) {
      writeJson(insights);
      return;
    }

    const rows = insights.map((entry) => {
      let cost = "-";
      if (entry.cost.cost != null) {
        cost = `${entry.cost.cost.toFixed(2)} ${entry.cost.currency ?? ""}`.trim();
      }
      return [
        formatUtcDate(entry.startDate),
        kWh(entry.powerUsage),
        cost,
        String(entry.sessions),
      ];
    });
    printTable(["Date", "Energy", "Cost", "Sessions"], rows);
  });
}

async function cmdScheduleShow(args: ParsedArgs): Promise<void> {
  await withClient(args, async (client) => {
    const chargePoints = await listChargePoints(client);
    const chargePoint = resolveOne(chargePoints, stringFlag(args, "chargePoint"));
    const detail = await client.getChargePointDetailV3(chargePoint.id);
    const schedule = detail.data.attributes.profiles.chargeSchedule;

    if (isJson(args)) {
      // `undefined` (key absent on the wire) and explicit `null` both mean
      // "no schedule configured"; collapse to `null` before serialising so
      // this always emits the JSON literal `null`, never the bare word
      // "undefined" `JSON.stringify` would otherwise produce.
      writeJson(schedule ?? null);
      return;
    }

    if (schedule == null) {
      process.stdout.write(`No charge schedule configured for ${chargePoint.name}\n`);
      return;
    }
    const lines = [
      `Charge schedule for ${chargePoint.name}: ${schedule.enabled ? "enabled" : "disabled"}`,
    ];
    for (const period of schedule.chargingSchedulePeriods) {
      lines.push(`  ${formatPeriod(period.startPeriod)}  ${period.limit} A`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  });
}

/**
 * The top-level resource commands: `status`, `charge-points` (list/show),
 * `sessions` (list), `locations` (list), `insights`, `schedule` (show).
 */
export function createResourceCommands(): Command[] {
  return [
    {
      name: "status",
      help: "show a live view of your charge points",
      description:
        "Show, for each charge point (or the one selected with --charge-point), " +
        "its network status, each connector's status and power, and any active " +
        "charging session's energy and cost.",
      flags: [chargePointFlag, jsonFlag, ...signInFlags()],
      run: cmdLiveStatus,
    },
    {
      name: "charge-points",
      help: "list and inspect charge points",
      description: "List charge points or show the detail of one.",
      children: [
        {
          name: "list",
          help: "list charge points (id, name, serial, network status)",
          flags: [jsonFlag, ...signInFlags()],
          run: cmdChargePointsList,
        },
        {
          name: "show",
          help: "show the detail of one charge point",
          flags: [jsonFlag, ...signInFlags()],
          positionals: [
            {
              name: "id",
              required: false,
              help: "charge point id, or a part of its name or serial",
            },
          ],
          run: cmdChargePointsShow,
        },
      ],
    },
    {
      name: "sessions",
      help: "list charging sessions",
      description: "List recent charging sessions for a charge point.",
      children: [
        {
          name: "list",
          help: "list recent charging sessions for a charge point",
          flags: [chargePointFlag, jsonFlag, ...signInFlags(), limitFlag],
          run: cmdSessionsList,
        },
      ],
    },
    {
      name: "locations",
      help: "list locations",
      description: "List the organisation's locations.",
      children: [
        {
          name: "list",
          help: "list locations (name, city, ICP number, retailer, timezone)",
          flags: [jsonFlag, ...signInFlags()],
          run: cmdLocationsList,
        },
      ],
    },
    {
      name: "insights",
      help: "show daily energy, cost, and session counts for the organisation",
      flags: [jsonFlag, ...signInFlags(), daysFlag],
      run: cmdInsights,
    },
    {
      name: "schedule",
      help: "view the charging schedule",
      description: "Show the charging schedule configured on a charge point.",
      children: [
        {
          name: "show",
          help: "show the charging schedule (enabled state and periods)",
          flags: [chargePointFlag, jsonFlag, ...signInFlags()],
          run: cmdScheduleShow,
        },
      ],
    },
  ];
}
