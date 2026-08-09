/**
 * `capture.ts`'s per-endpoint orchestration: dependency-missing skips,
 * outcome classification (ok vs. zod-error, extra fields alone don't fail
 * validation), and — critically — that the diff runs against the
 * *unredacted* body while only the *redacted* copy is ever returned for
 * storage.
 */

import { z } from "zod";
import { describe, expect, it } from "vitest";
import { captureEndpoint } from "../../tools/schema-sweep/capture.js";
import { Transport } from "../../src/http/transport.js";
import type { AuthTokenSource } from "../../src/http/authFlow.js";
import type { EndpointDefinition } from "../../tools/schema-sweep/types.js";
import { createStubFetch } from "../support/stubFetch.js";

function fakeAuth(): AuthTokenSource {
  return {
    getAccessToken: () => Promise.resolve("access-token"),
    forceRefresh: () => Promise.resolve(undefined),
  };
}

const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");

function endpointFixture(
  overrides: Partial<EndpointDefinition> = {},
): EndpointDefinition {
  return {
    id: "testEndpoint",
    title: "Test endpoint",
    deprecated: false,
    requires: ["chargePoint"],
    method: "GET",
    pathTemplate: "/charge-points/{chargePointId}",
    buildRequest: (ctx) =>
      ctx.chargePointId === undefined
        ? undefined
        : { method: "GET", path: `/charge-points/${ctx.chargePointId}` },
    schema: z.object({ email: z.string(), serial: z.string(), maxCurrent: z.number() }),
    pythonNotes: ["a note"],
    ...overrides,
  };
}

describe("captureEndpoint", () => {
  it("returns skipped-dependency-missing without sending a request when a required id is unresolved", async () => {
    const stub = createStubFetch([]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const record = await captureEndpoint(
      transport,
      fakeAuth(),
      endpointFixture(),
      {},
      { now: FIXED_NOW },
    );
    expect(record.outcome).toBe("skipped-dependency-missing");
    expect(stub.calls).toHaveLength(0);
    expect(record.note).toContain("chargePoint");
  });

  it("classifies a schema-valid response as ok, with an empty diff", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/charge-points/cp-1",
        json: { email: "a@example.com", serial: "SN1", maxCurrent: 32 },
      },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const record = await captureEndpoint(
      transport,
      fakeAuth(),
      endpointFixture(),
      { chargePointId: "cp-1" },
      { now: FIXED_NOW },
    );
    expect(record.outcome).toBe("ok");
    expect(record.diff).toEqual({
      extraFields: [],
      missingRequiredFields: [],
      typeMismatches: [],
    });
    expect(record.capturedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("classifies a response missing a required field as zod-error", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/charge-points/cp-1",
        json: { serial: "SN1", maxCurrent: 32 },
      },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const record = await captureEndpoint(
      transport,
      fakeAuth(),
      endpointFixture(),
      { chargePointId: "cp-1" },
      { now: FIXED_NOW },
    );
    expect(record.outcome).toBe("zod-error");
    expect(record.diff.missingRequiredFields).toContain("email");
  });

  it("does NOT classify a response with only extra fields as zod-error — extra fields alone still parse", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/charge-points/cp-1",
        json: { email: "a@example.com", serial: "SN1", maxCurrent: 32, brandNew: true },
      },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const record = await captureEndpoint(
      transport,
      fakeAuth(),
      endpointFixture(),
      { chargePointId: "cp-1" },
      { now: FIXED_NOW },
    );
    expect(record.outcome).toBe("ok");
    expect(record.diff.extraFields).toEqual(["brandNew"]);
  });

  it("redacts the stored body while the diff still sees the real (sensitive) values", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/charge-points/cp-1",
        json: { email: "a@example.com", serial: "SN1", maxCurrent: 32 },
      },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const record = await captureEndpoint(
      transport,
      fakeAuth(),
      endpointFixture(),
      { chargePointId: "cp-1" },
      { now: FIXED_NOW },
    );
    // The diff parsed cleanly (real email accepted by z.string()) ...
    expect(record.outcome).toBe("ok");
    // ... but the stored body never carries the real value.
    const body = record.redactedBody as Record<string, unknown>;
    expect(body["email"]).toBe("<redacted:email>");
    expect(body["serial"]).toBe("<redacted:serial>");
    expect(JSON.stringify(record)).not.toContain("a@example.com");
  });

  it("redacts a non-JSON body as text on invalid-json, still recording the outcome", async () => {
    // StubRoute's `json` field always serialises to JSON, so a raw non-JSON
    // body needs the dynamic `handler` form instead.
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/charge-points/cp-1",
        handler: () =>
          new Response("contact person@example.com for help", { status: 200 }),
      },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const record = await captureEndpoint(
      transport,
      fakeAuth(),
      endpointFixture(),
      { chargePointId: "cp-1" },
      { now: FIXED_NOW },
    );
    expect(record.outcome).toBe("invalid-json");
    expect(record.redactedBody).not.toContain("person@example.com");
    expect(record.redactedBody).toContain("<redacted:email>");
  });

  it("marks the record synthetic and carries fixture provenance through when asked", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/charge-points/cp-1",
        json: { email: "a@example.com", serial: "SN1", maxCurrent: 32 },
      },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const record = await captureEndpoint(
      transport,
      fakeAuth(),
      endpointFixture(),
      { chargePointId: "cp-1" },
      { now: FIXED_NOW, synthetic: true, fixtureIsUpstream: true },
    );
    expect(record.synthetic).toBe(true);
    expect(record.fixtureIsUpstream).toBe(true);
  });

  it("records an http-error outcome for a non-2xx response without throwing", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/charge-points/cp-1",
        status: 503,
        json: { message: "down" },
      },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const record = await captureEndpoint(
      transport,
      fakeAuth(),
      endpointFixture(),
      { chargePointId: "cp-1" },
      { now: FIXED_NOW },
    );
    expect(record.outcome).toBe("http-error");
    expect(record.httpStatus).toBe(503);
  });

  it("carries the endpoint's deprecated flag and pythonNotes through unchanged", async () => {
    const stub = createStubFetch([]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const record = await captureEndpoint(
      transport,
      fakeAuth(),
      endpointFixture({ deprecated: true, pythonNotes: ["note a", "note b"] }),
      {},
      { now: FIXED_NOW },
    );
    expect(record.deprecated).toBe(true);
    expect(record.pythonNotes).toEqual(["note a", "note b"]);
  });
});
