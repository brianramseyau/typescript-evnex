import { describe, expect, it } from "vitest";
import { TotpEnrollment } from "../../src/auth/mfa.js";
import type { MfaStatus } from "../../src/auth/mfa.js";

describe("TotpEnrollment", () => {
  it("exposes the secret", () => {
    const enrollment = new TotpEnrollment("JBSWY3DPEHPK3PXP");
    expect(enrollment.secret).toBe("JBSWY3DPEHPK3PXP");
  });

  it("is immutable", () => {
    const enrollment = new TotpEnrollment("JBSWY3DPEHPK3PXP");
    expect(Object.isFrozen(enrollment)).toBe(true);
  });

  it("builds a provisioning URI with the default Evnex issuer", () => {
    const enrollment = new TotpEnrollment("JBSWY3DPEHPK3PXP");

    expect(enrollment.provisioningUri("user@example.com")).toBe(
      "otpauth://totp/user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Evnex",
    );
  });

  it("accepts an explicit issuer", () => {
    const enrollment = new TotpEnrollment("SECRET");
    expect(enrollment.provisioningUri("user@example.com", "My App")).toBe(
      "otpauth://totp/user%40example.com?secret=SECRET&issuer=My%20App",
    );
  });

  // Python's urllib.parse.quote() (default safe="/") differs from
  // encodeURIComponent() on several characters — checked against CPython
  // 3.11 directly (see mfa.ts's comment). Pin the exact set that differs.
  it.each([
    ["user@example.com", "user%40example.com"],
    ["Evnex", "Evnex"],
    ["a b", "a%20b"],
    ["a/b", "a/b"],
    ["a+b", "a%2Bb"],
    ["a~b", "a~b"],
    ["a.b", "a.b"],
    ["a_b", "a_b"],
    ["a-b", "a-b"],
    ["a(b)", "a%28b%29"],
    ["a'b", "a%27b"],
    ["a!b", "a%21b"],
    ["a*b", "a%2Ab"],
    ['a"b', "a%22b"],
    ["user name@example.com", "user%20name%40example.com"],
    ["日本語", "%E6%97%A5%E6%9C%AC%E8%AA%9E"],
  ])("percent-encodes %j like Python's quote() -> %j", (input, expected) => {
    const enrollment = new TotpEnrollment("SECRET");
    const uri = enrollment.provisioningUri(input, "Evnex");
    expect(uri).toBe(`otpauth://totp/${expected}?secret=SECRET&issuer=Evnex`);
  });

  it("percent-encodes the issuer the same way", () => {
    const enrollment = new TotpEnrollment("SECRET");
    const uri = enrollment.provisioningUri("user@example.com", "a!b");
    expect(uri).toBe("otpauth://totp/user%40example.com?secret=SECRET&issuer=a%21b");
  });
});

describe("MfaStatus", () => {
  it("is a plain readonly shape", () => {
    const status: MfaStatus = {
      enabled: ["SOFTWARE_TOKEN_MFA"],
      preferred: "SOFTWARE_TOKEN_MFA",
    };
    expect(status.enabled).toEqual(["SOFTWARE_TOKEN_MFA"]);
    expect(status.preferred).toBe("SOFTWARE_TOKEN_MFA");
  });

  it("allows an undefined preferred method", () => {
    const status: MfaStatus = { enabled: [], preferred: undefined };
    expect(status.preferred).toBeUndefined();
  });
});
