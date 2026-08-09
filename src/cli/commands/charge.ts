/**
 * Charging control commands — ported from `cmd_charge_now`, `cmd_charge_auto`,
 * `cmd_charge_stop` in `evnex/cli/_resources.py` (PLAN.md §5 C4).
 *
 * `charge stop` confirms interactively unless `--yes`, and translates
 * `EvnexTimeoutError` into "No active charging session on X to stop." with
 * exit 1 — the API answers a stop with no active session as a 504, which
 * surfaces as a read timeout.
 *
 * Each leaf command signs in and builds its own `Evnex` client (mirroring
 * Python's shared `open_client` async context manager, folded in here since
 * `resources.ts` (C3) owns that helper for the read commands and this file
 * must not depend on another agent's in-flight module). `signedInAuth` (C2,
 * `./auth.js`) is the one piece genuinely shared across every session-needing
 * command, per PLAN.md §5 C3.
 */

import { Evnex } from "../../api.js";
import { EvnexTimeoutError } from "../../http/errors.js";
import type { EvnexChargePoint } from "../../schema/chargePoints.js";
import { promptConfirm } from "../prompt.js";
import { resolveOne } from "../resolve.js";
import { cacheFlags, chargePointFlag, otpFlags } from "../parser.js";
import type { Command, FlagGroup, ParsedArgs } from "../parser.js";
import { signedInAuth } from "./auth.js";

const yesFlag: FlagGroup = {
  flags: [
    {
      name: "yes",
      type: "boolean",
      short: "y",
      help: "skip the confirmation prompt",
    },
  ],
};

interface OpenClientResult {
  client: Evnex;
  close: () => Promise<void>;
}

/** Sign in and build an `Evnex` client, mirroring Python's `open_client`. */
async function openClient(args: ParsedArgs): Promise<OpenClientResult> {
  const auth = await signedInAuth(args);
  const client = new Evnex({ auth });
  return { client, close: () => client.close() };
}

/** Fetch the account's charge points (and set the client's org id). */
async function listChargePoints(client: Evnex): Promise<EvnexChargePoint[]> {
  await client.getUserDetail();
  return client.getOrgChargePoints();
}

/** `--charge-point`'s value, or `undefined` when it was not given. */
function chargePointSelector(args: ParsedArgs): string | undefined {
  const value = args["chargePoint"];
  return typeof value === "string" ? value : undefined;
}

async function withClient(
  args: ParsedArgs,
  body: (client: Evnex, chargePoint: EvnexChargePoint) => Promise<void>,
): Promise<void> {
  const { client, close } = await openClient(args);
  try {
    const chargePoints = await listChargePoints(client);
    const chargePoint = resolveOne(chargePoints, chargePointSelector(args));
    await body(client, chargePoint);
  } finally {
    await close();
  }
}

function chargeNowCommand(): Command {
  return {
    name: "now",
    help: "start charging immediately, overriding the schedule",
    description: "Start charging immediately, overriding the schedule.",
    flags: [chargePointFlag, cacheFlags, otpFlags],
    run: (args) =>
      withClient(args, async (client, chargePoint) => {
        await client.setChargePointOverride({
          chargePointId: chargePoint.id,
          chargeNow: true,
        });
        process.stdout.write(
          `Charging now on ${chargePoint.name} (${chargePoint.serial})\n`,
        );
      }),
  };
}

function chargeAutoCommand(): Command {
  return {
    name: "auto",
    help: "return control to the configured charging schedule",
    description: "Return control to the configured charging schedule.",
    flags: [chargePointFlag, cacheFlags, otpFlags],
    run: (args) =>
      withClient(args, async (client, chargePoint) => {
        await client.setChargePointOverride({
          chargePointId: chargePoint.id,
          chargeNow: false,
        });
        process.stdout.write(
          `Returned ${chargePoint.name} (${chargePoint.serial}) to its charging schedule\n`,
        );
      }),
  };
}

function chargeStopCommand(): Command {
  return {
    name: "stop",
    help: "stop the active charging session",
    description: "Stop the active charging session.",
    flags: [chargePointFlag, cacheFlags, otpFlags, yesFlag],
    run: (args) =>
      withClient(args, async (client, chargePoint) => {
        if (args["yes"] !== true) {
          const confirmed = await promptConfirm(
            `Stop the active charging session on ${chargePoint.name}? [y/N] `,
          );
          if (!confirmed) {
            process.stderr.write("Aborted.\n");
            process.exit(1);
          }
        }
        try {
          await client.stopChargePoint({ chargePointId: chargePoint.id });
        } catch (error) {
          if (error instanceof EvnexTimeoutError) {
            process.stderr.write(
              `No active charging session on ${chargePoint.name} to stop.\n`,
            );
            process.exit(1);
          }
          throw error;
        }
        process.stdout.write(
          `Stopped charging on ${chargePoint.name} (${chargePoint.serial})\n`,
        );
      }),
  };
}

/** The `charge` command group: `now`, `auto`, `stop`. */
export function createChargeCommand(): Command {
  return {
    name: "charge",
    help: "control charging on a charge point",
    description: "Start charging now, return to the schedule, or stop charging.",
    children: [chargeNowCommand(), chargeAutoCommand(), chargeStopCommand()],
  };
}
