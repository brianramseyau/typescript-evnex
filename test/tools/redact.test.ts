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
      ocppChargePointId: "SN0000001",
      iccid: "8964000012345678901",
    };
    const out = redactJson(input) as Record<string, unknown>;
    expect(out["accessToken"]).toBe("<redacted:token>");
    expect(out["idToken"]).toBe("<redacted:token>");
    expect(out["refreshToken"]).toBe("<redacted:token>");
    expect(out["email"]).toBe("<redacted:email>");
    expect(out["serial"]).toBe("<redacted:serial>");
    expect(out["ocppChargePointId"]).toBe("<redacted:ocppChargePointId>");
    expect(out["iccid"]).toBe("<redacted:iccid>");
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
    expect(out.data.items[0]?.details.iccid).toBe("<redacted:iccid>");
    expect(out.data.items[1]?.details.iccid).toBe("<redacted:iccid>");
    expect(out.data.items[0]?.location?.coordinates.latitude).toBe(
      "<redacted:coordinate>",
    );
    // Structure (including array length and non-sensitive sibling keys) is preserved exactly.
    expect(out.data.items[0]?.id).toBe("cp-1");
    expect(out.data.items).toHaveLength(2);
  });

  it("replaces by substitution, never by deletion — the key stays present", () => {
    const out = redactJson({ email: "a@example.com", name: "Test" }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(out)).toEqual(["email", "name"]);
    expect(out["email"]).not.toBeUndefined();
  });

  it("leaves null values null rather than replacing them — nullity is itself evidence this sweep measures", () => {
    const out = redactJson({ email: null, iccid: null }) as Record<string, unknown>;
    expect(out["email"]).toBeNull();
    expect(out["iccid"]).toBeNull();
  });

  it("leaves non-sensitive primitives, dates-as-strings, and structure untouched", () => {
    const input = {
      id: "cp-0000001",
      networkStatus: "ONLINE",
      maxCurrent: 32,
      createdDate: "2024-01-01T00:00:00Z",
      connectors: [{ connectorId: "1", amperage: 32 }],
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
    expect(isSensitiveKey("name")).toBe(false);
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
