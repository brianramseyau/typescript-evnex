#!/usr/bin/env -S npx tsx
/**
 * !!! DESTRUCTIVE / MUTATING EXAMPLE !!!
 *
 * Disables, waits 5 seconds, then re-enables every charge point on every
 * organisation the signed-in account can see — with no confirmation prompt,
 * exactly like the Python original
 * (`examples/set_charge_point_availability.py`) it ports. Running this
 * against a real account takes real hardware offline for the duration of
 * the script; if it is interrupted between disable and re-enable, the
 * charger is left disabled (`ocppStatus: "UNAVAILABLE"`) until re-enabled by
 * hand (`npx evnex charge-points show` shows current status; re-run this
 * script, or use the underlying `Evnex.enableCharger`, to recover).
 *
 * Required: EVNEX_CLIENT_USERNAME, EVNEX_CLIENT_PASSWORD. See getToken.ts
 * for handling an MFA challenge during sign-in — this script assumes MFA is
 * off, exactly like the original.
 */

import { Evnex } from "../src/index.js";
import { EvnexAuth } from "../src/auth/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const auth = new EvnexAuth();
  await auth.startAuthentication(
    process.env["EVNEX_CLIENT_USERNAME"]!,
    process.env["EVNEX_CLIENT_PASSWORD"]!,
  );
  const evnex = new Evnex({ auth });

  const userData = await evnex.getUserDetail();
  console.log("User:", userData.name, userData.email, userData.id);

  for (const org of userData.organisations) {
    console.log("Getting charge points for", org.name);
    const chargePoints = await evnex.getOrgChargePoints(org.id);

    for (const chargePoint of chargePoints) {
      let detail = await evnex.getChargePointDetailV3(chargePoint.id);
      console.log(detail);
      await evnex.disableCharger({ orgId: org.id, chargePointId: chargePoint.id });
      await sleep(5000);
      detail = await evnex.getChargePointDetailV3(chargePoint.id);
      console.log(detail);

      console.log("Renabling");
      await evnex.enableCharger({ orgId: org.id, chargePointId: chargePoint.id });

      // Safe to repeat.
      await evnex.enableCharger({ orgId: org.id, chargePointId: chargePoint.id });
    }
  }
}

await main();
