/**
 * Walks the resource graph in `endpoints.ts`, one endpoint at a time,
 * sequentially — PLAN.md's D5 sweep: "Sequential, one shot per endpoint,
 * honouring the retry policy. This is someone's charger, not a load test."
 *
 * **Resumability.** Before calling an endpoint, checks whether
 * `<outDir>/<endpoint-id>.json` already exists; if so (and `force` was not
 * passed) it is loaded instead of re-fetched. Every fresh capture is written
 * to disk immediately after it completes — not accumulated in memory and
 * flushed at the end — so a token expiry, a transient failure escaping the
 * retry policy, or a Ctrl-C partway through leaves every endpoint captured
 * so far still on disk for the next run to pick up.
 *
 * **Failure is data.** An `EvnexAuthError` (persistent 401, an expired
 * refresh token, ...) is the only thing that stops the walk early — every
 * other failure `capture.ts` already turned into a normal record, and the
 * walk simply moves on to the next endpoint. A user interrupt is checked
 * cooperatively between endpoints via `isInterrupted`, so an in-flight
 * request is allowed to finish (bounded by `Transport`'s own timeout) rather
 * than aborted mid-flight, but no new endpoint starts afterward.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EvnexAuthError } from "../../src/errors.js";
import type { AuthTokenSource } from "../../src/http/authFlow.js";
import type { Transport } from "../../src/http/transport.js";
import { captureEndpoint } from "./capture.js";
import { ENDPOINTS } from "./endpoints.js";
import type { EndpointCaptureRecord, EndpointDefinition, SweepContext } from "./types.js";

export interface WalkOptions {
  transport: Transport;
  auth: AuthTokenSource;
  /** Directory each endpoint's capture is written to, one JSON file per endpoint id. */
  outDir: string;
  /** Overrides the resource graph walked — defaults to the real `ENDPOINTS` (endpoints.ts). A test seam; the CLI never sets this. */
  endpoints?: readonly EndpointDefinition[];
  /** Re-fetch every endpoint even if a prior capture exists on disk. Default false. */
  force?: boolean;
  /** Seed context — e.g. an operator-supplied --org/--charge-point, which always wins over anything discovered mid-walk. */
  initialContext?: SweepContext;
  /** Marks every record this run produces as dry-run/fixture-derived. */
  synthetic?: boolean;
  /** Only consulted when `synthetic` is true. */
  fixtureIsUpstream?: (endpointId: string) => boolean;
  now?: () => Date;
  /** Checked between endpoints (not mid-request) — return true to stop the walk after the current endpoint finishes. */
  isInterrupted?: () => boolean;
  /** Called after each endpoint (cached or freshly captured) resolves. */
  onProgress?: (record: EndpointCaptureRecord, index: number, total: number) => void;
}

export interface WalkResult {
  records: EndpointCaptureRecord[];
  aborted: boolean;
  abortReason?: string;
  /** The org/charge-point ids resolved by the end of the walk (seeded ones and/or ones discovered along the way). */
  finalContext: SweepContext;
}

function captureFilePath(outDir: string, endpointId: string): string {
  return join(outDir, `${endpointId}.json`);
}

function loadCached(path: string): EndpointCaptureRecord | undefined {
  try {
    const text = readFileSync(path, "utf8");
    return JSON.parse(text) as EndpointCaptureRecord;
  } catch {
    return undefined;
  }
}

function mergeDiscovered(
  ctx: SweepContext,
  discovered: Partial<SweepContext>,
): SweepContext {
  // Anything already resolved (explicit --org/--charge-point, or an earlier
  // endpoint in this same walk) always wins — discovery only fills gaps.
  return {
    orgId: ctx.orgId ?? discovered.orgId,
    chargePointId: ctx.chargePointId ?? discovered.chargePointId,
  };
}

export async function runWalk(options: WalkOptions): Promise<WalkResult> {
  mkdirSync(options.outDir, { recursive: true });

  let ctx: SweepContext = { ...options.initialContext };
  const records: EndpointCaptureRecord[] = [];
  const endpoints = options.endpoints ?? ENDPOINTS;

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    /* v8 ignore next -- index is always within [0, endpoints.length), so this is never undefined */
    if (endpoint === undefined) continue;

    if (options.isInterrupted?.()) {
      return {
        records,
        aborted: true,
        abortReason: "Interrupted by the operator.",
        finalContext: ctx,
      };
    }

    const filePath = captureFilePath(options.outDir, endpoint.id);
    const cached = options.force ? undefined : loadCached(filePath);

    let record: EndpointCaptureRecord;
    if (cached !== undefined) {
      record = cached;
    } else {
      try {
        record = await captureEndpoint(options.transport, options.auth, endpoint, ctx, {
          synthetic: options.synthetic,
          fixtureIsUpstream: options.fixtureIsUpstream?.(endpoint.id),
          now: options.now,
        });
      } catch (err) {
        if (err instanceof EvnexAuthError) {
          return {
            records,
            aborted: true,
            abortReason: `Authentication failure on "${endpoint.id}": ${err.message}`,
            finalContext: ctx,
          };
        }
        throw err;
      }
      writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");
    }

    records.push(record);
    options.onProgress?.(record, index, endpoints.length);

    if (endpoint.extractContext) {
      ctx = mergeDiscovered(ctx, endpoint.extractContext(record.redactedBody, ctx));
    }
  }

  return { records, aborted: false, finalContext: ctx };
}
