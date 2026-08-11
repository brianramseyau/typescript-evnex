/**
 * Redaction is the highest-risk code in the sweep (PLAN.md's D5 spec: an
 * under-redaction publishes a real charger's serial/location to a git repo;
 * an over-redaction — or deleting rather than replacing — destroys the
 * evidence). Both failure directions get direct coverage here, including
 * nesting, arrays, and keys appearing at unexpected depths.
 */

import { describe, expect, it } from "vitest";
import {
  isSensitiveKey,
  redactJson,
  redactRawText,
} from "../../tools/schema-sweep/redact.js";

describe("redactJson", () => {
  it("replaces every documented sensitive key at the top level", () => {
    const input = {
      accessToken: "eyJ.abc.def",
      idToken: "eyJ.ghi.jkl",
      refreshToken: "refresh-xyz",
      email: "person@example.com",
      serial: "SN0000001",
      // ocppChargePointId and iccid are both id-shaped (end in "id") and
      // covered by the generic rule below, not a curated entry of their own.
      ocppChargePointId: "SN0000001",
      iccid: "8964000012345678901",
    };
    const out = redactJson(input) as Record<string, unknown>;
    expect(out["accessToken"]).toBe("<redacted:token>");
    expect(out["idToken"]).toBe("<redacted:token>");
    expect(out["refreshToken"]).toBe("<redacted:token>");
    expect(out["email"]).toBe("<redacted:email>");
    expect(out["serial"]).toBe("<redacted:serial>");
    expect(out["ocppChargePointId"]).toBe("<redacted:id>");
    expect(out["iccid"]).toBe("<redacted:id>");
  });

  it("redacts a residential address's fields by key — a charger's location is someone's home", () => {
    const out = redactJson({
      address1: "3/29 Slevin Street",
      address2: "",
      address3: "",
      city: "Lilydale",
      postCode: "3140",
      state: "Victoria",
      country: "AU",
      icpNumber: "63058180718",
      evseId: "ENX-E7E5E822D-1",
    }) as Record<string, unknown>;
    expect(out["address1"]).toBe("<redacted:address>");
    expect(out["city"]).toBe("<redacted:address>");
    expect(out["postCode"]).toBe("<redacted:address>");
    expect(out["state"]).toBe("<redacted:address>");
    expect(out["icpNumber"]).toBe("<redacted:icpNumber>");
    // evseId is id-shaped (ends in "id") — covered by the generic rule.
    expect(out["evseId"]).toBe("<redacted:id>");
    // country is coarse-grained and deliberately left visible.
    expect(out["country"]).toBe("AU");
    // Empty strings are legitimate observed values, not something to hide,
    // but they still pass through the same key-based substitution.
    expect(out["address2"]).toBe("<redacted:address>");
  });

  it("redacts every 'name' field outright — live data showed all of them are personally identifying", () => {
    // Observed live: an org name, a location's free-text display name
    // defaulting to "<the account email>'s Home", and a charger named after
    // its owner. Rather than lean on an operator noticing and hand-supplying
    // --redact each run, the key itself is redacted unconditionally.
    const out = redactJson({
      name: "Ramsey's Home Charger",
    }) as Record<string, unknown>;
    expect(out["name"]).toBe("<redacted:name>");
  });

  it("redacts an email address embedded inside an otherwise-innocuous field's value, not just under an 'email' or 'name' key", () => {
    // The value-level scan is a second line of defence for whatever key
    // name a future field turns up under — not just the ones already known
    // to be sensitive.
    const out = redactJson({
      displayName: "person@example.com",
      label: "person@example.com's Home",
    }) as Record<string, unknown>;
    expect(out["displayName"]).toBe("<redacted:email>");
    expect(out["label"]).toBe("<redacted:email>'s Home");
  });

  it("redacts any key equal to or ending in 'id', regardless of whether it is on the curated list", () => {
    const out = redactJson({
      id: "4e73768b-7a70-4a29-9310-b7bcf2699872",
      connectorId: "1",
      sessionId: "s-1",
      transactionId: 42,
      ID: "shouty-case-still-matches",
    }) as Record<string, unknown>;
    expect(out["id"]).toBe("<redacted:id>");
    expect(out["connectorId"]).toBe("<redacted:id>");
    expect(out["sessionId"]).toBe("<redacted:id>");
    expect(out["transactionId"]).toBe("<redacted:id>");
    expect(out["ID"]).toBe("<redacted:id>");
  });

  it("uses the generic 'id' marker for an id-shaped key that has no curated label of its own", () => {
    const out = redactJson({
      ocppChargePointId: "ocpp-1",
      evseId: "ENX-1",
      iccid: "8964000012345678901",
    }) as Record<string, unknown>;
    expect(out["ocppChargePointId"]).toBe("<redacted:id>");
    expect(out["evseId"]).toBe("<redacted:id>");
    expect(out["iccid"]).toBe("<redacted:id>");
  });

  it("redacts coordinates by key, regardless of numeric or string type", () => {
    const numeric = redactJson({ latitude: -41.2865, longitude: 174.7762 }) as Record<
      string,
      unknown
    >;
    expect(numeric["latitude"]).toBe("<redacted:coordinate>");
    expect(numeric["longitude"]).toBe("<redacted:coordinate>");

    const stringy = redactJson({ latitude: "-41.2865", longitude: "174.7762" }) as Record<
      string,
      unknown
    >;
    expect(stringy["latitude"]).toBe("<redacted:coordinate>");
    expect(stringy["longitude"]).toBe("<redacted:coordinate>");
  });

  it("redacts the SRP secret block's key shapes defensively", () => {
    const out = redactJson({
      SECRET_BLOCK: "abc123",
      SRP_A: "def456",
      salt: "ghi789",
      PASSWORD_CLAIM_SIGNATURE: "jkl012",
    }) as Record<string, unknown>;
    expect(out["SECRET_BLOCK"]).toBe("<redacted:srp>");
    expect(out["SRP_A"]).toBe("<redacted:srp>");
    expect(out["salt"]).toBe("<redacted:srp>");
    expect(out["PASSWORD_CLAIM_SIGNATURE"]).toBe("<redacted:srp>");
  });

  it("matches key names case- and separator-insensitively", () => {
    const out = redactJson({ ACCESS_TOKEN: "x", "Access-Token": "y" }) as Record<
      string,
      unknown
    >;
    expect(out["ACCESS_TOKEN"]).toBe("<redacted:token>");
    expect(out["Access-Token"]).toBe("<redacted:token>");
  });

  it("does NOT redact a legitimate field whose name merely contains a sensitive substring", () => {
    // tokenRequired is a real, non-sensitive boolean field on EvnexChargePoint.
    const out = redactJson({
      tokenRequired: false,
      needsRegistrationInformation: true,
    }) as Record<string, unknown>;
    expect(out["tokenRequired"]).toBe(false);
    expect(out["needsRegistrationInformation"]).toBe(true);
  });

  it("redacts sensitive keys nested arbitrarily deep, inside objects and arrays", () => {
    const input = {
      data: {
        items: [
          {
            id: "cp-1",
            details: { model: "E2", vendor: "Evnex", firmware: "1.0", iccid: "89640001" },
            location: {
              address: { address1: "1 Test St" },
              coordinates: { latitude: 1, longitude: 2 },
            },
          },
          {
            id: "cp-2",
            details: { model: "E2", vendor: "Evnex", firmware: "1.0", iccid: "89640002" },
          },
        ],
      },
    };
    const out = redactJson(input) as {
      data: {
        items: Array<{
          id: string;
          details: { iccid: string };
          location?: { coordinates: { latitude: unknown; longitude: unknown } };
        }>;
      };
    };
    expect(out.data.items[0]?.details.iccid).toBe("<redacted:id>");
    expect(out.data.items[1]?.details.iccid).toBe("<redacted:id>");
    expect(out.data.items[0]?.location?.coordinates.latitude).toBe(
      "<redacted:coordinate>",
    );
    // A resource id is itself a live handle to a specific device/account —
    // redacted like everything else, not treated as structural metadata.
    expect(out.data.items[0]?.id).toBe("<redacted:id>");
    // Structure (array length and non-sensitive sibling keys) is preserved exactly.
    expect(out.data.items).toHaveLength(2);
    expect(out.data.items[0]?.details).toMatchObject({ model: "E2", vendor: "Evnex" });
  });

  it("replaces by substitution, never by deletion — the key stays present", () => {
    const out = redactJson({ email: "a@example.com", name: "Test" }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(out)).toEqual(["email", "name"]);
    expect(out["email"]).not.toBeUndefined();
    expect(out["name"]).toBe("<redacted:name>");
  });

  it("leaves null values null rather than replacing them — nullity is itself evidence this sweep measures", () => {
    const out = redactJson({ email: null, iccid: null }) as Record<string, unknown>;
    expect(out["email"]).toBeNull();
    expect(out["iccid"]).toBeNull();
  });

  it("leaves non-sensitive primitives, dates-as-strings, and structure untouched", () => {
    const input = {
      networkStatus: "ONLINE",
      maxCurrent: 32,
      createdDate: "2024-01-01T00:00:00Z",
      connectors: [{ amperage: 32, powerType: "AC_1_PHASE" }],
    };
    expect(redactJson(input)).toEqual(input);
  });

  it("handles a top-level array", () => {
    const out = redactJson([
      { email: "a@example.com" },
      { email: "b@example.com" },
    ]) as Array<Record<string, unknown>>;
    expect(out[0]?.["email"]).toBe("<redacted:email>");
    expect(out[1]?.["email"]).toBe("<redacted:email>");
  });

  it("passes through primitive and empty inputs without throwing", () => {
    expect(redactJson("plain string")).toBe("plain string");
    expect(redactJson(42)).toBe(42);
    expect(redactJson(true)).toBe(true);
    expect(redactJson(null)).toBeNull();
    expect(redactJson({})).toEqual({});
    expect(redactJson([])).toEqual([]);
  });
});

