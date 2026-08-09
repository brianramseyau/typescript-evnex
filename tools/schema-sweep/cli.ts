#!/usr/bin/env -S npx tsx
/**
 * The schema sweep's command-line entry point.
 *
 * ```
 * npx tsx tools/schema-sweep/cli.ts              # live sweep against a real account
 * npx tsx tools/schema-sweep/cli.ts --dry-run     # pipeline demo against fixtures, no network
 * ```
 *
 * See `docs/downstream-validation.md` for the full operator guide (what to
 * set, what this writes, what to check before committing). Short version:
 *
 *  - Credentials: resumes from the CLI's own token cache
 *    (`$EVNEX_TOKEN_CACHE`, or the XDG default `evnex auth login` already
 *    writes to) if one exists — a refresh token alone is enough, no
 *    password needed. Falls back to `EVNEX_CLIENT_USERNAME` /
 *    `EVNEX_CLIENT_PASSWORD` for an MFA-free account; if that account has
 *    MFA enabled, run `evnex auth login` once first (it already handles
 *    every challenge type) and this reuses the cache it writes.
 *  - Live mode writes `docs/schema-sweep.md` by default (the exact doc the
 *    live run is meant to fill in) plus one JSON capture file per endpoint
 *    under `--out` (default `./schema-sweep-output`).
 *  - Dry-run mode never writes `docs/schema-sweep.md` — refuses outright if
 *    asked to, so a fixture-derived report can never be mistaken for real
 *    findings. Its default report path is `<out>/dry-run-report.md`.
 *  - Ctrl-C stops the walk after the in-flight endpoint finishes; whatever
 *    was already captured stays on disk, and re-running skips it.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { EvnexAuth } from "../../src/auth/index.js";
import { isAuthChallenge } from "../../src/auth/index.js";
import { EvnexAuthError } from "../../src/errors.js";
import { Transport } from "../../src/http/transport.js";
import type { AuthTokenSource } from "../../src/http/authFlow.js";
import { EvnexConfig } from "../../src/config.js";
import {
  createTokenSaver,
  defaultTokenCachePath,
  loadTokens,
} from "../../src/cli/tokenCache.js";
import { ENDPOINTS } from "./endpoints.js";
import { buildDryRunHarness, FIXTURE_PROVENANCE } from "./fixtures/dryRunFixtures.js";
import { generateReport } from "./report.js";
import type { EndpointCaptureRecord } from "./types.js";
import { runWalk } from "./walk.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_LIVE_REPORT_PATH = join(REPO_ROOT, "docs", "schema-sweep.md");

interface CliOptions {
  dryRun: boolean;
  outDir: string;
  reportPath: string;
  force: boolean;
  org?: string;
  chargePoint?: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const dryRun = argv.includes("--dry-run");
  let outDir: string | undefined;
  let reportPath: string | undefined;
  let force = false;
  let org: string | undefined;
  let chargePoint: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      outDir = argv[i + 1];
      i += 1;
    } else if (arg === "--report") {
      reportPath = argv[i + 1];
      i += 1;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--org") {
      org = argv[i + 1];
      i += 1;
    } else if (arg === "--charge-point") {
      chargePoint = argv[i + 1];
      i += 1;
    } else if (arg === "--dry-run" || arg === undefined) {
      // handled above / not a flag with a value
    } else if (arg.startsWith("--")) {
      process.stderr.write(`Unknown flag: ${arg}\n`);
      process.exit(2);
    }
  }

  const resolvedOutDir = resolve(outDir ?? join(REPO_ROOT, "schema-sweep-output"));
  const resolvedReportPath = resolve(
    reportPath ??
      (dryRun ? join(resolvedOutDir, "dry-run-report.md") : DEFAULT_LIVE_REPORT_PATH),
  );

  if (dryRun && resolvedReportPath === resolve(DEFAULT_LIVE_REPORT_PATH)) {
    process.stderr.write(
      "Refusing to write a --dry-run report to docs/schema-sweep.md — that file is reserved " +
        "for real live-API findings (PLAN.md's D5 spec). Pass --report <path> to choose " +
        "somewhere else, or drop --report to use the default dry-run path.\n",
    );
    process.exit(2);
  }

  return {
    dryRun,
    outDir: resolvedOutDir,
    reportPath: resolvedReportPath,
    force,
    org,
    chargePoint,
  };
}

// -- Live auth resolution ------------------------------------------------------

/**
 * Resume from the CLI's own token cache (a refresh token alone is enough —
 * no password needed), or fall back to `EVNEX_CLIENT_USERNAME` /
 * `EVNEX_CLIENT_PASSWORD` for an MFA-free sign-in. An account with MFA
 * enabled needs `evnex auth login` run once first (it already implements
 * every challenge type end-to-end); this only ever *resumes* a session, it
 * never answers a challenge itself — duplicating that flow here would be
 * new, untested surface for a tool whose entire point is to reduce risk to
 * someone's live charger, not add to it.
 */
