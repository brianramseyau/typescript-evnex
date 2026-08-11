/**
 * `walk.ts`'s orchestration: resumability (skip what's already on disk,
 * write each capture immediately), context discovery flowing between
 * endpoints (explicit values always win over discovered ones), stopping
 * early on an auth failure, and cooperative interruption between endpoints.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWalk } from "../../tools/schema-sweep/walk.js";
import * as endpointsModule from "../../tools/schema-sweep/endpoints.js";
import { Transport } from "../../src/http/transport.js";
import type { AuthTokenSource } from "../../src/http/authFlow.js";
import type { EndpointDefinition } from "../../tools/schema-sweep/types.js";
import { createStubFetch } from "../support/stubFetch.js";

function fakeAuth(overrides: Partial<AuthTokenSource> = {}): AuthTokenSource {
  return {
    getAccessToken: () => Promise.resolve("access-token"),
    forceRefresh: () => Promise.resolve(undefined),
    ...overrides,
  };
}

/**
 * Run `fn` under fake timers so a route the stub has no handler for — which
 * throws a plain `Error`, not in `withRetry`'s standing non-retryable set —
 * costs no real wall-clock time working through all 5 attempts. Same
 * pattern as `test/api.test.ts`'s own `withFakeTimers` helper.
 */
async function withFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const promise = fn();
    await vi.runAllTimersAsync();
    return await promise;
  } finally {
    vi.useRealTimers();
  }
}

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "evnex-sweep-walk-test-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("runWalk", () => {
  it("writes one JSON file per endpoint id and returns a matching record for each", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/v2/apps/user",
        json: { data: { organisations: [{ id: "org-9" }] } },
      },
    ]);
    // Everything past userDetail needs org/chargePoint context this stub
    // never provides real routes for — that's fine, they resolve to
    // skipped-dependency-missing or http-error, both of which still write a
    // file; the point of this test is the one-file-per-endpoint mechanic.
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const result = await withFakeTimers(() =>
      runWalk({ transport, auth: fakeAuth(), outDir }),
    );

    expect(result.aborted).toBe(false);
    expect(result.records).toHaveLength(endpointsModule.ENDPOINTS.length);
    for (const endpoint of endpointsModule.ENDPOINTS) {
      expect(existsSync(join(outDir, `${endpoint.id}.json`))).toBe(true);
    }
    expect(result.finalContext.orgId).toBe("org-9");
  });

  it("discovers org id from userDetail and charge point id from orgChargePoints, threading both into later endpoints", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/v2/apps/user",
        json: { data: { organisations: [{ id: "org-42" }] } },
      },
      {
        method: "GET",
        path: "/v2/apps/organisations/org-42/charge-points",
        json: { data: { items: [{ id: "cp-99" }] } },
      },
      { method: "GET", path: "/charge-points/cp-99", json: { data: { attributes: {} } } },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const result = await withFakeTimers(() =>
      runWalk({ transport, auth: fakeAuth(), outDir }),
    );

    expect(result.finalContext).toEqual({ orgId: "org-42", chargePointId: "cp-99" });
    const detailV3 = result.records.find((r) => r.endpoint === "chargePointDetailV3");
    expect(detailV3?.outcome).not.toBe("skipped-dependency-missing");
  });

  it("an explicit initialContext id always wins over one discovered mid-walk", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/v2/apps/user",
        json: { data: { organisations: [{ id: "org-discovered" }] } },
      },
      {
        method: "GET",
        path: "/v2/apps/organisations/org-explicit/charge-points",
        json: { data: { items: [] } },
      },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const result = await withFakeTimers(() =>
      runWalk({
        transport,
        auth: fakeAuth(),
        outDir,
        initialContext: { orgId: "org-explicit" },
      }),
    );
    expect(result.finalContext.orgId).toBe("org-explicit");
  });

  it("resumability: a second run with the same outDir skips every endpoint already captured (no new requests)", async () => {
    const stub = createStubFetch([
      { method: "GET", path: "/v2/apps/user", json: { data: { organisations: [] } } },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    await withFakeTimers(() => runWalk({ transport, auth: fakeAuth(), outDir }));
    const callsAfterFirstRun = stub.calls.length;
    expect(callsAfterFirstRun).toBeGreaterThan(0);

    stub.reset();
    const second = await withFakeTimers(() =>
      runWalk({ transport, auth: fakeAuth(), outDir }),
    );
    expect(stub.calls).toHaveLength(0);
    expect(second.records).toHaveLength(endpointsModule.ENDPOINTS.length);
  });

  it("--force re-fetches every endpoint even when a capture already exists on disk", async () => {
    const stub = createStubFetch([
      { method: "GET", path: "/v2/apps/user", json: { data: { organisations: [] } } },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    await withFakeTimers(() => runWalk({ transport, auth: fakeAuth(), outDir }));
    stub.reset();

    await withFakeTimers(() =>
      runWalk({ transport, auth: fakeAuth(), outDir, force: true }),
    );
    expect(stub.callsFor("GET", "/v2/apps/user")).toHaveLength(1);
  });

  it("a cached capture's discoveredContext (extracted from the raw body at capture time) still drives context discovery on resume, even though ids are redacted in the stored body itself", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/v2/apps/user",
        json: { data: { organisations: [{ id: "org-cached" }] } },
      },
      {
        method: "GET",
        path: "/v2/apps/organisations/org-cached/charge-points",
        json: { data: { items: [{ id: "cp-cached" }] } },
      },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    await withFakeTimers(() => runWalk({ transport, auth: fakeAuth(), outDir }));

    // The persisted capture file's redactedBody has the org/charge point id
    // itself redacted (any key equal to or ending in "id" — redact.ts), so
    // this assertion also proves resume does not depend on reading them back
    // out of that body.
    const cachedUserDetail = JSON.parse(
      readFileSync(join(outDir, "userDetail.json"), "utf8"),
    ) as { redactedBody: { data: { organisations: Array<{ id: string }> } } };
    expect(cachedUserDetail.redactedBody.data.organisations[0]?.id).toBe("<redacted:id>");

    // Second run: no routes needed at all for userDetail/orgChargePoints —
    // if context discovery required a fresh request, this would throw
    // "no route for GET ...".
    const bareStub = createStubFetch([]);
    const bareTransport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: bareStub.fetch,
    });
    const result = await withFakeTimers(() =>
      runWalk({ transport: bareTransport, auth: fakeAuth(), outDir }),
    );
    expect(result.finalContext).toEqual({
      orgId: "org-cached",
      chargePointId: "cp-cached",
    });
  });

  it("stops early and reports abortReason on a persistent 401, keeping everything captured so far", async () => {
    const stub = createStubFetch([
      { method: "GET", path: "/v2/apps/user", json: { data: { organisations: [] } } },
      { method: "GET", path: "/v2/apps/organisations/org-0/charge-points", status: 401 },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    const result = await runWalk({
      transport,
      auth: fakeAuth(),
      outDir,
      initialContext: { orgId: "org-0" },
    });

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toMatch(/orgChargePoints/);
    // userDetail ran and was written; the walk stopped at orgChargePoints, so nothing after it ran.
    expect(existsSync(join(outDir, "userDetail.json"))).toBe(true);
    expect(existsSync(join(outDir, "chargePointDetailV3.json"))).toBe(false);
  });

  it("rethrows a non-auth error rather than swallowing it (capture.ts's own contract, not walk.ts's job to hide)", async () => {
    const badEndpoint: EndpointDefinition = {
      id: "broken",
      title: "broken",
      deprecated: false,
      requires: [],
      method: "GET",
      pathTemplate: "/broken",
      buildRequest: () => {
        throw new TypeError("boom");
      },
      schema: z.object({}),
      pythonNotes: [],
    };
    const stub = createStubFetch([]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    await expect(
      runWalk({ transport, auth: fakeAuth(), outDir, endpoints: [badEndpoint] }),
    ).rejects.toThrow(TypeError);
  });

  it("stops (without writing further captures) once isInterrupted reports true, ahead of the next endpoint", async () => {
    const stub = createStubFetch([
      { method: "GET", path: "/v2/apps/user", json: { data: { organisations: [] } } },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    let calls = 0;
    const result = await runWalk({
      transport,
      auth: fakeAuth(),
      outDir,
      isInterrupted: () => {
        calls += 1;
        return calls > 1; // let the first endpoint run, stop before the second
      },
    });
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toMatch(/Interrupted/);
    expect(result.records).toHaveLength(1);
  });

  it("onProgress fires once per endpoint processed, cached or fresh", async () => {
    const stub = createStubFetch([
      { method: "GET", path: "/v2/apps/user", json: { data: { organisations: [] } } },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    let progressCalls = 0;
    await withFakeTimers(() =>
      runWalk({
        transport,
        auth: fakeAuth(),
        outDir,
        onProgress: () => {
          progressCalls += 1;
        },
      }),
    );
    expect(progressCalls).toBe(endpointsModule.ENDPOINTS.length);
  });

  it("stores every capture with the synthetic flag and fixture provenance callback applied", async () => {
    const stub = createStubFetch([
      { method: "GET", path: "/v2/apps/user", json: { data: { organisations: [] } } },
    ]);
    const transport = new Transport({
      baseUrl: "https://client-api.evnex.io",
      fetch: stub.fetch,
    });
    await withFakeTimers(() =>
      runWalk({
        transport,
        auth: fakeAuth(),
        outDir,
        synthetic: true,
        fixtureIsUpstream: (id) => id === "userDetail",
      }),
    );
    const stored = JSON.parse(readFileSync(join(outDir, "userDetail.json"), "utf8")) as {
      synthetic: boolean;
      fixtureIsUpstream: boolean;
    };
    expect(stored.synthetic).toBe(true);
    expect(stored.fixtureIsUpstream).toBe(true);
  });
});
