/**
 * Diffing logic tests — report items 1-3 (PLAN.md's D5 spec). Uses the
 * project's own schemas (the sweep's real targets) plus a couple of
 * hand-built zod schemas to exercise wrapper unwrapping (optional/nullable/
 * default/transform/union/record) directly, independent of which real
 * schemas happen to use which wrapper today.
 */

import { z } from "zod";
import { describe, expect, it } from "vitest";
import { computeSchemaDiff } from "../../tools/schema-sweep/diff.js";
import {
  EvnexChargePoint,
  EvnexChargePointConnectorMeter,
  EvnexChargePointOverrideConfig,
} from "../../src/schema/chargePoints.js";
import { EvnexGetUserResponse } from "../../src/schema/user.js";
import { chargePointItem, USER_PAYLOAD } from "../support/fixtures.js";

describe("computeSchemaDiff — missing required fields (report item 2)", () => {
  it("reports a top-level required field the wire omitted", () => {
    const withoutEmail: Record<string, unknown> = { ...USER_PAYLOAD.data };
    delete withoutEmail["email"];
    const diff = computeSchemaDiff(EvnexGetUserResponse, { data: withoutEmail });
    expect(diff.missingRequiredFields).toContain("data.email");
  });

  it("reports zero missing fields for a fully valid payload", () => {
    const diff = computeSchemaDiff(EvnexGetUserResponse, USER_PAYLOAD);
    expect(diff.missingRequiredFields).toEqual([]);
    expect(diff.typeMismatches).toEqual([]);
  });

  it("does not report an optional field's absence as missing", () => {
    // EvnexUserDetail.name is .nullish() — omit it entirely.
    const withoutName: Record<string, unknown> = { ...USER_PAYLOAD.data };
    delete withoutName["name"];
    const diff = computeSchemaDiff(EvnexGetUserResponse, { data: withoutName });
    expect(diff.missingRequiredFields).toEqual([]);
  });

  it("finds a missing field nested inside an array element", () => {
    const point = chargePointItem("cp-1", "Garage", "SN1") as Record<string, unknown>;
    delete point["maxCurrent"];
    const diff = computeSchemaDiff(EvnexChargePoint, point);
    expect(diff.missingRequiredFields).toContain("maxCurrent");
  });
});

describe("computeSchemaDiff — type/shape mismatches (report item 3)", () => {
  it("reports a number arriving as a string", () => {
    const point = chargePointItem("cp-1", "Garage", "SN1") as Record<string, unknown>;
    point["maxCurrent"] = "32"; // should be a number
    const diff = computeSchemaDiff(EvnexChargePoint, point);
    expect(diff.typeMismatches.some((m) => m.path === "maxCurrent")).toBe(true);
    expect(diff.missingRequiredFields).not.toContain("maxCurrent");
  });

  it("reports a date that does not coerce", () => {
    const point = chargePointItem("cp-1", "Garage", "SN1") as Record<string, unknown>;
    point["createdDate"] = "not-a-date";
    const diff = computeSchemaDiff(EvnexChargePoint, point);
    expect(diff.typeMismatches.some((m) => m.path === "createdDate")).toBe(true);
  });

  it("reports an unrecognised union branch", () => {
    const diff = computeSchemaDiff(EvnexChargePointOverrideConfig, {
      chargeNow: "Enabled",
    });
    expect(diff.typeMismatches.length).toBeGreaterThan(0);
    expect(diff.typeMismatches[0]?.path).toBe("chargeNow");
  });

  it("carries the zod message verbatim without ever including the actual wire value", () => {
    const diff = computeSchemaDiff(EvnexChargePointOverrideConfig, {
      chargeNow: "a-genuinely-secret-looking-value",
    });
    for (const mismatch of diff.typeMismatches) {
      expect(mismatch.message).not.toContain("a-genuinely-secret-looking-value");
    }
  });
});

describe("computeSchemaDiff — extra fields (report item 1)", () => {
  it("finds a wholly new top-level field", () => {
    const diff = computeSchemaDiff(EvnexGetUserResponse, {
      data: USER_PAYLOAD.data,
      newTopLevelField: true,
    });
    expect(diff.extraFields).toContain("newTopLevelField");
  });

  it("finds a new field nested inside an object", () => {
    const withExtra = {
      data: {
        ...USER_PAYLOAD.data,
        organisations: [{ ...USER_PAYLOAD.data.organisations[0], newOrgField: 1 }],
      },
    };
    const diff = computeSchemaDiff(EvnexGetUserResponse, withExtra);
    expect(diff.extraFields).toContain("data.organisations[0].newOrgField");
  });

  it("finds a new field inside a .transform()-based schema (the connector meter's register->rawRegister rename)", () => {
    const diff = computeSchemaDiff(EvnexChargePointConnectorMeter, {
      powerType: "AC_1_PHASE",
      updatedDate: "2024-06-01T00:00:00Z",
      power: 0,
      register: 12345.6,
      frequency: 50,
      brandNewField: "surprise",
    });
    expect(diff.extraFields).toEqual(["brandNewField"]);
  });

  it("does not flag a legitimately declared field as extra", () => {
    const diff = computeSchemaDiff(EvnexGetUserResponse, USER_PAYLOAD);
    expect(diff.extraFields).toEqual([]);
  });

  it("does not flag any key inside an open z.record() as extra", () => {
    const schema = z.object({ meta: z.record(z.string(), z.unknown()) });
    const diff = computeSchemaDiff(schema, { meta: { anything: 1, goes: 2 } });
    expect(diff.extraFields).toEqual([]);
  });

  it("still finds an extra field nested inside a z.record()'s declared value shape", () => {
    const schema = z.object({
      meta: z.record(z.string(), z.object({ known: z.string() })),
    });
    const diff = computeSchemaDiff(schema, { meta: { a: { known: "x", unknown: "y" } } });
    expect(diff.extraFields).toEqual(["meta.a.unknown"]);
  });

  it("recurses through optional/nullable/default wrappers to keep finding extra fields", () => {
    const schema = z.object({
      inner: z.object({ known: z.string() }).nullish().default({ known: "x" }),
    });
    const diff = computeSchemaDiff(schema, { inner: { known: "y", surprise: 1 } });
    expect(diff.extraFields).toEqual(["inner.surprise"]);
  });

  it("picks the matching union branch to check for extra fields, not just the first declared option", () => {
    const schema = z.object({
      value: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
    });
    const diff = computeSchemaDiff(schema, { value: { b: "x", extra: 1 } });
    expect(diff.extraFields).toEqual(["value.extra"]);
  });

  it("does not recurse into a null value even where the schema declares a nested object", () => {
    const schema = z.object({ inner: z.object({ known: z.string() }).nullish() });
    const diff = computeSchemaDiff(schema, { inner: null });
    expect(diff.extraFields).toEqual([]);
  });
});

describe("computeSchemaDiff — a genuinely clean, fully valid payload", () => {
  it("returns all-empty findings", () => {
    const point = chargePointItem("cp-1", "Garage", "SN1");
    const diff = computeSchemaDiff(EvnexChargePoint, point);
    expect(diff).toEqual({
      extraFields: [],
      missingRequiredFields: [],
      typeMismatches: [],
    });
  });
});