async function resolveLiveAuth(): Promise<EvnexAuth> {
  const cachePath = defaultTokenCachePath();
  const cached = loadTokens(cachePath);
  const auth = new EvnexAuth({
    tokens: cached,
    onTokenUpdate: createTokenSaver(cachePath),
    config: new EvnexConfig(),
  });

  if (cached !== undefined) {
    return auth;
  }

  const username = process.env["EVNEX_CLIENT_USERNAME"];
  const password = process.env["EVNEX_CLIENT_PASSWORD"];
  if (
    username === undefined ||
    password === undefined ||
    username.length === 0 ||
    password.length === 0
  ) {
    process.stderr.write(
      "No usable session. Either:\n" +
        `  1. Run \`evnex auth login\` once (writes a token cache at ${cachePath}, or ` +
        "$EVNEX_TOKEN_CACHE if set) — required if the account has MFA enabled, and this " +
        "sweep will then resume from it with no password needed, or\n" +
        "  2. Set EVNEX_CLIENT_USERNAME and EVNEX_CLIENT_PASSWORD for an MFA-free account.\n",
    );
    process.exit(1);
  }

  const result = await auth.startAuthentication(username, password);
  if (isAuthChallenge(result)) {
    process.stderr.write(
      "Sign-in requires an MFA challenge this tool does not answer itself. Run " +
        "`evnex auth login` once (it handles every challenge type), then re-run this " +
        "sweep — it will resume from the token cache `evnex auth login` writes.\n",
    );
    process.exit(1);
  }
  return auth;
}

// -- Main -----------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  let interrupted = false;
  const onSigint = (): void => {
    interrupted = true;
    process.stderr.write(
      "\nInterrupt received — stopping after the in-flight endpoint.\n",
    );
  };
  process.on("SIGINT", onSigint);

  let transport: Transport;
  let auth: AuthTokenSource;
  if (options.dryRun) {
    const harness = buildDryRunHarness();
    transport = harness.transport;
    auth = harness.auth;
  } else {
    transport = new Transport({ baseUrl: new EvnexConfig().EVNEX_BASE_URL });
    try {
      auth = await resolveLiveAuth();
    } catch (err) {
      if (err instanceof EvnexAuthError) {
        process.stderr.write(`Authentication failed: ${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  }

  process.stderr.write(
    `Schema sweep starting (${options.dryRun ? "dry-run" : "live"}), ${ENDPOINTS.length} endpoints, ` +
      `output: ${options.outDir}\n`,
  );

  const result = await runWalk({
    transport,
    auth,
    outDir: options.outDir,
    force: options.force,
    initialContext: { orgId: options.org, chargePointId: options.chargePoint },
    synthetic: options.dryRun,
    fixtureIsUpstream: options.dryRun
      ? (endpointId: string) => FIXTURE_PROVENANCE.get(endpointId) ?? false
      : undefined,
    isInterrupted: () => interrupted,
    onProgress: (record: EndpointCaptureRecord, index: number, total: number) => {
      process.stderr.write(
        `  [${index + 1}/${total}] ${record.endpoint}: ${record.outcome}\n`,
      );
    },
  });

  process.off("SIGINT", onSigint);

  const report = generateReport(result.records, {
    mode: options.dryRun ? "dry-run" : "live",
    generatedAt: new Date().toISOString(),
    orgId: result.finalContext.orgId,
    chargePointId: result.finalContext.chargePointId,
    aborted: result.aborted,
    abortReason: result.abortReason,
  });

  mkdirSync(dirname(options.reportPath), { recursive: true });
  writeFileSync(options.reportPath, report, "utf8");
  process.stderr.write(`Report written to ${options.reportPath}\n`);

  if (result.aborted) {
    process.stderr.write(
      `Sweep stopped early: ${result.abortReason ?? "unknown reason"}\n`,
    );
    process.exit(interrupted ? 130 : 1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exitCode = 1;
});
