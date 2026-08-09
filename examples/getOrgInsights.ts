#!/usr/bin/env -S npx tsx
/**
 * Print each organisation's 7-day insight (daily energy, cost, carbon,
 * session counts) — a port of python-evnex's `examples/get_org_insights.py`.
 * Read-only.
 *
 * Required: EVNEX_CLIENT_USERNAME, EVNEX_CLIENT_PASSWORD. See getToken.ts
 * for handling an MFA challenge during sign-in — this script assumes MFA is
 * off, exactly like the original.
 */

import { Evnex } from "../src/index.js";
import { EvnexAuth } from "../src/auth/index.js";

async function main(): Promise<void> {
  const auth = new EvnexAuth();
  await auth.startAuthentication(
    process.env["EVNEX_CLIENT_USERNAME"]!,
    process.env["EVNEX_CLIENT_PASSWORD"]!,
  );
  const evnex = new Evnex({ auth });

  const userData = await evnex.getUserDetail();

  for (const org of userData.organisations) {
    // Global connector statuses:
    // const status = await evnex.getOrgSummaryStatus(org.slug);
    // console.log(status);

    console.log("Getting 7 day insight for", org.name, "User:", userData.name);
    const dailyInsights = await evnex.getOrgInsight({ days: 7, orgId: org.id });

    for (const segment of dailyInsights) {
      console.log(segment);
    }
  }
}

await main();
