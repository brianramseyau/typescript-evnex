/**
 * `report.ts`'s markdown generation — the empty case (must read as a clear
 * "nothing found", never as an empty/truncated document), the dry-run
 * banner, and that every one of the four PLAN.md report items renders per
 * endpoint.
 */

import { describe, expect, it } from "vitest";
import { generateReport } from "../../tools/schema-sweep/report.js";
import type { EndpointCaptureRecord } from "../../tools/schema-sweep/types.js";
import { emptySchemaDiff } from "../../tools/schema-sweep/types.js";

function record(overrides: Partial<EndpointCaptureRecord> = {}): EndpointCaptureRecord {
  return {
    endpoint: "userDetail",
    title: "User detail",
    deprecated: false,
    method: "GET",
    pathTemplate: "/v2/apps/user",
    capturedAt: "2026-01-01T00:00:00.000Z",
    outcome: "ok",
    diff: emptySchemaDiff(),
    pythonNotes: ["a note about the python model"],
    synthetic: false,
    redactedBody: { id: "abc" },
    ...overrides,
  };
}

describe("generateReport — empty case", () => {
  it("states plainly that no divergences were found, rather than emitting a document with nothing in it", () => {
    const report = generateReport([record(), record({ endpoint: "orgLocations" })], {
      mode: "live",
      generatedAt: "2026-01-01T00:00:00.000Z",
      aborted: false,
    });
    expect(report).toContain("No divergences were found in this sweep");
    // Still a real, substantial document — not literally empty.
    expect(report.length).toBeGreaterThan(200);
    expect(report).toContain("## Summary");
  });

  it("does not print the clean-sweep banner when at least one finding exists", () => {
    const dirty = record({
      diff: { extraFields: ["surprise"], missingRequiredFields: [], typeMismatches: [] },
    });
    const report = generateReport([dirty], {
      mode: "live",
      generatedAt: "2026-01-01T00:00:00.000Z",
      aborted: false,
    });
    expect(report).not.toContain("No divergences were found in this sweep");
  });

  it("does not print the clean-sweep banner when the sweep was aborted, even with zero findings", () => {
    const report = generateReport([record()], {
      mode: "live",
      generatedAt: "2026-01-01T00:00:00.000Z",
      aborted: true,
      abortReason: "auth failure",
    });
    expect(report).not.toContain("No divergences were found in this sweep");
    expect(report).toContain("Sweep stopped early");
    expect(report).toContain("auth failure");
  });
});

describe("generateReport — dry-run banner", () => {
  it("prints an unmistakable dry-run banner live findings could not be confused with", () => {
    const report = generateReport(
      [record({ synthetic: true, fixtureIsUpstream: false })],
      {
        mode: "dry-run",
        generatedAt: "2026-01-01T00:00:00.000Z",
        aborted: false,
      },
    );
    expect(report).toMatch(/DRY RUN/);
    expect(report).toContain("NOT LIVE API EVIDENCE");
  });

  it("omits the dry-run banner entirely in live mode", () => {
    const report = generateReport([record()], {
      mode: "live",
      generatedAt: "2026-01-01T00:00:00.000Z",
      aborted: false,
    });
    expect(report).not.toMatch(/DRY RUN/);
  });

  it("labels a synthetic-but-upstream fixture differently from a wholly synthetic one", () => {
    const upstream = generateReport(
      [record({ synthetic: true, fixtureIsUpstream: true, endpoint: "a" })],
      { mode: "dry-run", generatedAt: "x", aborted: false },
    );
    expect(upstream).toContain("real payload inherited from `test/support/fixtures.ts`");

    const synthetic = generateReport(
      [record({ synthetic: true, fixtureIsUpstream: false, endpoint: "b" })],
      { mode: "dry-run", generatedAt: "x", aborted: false },
    );
    expect(synthetic).toContain("synthetic — authored for this sweep");
  });
});

describe("generateReport — per-endpoint content (report items 1-4)", () => {
  it("renders all three diff categories plus the python-model notes for an endpoint with findings", () => {
    const dirty = record({
      outcome: "zod-error",
      diff: {
        extraFields: ["data.newField"],
        missingRequiredFields: ["data.email"],
        typeMismatches: [
          {
            path: "data.maxCurrent",
            code: "invalid_type",
            message: "expected number, received string",
          },
        ],
      },
    });
    const report = generateReport([dirty], {
      mode: "live",
      generatedAt: "2026-01-01T00:00:00.000Z",
      aborted: false,
    });
    expect(report).toContain("`data.newField`");
    expect(report).toContain("`data.email`");
    expect(report).toContain("data.maxCurrent");
    expect(report).toContain("expected number, received string");
    expect(report).toContain("a note about the python model");
    expect(report).toContain("§10.1-class defect");
  });

  it("explicitly disclaims that a clean field is proven required, not merely observed", () => {
    const report = generateReport([record()], {
      mode: "live",
      generatedAt: "x",
      aborted: false,
    });
    expect(report).toContain("does not prove any field is");
  });

  it("never emits the response body outside the redacted-body block — i.e. it trusts redactedBody completely and does not re-derive anything from elsewhere", () => {
    const secretLooking = record({
      redactedBody: { email: "<redacted:email>", note: "clean" },
    });
    const report = generateReport([secretLooking], {
      mode: "live",
      generatedAt: "x",
      aborted: false,
    });
    expect(report).toContain("<redacted:email>");
    expect(report).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("marks a deprecated endpoint in both the summary table and its own section", () => {
    const report = generateReport(
      [record({ deprecated: true, endpoint: "chargePointDetailV2" })],
      { mode: "live", generatedAt: "x", aborted: false },
    );
    expect(report).toContain("*(deprecated)*");
    expect(report).toContain("(deprecated)");
  });

  it("truncates a very large redacted body rather than inlining it whole", () => {
    const bigArray = Array.from({ length: 2000 }, (_, i) => ({ id: i }));
    const report = generateReport([record({ redactedBody: bigArray })], {
      mode: "live",
      generatedAt: "x",
      aborted: false,
    });
    expect(report).toContain("(truncated)");
  });

  it("renders an empty-body outcome without crashing", () => {
    const report = generateReport([record({ redactedBody: undefined })], {
      mode: "live",
      generatedAt: "x",
      aborted: false,
    });
    expect(report).toContain("empty response body");
  });

  it("covers every documented outcome label without throwing", () => {
    const outcomes: EndpointCaptureRecord["outcome"][] = [
      "ok",
      "zod-error",
      "invalid-json",
      "http-error",
      "timeout",
      "exception",
      "skipped-cached",
      "skipped-dependency-missing",
    ];
    for (const outcome of outcomes) {
      const report = generateReport(
        [record({ outcome, endpoint: `endpoint-${outcome}` })],
        {
          mode: "live",
          generatedAt: "x",
          aborted: false,
        },
      );
      expect(report.length).toBeGreaterThan(0);
    }
  });
});
