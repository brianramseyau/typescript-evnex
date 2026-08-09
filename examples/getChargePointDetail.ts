#!/usr/bin/env -S npx tsx
/**
 * Walk every organisation and charge point on the account, printing insights,
 * status, detail, override, energy-meter, and session data — a port of
 * python-evnex's `examples/get_charge_point_detail.py`. Read-only: makes no
 * changes to any charger.
 *
 * Required: EVNEX_CLIENT_USERNAME, EVNEX_CLIENT_PASSWORD. See getToken.ts
 * for handling an MFA challenge during sign-in — this script assumes MFA is
 * off, exactly like the original.
 */

import { Evnex, EvnexHttpError } from "../src/index.js";
import type { EvnexChargePoint } from "../src/index.js";
import { EvnexAuth } from "../src/auth/index.js";

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
    console.log("Getting org insights for", org.name);
    const dailyInsights = await evnex.getOrgInsight({ days: 7, orgId: org.id });
    for (const segment of dailyInsights) {
      console.log(segment);
    }

    console.log(`Getting charge points for '${org.name}'`);
    let chargePoints: EvnexChargePoint[];
    try {
      chargePoints = await evnex.getOrgChargePoints(org.id);
    } catch (error) {
      if (!(error instanceof EvnexHttpError)) throw error;
      chargePoints = await evnex.getOrgChargePoints(org.slug);
    }

    for (const chargePoint of chargePoints) {
      console.log(
        chargePoint.name,
        chargePoint.networkStatus,
        chargePoint.serial,
        chargePoint.id,
      );
      console.log("Getting charge point status");
      // Like the original: this runs before the online/offline check below,
      // so it can hang against an offline charge point exactly as noted
      // there — the guard only covers the calls that follow it.
      const chargeStatus = await evnex.getChargePointStatus(chargePoint.id);
      console.log(chargeStatus);

      console.log("charge point details");
      const chargePointDetail = await evnex.getChargePointDetailV3(chargePoint.id);
      console.log(chargePointDetail);

      if (chargePointDetail.data.attributes.networkStatus === "OFFLINE") {
        console.log("Charge point offline");
        // Several calls hang if the ChargePoint is offline, so we only keep
        // querying this charge point if it is online.
        continue;
      } else {
        console.log("Charge point online");
      }

      console.log("Getting charge override setting");
      const override = await evnex.getChargePointOverride(chargePoint.id);
      console.log(override);

      // Solar config:
      // const solarConfig = await evnex.getChargePointSolarConfig(chargePoint.id);
      // console.log(solarConfig);

      // Flip the override the other way:
      // console.log(`Setting charge override setting to ${override.chargeNow ? "off" : "on"}`);
      // await evnex.setChargePointOverride({
      //   chargePointId: chargePoint.id,
      //   chargeNow: !override.chargeNow,
      // });
      // console.log("Getting charge override setting again");
      // console.log(await evnex.getChargePointOverride(chargePoint.id));

      console.log("Getting energy meter reading");
      const chargeReading = await evnex.getChargePointEnergyMeterReading(chargePoint.id);
      console.log(chargeReading);

      console.log();
      console.log("Getting transactions");
      const transactions = await evnex.getChargePointSessions(chargePoint.id);
      console.log(transactions.length, "transactions");

      // The Python original indexes transactions[0] unconditionally in the
      // "else" branch, which throws IndexError for a charge point with no
      // sessions at all; noUncheckedIndexedAccess makes that same mistake a
      // compile error here, so this adds the one guard needed to type-check
      // without changing anything about a charge point that does have
      // sessions.
      const latest = transactions[0];
      if (latest !== undefined && latest.attributes.endDate == null) {
        console.log("Active Charging Session:");
        console.log(latest);
      } else if (latest !== undefined) {
        console.log("Last charging session:");
        console.log(latest);
      } else {
        console.log("No charging sessions yet");
      }
    }
  }
}

await main();