describe("isSensitiveKey", () => {
  it("agrees with redactJson's own classification", () => {
    expect(isSensitiveKey("email")).toBe(true);
    expect(isSensitiveKey("accessToken")).toBe(true);
    expect(isSensitiveKey("tokenRequired")).toBe(false);
    expect(isSensitiveKey("name")).toBe(true);
    // namespacePrefix is a real, non-sensitive field (e.g. "01DC") — "name"
    // matching is exact, not a substring/prefix match.
    expect(isSensitiveKey("namespacePrefix")).toBe(false);
  });
});

describe("redactRawText", () => {
  it("redacts a JWT-shaped token embedded in unstructured text", () => {
    const text =
      "Internal Server Error: token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ rejected";
    const out = redactRawText(text);
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).toContain("<redacted:token>");
  });

  it("redacts an email address embedded in unstructured text", () => {
    const out = redactRawText("No account found for person@example.com");
    expect(out).not.toContain("person@example.com");
    expect(out).toContain("<redacted:email>");
  });

  it("redacts a 'Bearer <token>' header echoed into a body", () => {
    const out = redactRawText("Authorization header was: Bearer abc.def.ghi123");
    expect(out).not.toContain("abc.def.ghi123");
    expect(out).toContain("<redacted:token>");
  });

  it("leaves ordinary text (e.g. an HTML error page with no secrets) unchanged", () => {
    const html = "<html><body><h1>502 Bad Gateway</h1></body></html>";
    expect(redactRawText(html)).toBe(html);
  });

  it("redacts multiple occurrences in the same body", () => {
    const out = redactRawText("contact a@example.com or b@example.com");
    expect(out).not.toContain("a@example.com");
    expect(out).not.toContain("b@example.com");
    expect(out.match(/<redacted:email>/g)).toHaveLength(2);
  });
});
