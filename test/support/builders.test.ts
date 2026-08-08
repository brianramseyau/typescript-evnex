/**
 * `makeJwt` is self-contained and testable today. `makeAuth` / `makeResumedAuth`
 * / `makeClient` are thin composition over `EvnexAuth` (A6/A7/B1/B2) and
 * `Evnex` (B3), which are still `TODO(...)` stubs in Wave 1 — they are typed
 * and exported here as the contract those later waves code against, but
 * exercising them meaningfully has to wait until those modules land (their
 * own test suites will do that). See A9's report.
 */

import { describe, expect, it } from "vitest";
import { makeJwt } from "./builders.js";

function decodePayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("makeJwt", () => {
  it("produces a structurally valid three-segment token", () => {
    const token = makeJwt();
    expect(token.split(".")).toHaveLength(3);
  });

  it("defaults to a 24-hour expiry", () => {
    const before = Date.now();
    const { exp } = decodePayload(makeJwt());
    expect(typeof exp).toBe("number");
    const expiresAt = (exp as number) * 1000;
    expect(expiresAt).toBeGreaterThan(before + 23 * 60 * 60 * 1000);
    expect(expiresAt).toBeLessThan(before + 25 * 60 * 60 * 1000);
  });

  it("accepts a custom expiresIn, including a negative one for an already-expired token", () => {
    const { exp } = decodePayload(makeJwt({ expiresIn: -60_000 }));
    expect((exp as number) * 1000).toBeLessThan(Date.now());
  });
});
