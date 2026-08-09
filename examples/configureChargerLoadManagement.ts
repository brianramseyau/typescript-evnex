#!/usr/bin/env -S npx tsx
/**
 * !!! DESTRUCTIVE / MUTATING EXAMPLE !!!
 *
 * Overwrites the charging schedule AND the load-management profile on every
 * charge point on every organisation the signed-in account can see — with no
 * confirmation prompt, exactly like the Python original
 * (`examples/configure_charger_load_management.py`) it ports. Running this
 * against a real account changes when and how fast real hardware charges a
 * real vehicle. Read it fully before running it, and change the
 * `chargingProfilePeriods` below to values that make sense for your charger
 * before pointing this at anything real.
 *
 * Required: EVNEX_CLIENT_USERNAME, EVNEX_CLIENT_PASSWORD. See getToken.ts
 * for handling an MFA challenge during sign-in — this script assumes MFA is
 * off, exactly like the original.
 */

import { Evnex } from "../src/index.js";
import { EvnexAuth } from "../src/auth/index.js";
import type { EvnexChargeProfileSegment } from "../src/index.js";

// Seconds-from-midnight periods, in the charger's configured timezone:
// full 32A until 01:00, then 0A (off) until 01:15, then 0A (off) from then on.
const chargingProfilePeriods: EvnexChargeProfileSegment[] = [
  { start: 0, limit: 32 },
  { start: 3600, limit: 0 },
  { start: 4500, limit: 0 },
];

async function main(): Promise<void> {
  const auth = new EvnexAuth();
  await auth.startAuthentication(
    process.env["EVNEX_CLIENT_USERNAME"]!,
    process.env["EVNEX_CLIENT_PASSWORD"]!,
  );
  const evnex = new Evnex({ auth });

  const userData = await evnex.getUserDetail();
  for (const org of userData.organisations) {
    console.log("Getting charge points for", org.name);
    const chargePoints = await evnex.getOrgChargePoints(org.id);

    for (const chargePoint of chargePoints) {
      const detail = await evnex.getChargePointDetailV3(chargePoint.id);
      console.log(detail);

      console.log("Setting charger schedule");
      const schedule = await evnex.setChargePointSchedule({
        chargePointId: chargePoint.id,
        chargingProfilePeriods,
      });
      console.log(schedule);

      console.log("Setting charger load management");
      const loadProfile = await evnex.setChargerLoadProfile({
        chargePointId: chargePoint.id,
        chargingProfilePeriods,
        enabled: false,
      });
      console.log(loadProfile);
    }
  }
}

await main();
