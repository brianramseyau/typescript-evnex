/**
 * Shared types for the schema sweep. No runtime behaviour lives here — pure
 * type/interface declarations, so importing this file can never have a
 * side effect.
 */

import type { z } from "zod";
import type { RequestSpec } from "../../src/http/transport.js";
import type { ErrorClass } from "../../src/http/retry.js";

/** What the sweep resolves as it walks the graph — org id, then a charge point id, then a location id. */
export interface SweepContext {
  orgId?: string | undefined;
  chargePointId?: string | undefined;
  /**
   * Discovered opportunistically (not needed to build any request path, only
   * to redact it): a location id ties directly to a physical address
   * (PLAN.md's D5 sweep found the residential address itself is not
   * key-redactable everywhere it's echoed), so it gets the same
   * global-value redaction treatment as orgId/chargePointId in the report.
   */
  locationId?: string | undefined;
}

/** How an endpoint's single attempt this run concluded. */
export type CaptureOutcome =
  | "ok"
  | "zod-error"
  | "invalid-json"
  | "http-error"
  | "timeout"
  | "exception"
  | "skipped-cached"
  | "skipped-dependency-missing";

export interface TypeMismatch {
  /** Dotted path into the response body, e.g. "data.attributes.maxCurrent". */
  path: string;
  /** The zod issue code (e.g. "invalid_type", "invalid_union"). */
  code: string;
  /** The zod issue message, verbatim — never includes the actual wire value (PLAN.md redaction requirement). */
  message: string;
}

/** The three structural findings the sweep computes directly from a captured body + its schema. */
export interface SchemaDiff {
  /** Dotted paths the wire sent that the schema does not declare — additions we silently drop. */
  extraFields: string[];
  /** Dotted paths the schema requires that the wire omitted entirely — the §10.1 class of defect. */
  missingRequiredFields: string[];
  /** Everything else zod flagged: wrong type, wrong shape, an envelope mismatch, etc. */
  typeMismatches: TypeMismatch[];
}

export function emptySchemaDiff(): SchemaDiff {
  return { extraFields: [], missingRequiredFields: [], typeMismatches: [] };
}

export function schemaDiffIsEmpty(diff: SchemaDiff): boolean {
  return (
    diff.extraFields.length === 0 &&
    diff.missingRequiredFields.length === 0 &&
    diff.typeMismatches.length === 0
  );
}

/** One endpoint's result for this run — what gets written to disk and fed to the report. */
export interface EndpointCaptureRecord {
  endpoint: string;
  title: string;
  deprecated: boolean;
  method: string;
  /** Path template, e.g. "/charge-points/{chargePointId}/sessions" — never the resolved id-bearing path, so this alone never needs redaction. */
  pathTemplate: string;
  capturedAt: string;
  outcome: CaptureOutcome;
  httpStatus?: number | undefined;
  /** Present only for outcome "http-error" / "timeout" / "exception" / "skipped-*" — never includes a raw response body. */
  note?: string | undefined;
  diff: SchemaDiff;
  /** Free-text notes on how this endpoint's Python model compares — hand-researched, see pythonModel.ts. */
  pythonNotes: readonly string[];
  /** True when this run's body came from a dry-run fixture, not a live response. */
  synthetic: boolean;
  /** True when the fixture backing a dry-run capture is a real payload inherited from test/support/fixtures.ts (only meaningful when synthetic is true). */
  fixtureIsUpstream?: boolean | undefined;
  /** The redacted response body — a JSON value for a parsed body, or a redacted string for one that failed JSON.parse. Never the raw unredacted body. */
  redactedBody?: unknown;
  /**
   * Context (org/charge-point/location id) this endpoint's *raw* body
   * yielded, captured before redaction ran. Ids are themselves redacted in
   * `redactedBody` (any key equal to or ending in "id" — see redact.ts), so
   * on a resumed run `walk.ts` must not try to re-derive context by reading
   * ids back out of the persisted, already-redacted body; it reads this
   * field instead. This value is written to the (gitignored)
   * `schema-sweep-output/` cache file — never into the committed report,
   * which only ever sees `redactedBody`.
   */
  discoveredContext?: Partial<SweepContext> | undefined;
}

export interface EndpointDefinition {
  id: string;
  title: string;
  deprecated: boolean;
  /** What this endpoint needs resolved from earlier endpoints before it can run. */
  requires: readonly ("org" | "chargePoint")[];
  method: string;
  /** Path template for reporting — "{orgId}"/"{chargePointId}" placeholders. */
  pathTemplate: string;
  /** Build the real request, or `undefined` if a required id is not resolved yet. */
  buildRequest: (ctx: SweepContext) => RequestSpec | undefined;
  /** The schema this endpoint's real client method validates the response against. */
  schema: z.ZodTypeAny;
  /** Extra non-retryable error classes, mirroring this endpoint's real client method in src/api.ts. */
  nonRetryable?: readonly ErrorClass[];
  /** Hand-researched free-text comparison against the Python model for this endpoint (report item 4). */
  pythonNotes: readonly string[];
  /**
   * Best-effort extraction of context for later endpoints (org id from user
   * detail, charge point id from the charge point list) from a *raw* parsed
   * body — deliberately not dependent on schema validation succeeding, so a
   * malformed-but-still-navigable response doesn't stall the whole walk.
   */
  extractContext?: (rawJson: unknown, ctx: SweepContext) => Partial<SweepContext>;
}
