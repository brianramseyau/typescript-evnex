/**
 * End-to-end proof that the whole pipeline (graph walk, capture, redaction,
 * diffing, report generation) runs against recorded fixtures with no
 * network and no credentials — the dry-run mode PLAN.md's D5 spec asks for
 * so the tool can be proven correct without a live account.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWalk } from "../../tools/schema-sweep/walk.js";
import {
  buildDryRunHarness,
  FIXTURE_PROVENANCE,
} from "../../tools/schema-sweep/fixtures/dryRunFixtures.js";
import { generateReport } from "../../tools/schema-sweep/report.js";
import { ENDPOINTS } from "../../tools/schema-sweep/endpoints.js";

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "evnex-sweep-dryrun-test-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("dry-run pipeline", () => {
  it("walks all 14 endpoints against fixtures with no network, and every one parses cleanly", async () => {
    const { transport, auth } = buildDryRunHarness();
    const result = await runWalk({
      transport,
      auth,
      outDir,
      synthetic: true,
      fixtureIsUpstream: (id) => FIXTURE_PROVENANCE.get(id) ?? false,
    });

    expect(result.aborted).toBe(false);
    expect(result.records).toHaveLength(ENDPOINTS.length);
    for (const record of result.records) {
      // A dry-run fixture is deliberately schema-valid (proves the pipeline
      // works; broken-payload detection is diff.test.ts's job, on synthetic
      // hand-crafted inputs, not this fixture set).
      expect(record.outcome, `${record.endpoint}: ${record.note ?? ""}`).toBe("ok");
      expect(record.synthetic).toBe(true);
    }
    expect(result.finalContext).toEqual({
      orgId: "org-0000",
      chargePointId: "cp-0000001",
      locationId: "loc-0000001",
    });
  });

  it("writes one capture file per endpoint to outDir", async () => {
    const { transport, auth } = buildDryRunHarness();
    await runWalk({ transport, auth, outDir, synthetic: true });
    for (const endpoint of ENDPOINTS) {
      expect(existsSync(join(outDir, `${endpoint.id}.json`))).toBe(true);
    }
  });

  it("marks real (upstream) fixtures and synthetic ones distinctly, and both kinds exist", async () => {
    const { transport, auth } = buildDryRunHarness();
    const result = await runWalk({
      transport,
      auth,
      outDir,
      synthetic: true,
      fixtureIsUpstream: (id) => FIXTURE_PROVENANCE.get(id) ?? false,
    });
    const upstream = result.records.filter((r) => r.fixtureIsUpstream === true);
    const synthetic = result.records.filter((r) => r.fixtureIsUpstream === false);
    expect(upstream.length).toBeGreaterThan(0);
    expect(synthetic.length).toBeGreaterThan(0);
    expect(upstream.length + synthetic.length).toBe(result.records.length);
    // The top-priority gap PARITY.md flags — no live fixture anywhere — is
    // exercised here only via a synthetic payload; this pipeline run proves
    // nothing about whether the real API agrees with it.
    const v2Detail = result.records.find((r) => r.endpoint === "chargePointDetailV2");
    expect(v2Detail?.fixtureIsUpstream).toBe(false);
  });

  it("never leaks the fixtures' PII into the redacted capture files on disk", async () => {
    const { transport, auth } = buildDryRunHarness();
    await runWalk({ transport, auth, outDir, synthetic: true });
    for (const endpoint of ENDPOINTS) {
      const text = readFileSync(join(outDir, `${endpoint.id}.json`), "utf8");
      expect(text).not.toContain("user@example.com");
      expect(text).not.toContain("SN0000001"); // the fixture serial/ocppChargePointId
    }
  });

  it("generates a complete report from the dry-run walk, carrying the unmistakable banner", async () => {
    const { transport, auth } = buildDryRunHarness();
    const result = await runWalk({
      transport,
      auth,
      outDir,
      synthetic: true,
      fixtureIsUpstream: (id) => FIXTURE_PROVENANCE.get(id) ?? false,
    });
    const report = generateReport(result.records, {
      mode: "dry-run",
      generatedAt: new Date().toISOString(),
      orgId: result.finalContext.orgId,
      chargePointId: result.finalContext.chargePointId,
      aborted: result.aborted,
    });
    expect(report).toMatch(/DRY RUN/);
    // The org id and charge point id are redacted everywhere in the rendered
    // report, not just in field-name-keyed bodies — they are account-
    // identifying values, so the raw ids must never appear even in dry-run
    // output.
    expect(report).not.toContain("org-0000");
    expect(report).not.toContain("cp-0000001");
    expect(report).toContain("<redacted:orgId>");
    expect(report).toContain("<redacted:chargePointId>");
    // Every endpoint id appears somewhere in the report.
    for (const endpoint of ENDPOINTS) {
      expect(report).toContain(endpoint.id);
    }
  });

  it("is resumable exactly like a live run: a second walk against the same outDir makes no further requests", async () => {
    const first = buildDryRunHarness();
    await runWalk({
      transport: first.transport,
      auth: first.auth,
      outDir,
      synthetic: true,
    });

    // A harness with an empty route table — if the second run tried to
    // re-fetch anything, every endpoint would fail with "no route".
    const { Transport } = await import("../../src/http/transport.js");
    const { createStubFetch } = await import("../support/stubFetch.js");
    const bareStub = createStubFetch([]);
    const bareTransport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: bareStub.fetch,
    });
    const second = await runWalk({
      transport: bareTransport,
      auth: first.auth,
      outDir,
      synthetic: true,
    });
    expect(second.records).toHaveLength(ENDPOINTS.length);
    expect(bareStub.calls).toHaveLength(0);
  });
});
