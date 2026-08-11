/**
 * Captures one endpoint: builds its request (or reports the dependency it's
 * still waiting on), sends it via `readClient.ts`, computes the schema diff
 * and the discovered context (org/charge-point/location id for later
 * endpoints) against the *unredacted* raw body — the diff so it sees real
 * values, the context extraction because the ids it reads are themselves
 * redacted in the stored body — and only then redacts the body for storage.
 * Pure with respect to disk — `walk.ts` decides when/where to persist the
 * returned record, which is what makes resumability (skip what's already on
 * disk) and the dry-run pipeline (no disk at all until the caller asks) both
 * possible from the same function.
 */

import type { Transport } from "../../src/http/transport.js";
import type { AuthTokenSource } from "../../src/http/authFlow.js";
import type { ErrorClass } from "../../src/http/retry.js";
import { computeSchemaDiff } from "./diff.js";
import { redactJson, redactRawText } from "./redact.js";
import { captureEndpointRaw } from "./readClient.js";
import type { EndpointCaptureRecord, EndpointDefinition, SweepContext } from "./types.js";
import { emptySchemaDiff } from "./types.js";

export interface CaptureEndpointOptions {
  /** Marks the record as coming from a dry-run fixture rather than a live response. */
  synthetic?: boolean;
  /** Only meaningful when `synthetic` is true — whether the fixture is a real payload inherited from test/support/fixtures.ts. */
  fixtureIsUpstream?: boolean;
  /** Injection point for a fixed clock in tests. */
  now?: () => Date;
}

function baseRecord(
  endpoint: EndpointDefinition,
  options: CaptureEndpointOptions,
): Omit<EndpointCaptureRecord, "outcome" | "diff"> {
  const now = options.now ?? (() => new Date());
  return {
    endpoint: endpoint.id,
    title: endpoint.title,
    deprecated: endpoint.deprecated,
    method: endpoint.method,
    pathTemplate: endpoint.pathTemplate,
    capturedAt: now().toISOString(),
    pythonNotes: endpoint.pythonNotes,
    synthetic: options.synthetic ?? false,
    fixtureIsUpstream: options.fixtureIsUpstream,
  };
}

/**
 * Run one endpoint to completion and return its capture record. Never
 * throws for an ordinary failure (HTTP error, timeout, invalid JSON, a
 * `ZodError`) — those are the findings this sweep exists to produce.
 * Rethrows only an `EvnexAuthError` (via `captureEndpointRaw`), which the
 * caller (`walk.ts`) treats as "stop the whole run".
 */
export async function captureEndpoint(
  transport: Transport,
  auth: AuthTokenSource,
  endpoint: EndpointDefinition,
  ctx: SweepContext,
  options: CaptureEndpointOptions = {},
): Promise<EndpointCaptureRecord> {
  const base = baseRecord(endpoint, options);

  const spec = endpoint.buildRequest(ctx);
  if (spec === undefined) {
    return {
      ...base,
      outcome: "skipped-dependency-missing",
      diff: emptySchemaDiff(),
      note: `Needs ${endpoint.requires.join(" and ")} resolved from an earlier endpoint, which did not resolve this run.`,
    };
  }

  const raw = await captureEndpointRaw(
    transport,
    auth,
    spec,
    (endpoint.nonRetryable ?? []) as readonly ErrorClass[],
  );

  if (
    raw.outcome === "http-error" ||
    raw.outcome === "timeout" ||
    raw.outcome === "exception"
  ) {
    return {
      ...base,
      outcome: raw.outcome,
      httpStatus: raw.httpStatus,
      note: raw.note,
      diff: emptySchemaDiff(),
      redactedBody: raw.rawText === undefined ? undefined : redactRawText(raw.rawText),
    };
  }

  if (raw.outcome === "invalid-json") {
    return {
      ...base,
      outcome: "invalid-json",
      httpStatus: raw.httpStatus,
      note: raw.note,
      diff: emptySchemaDiff(),
      redactedBody: raw.rawText === undefined ? undefined : redactRawText(raw.rawText),
    };
  }

  // raw.outcome === "ok" — diff against the *unredacted* body, then redact
  // for storage. The diff never touches the redacted copy: a redaction
  // marker string could otherwise itself trip a type-mismatch finding
  // (e.g. a redacted numeric coordinate reads as a string), which would be
  // this tool inventing a defect that isn't real.
  const diff = computeSchemaDiff(endpoint.schema, raw.rawJson);
  const hasBlockingFindings =
    diff.missingRequiredFields.length > 0 || diff.typeMismatches.length > 0;

  return {
    ...base,
    outcome: hasBlockingFindings ? "zod-error" : "ok",
    httpStatus: raw.httpStatus,
    diff,
    redactedBody: raw.rawJson === undefined ? undefined : redactJson(raw.rawJson),
    // Extracted from the *raw* body, before redaction — see discoveredContext's
    // doc comment on why this can no longer be re-derived from redactedBody.
    discoveredContext: endpoint.extractContext?.(raw.rawJson, ctx),
  };
}
