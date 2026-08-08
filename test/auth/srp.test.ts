/**
 * Tests for `src/auth/srp.ts` — see PLAN.md §5 A5 for the acceptance
 * criteria this file is built to satisfy:
 *
 *  1. A differential oracle against `amazon-cognito-identity-js` (a
 *     devDependency-only test oracle — no runtime dependency added) for at
 *     least three pinned input sets, comparing `PASSWORD_CLAIM_SIGNATURE`
 *     byte-for-byte.
 *  2. A known-answer test with `a`, `B`, `salt` and the clock all pinned.
 *  3. A dedicated timestamp-format test (non-padded day, literal "UTC",
 *     independent of host TZ/locale).
 *  4. `PAD()` tested against Java `BigInteger.toByteArray()` semantics,
 *     including the high-bit `0x00` prefix case.
 *  5. The `u == 0` and `A mod N == 0` rejection paths.
 *
 * `node:crypto` is mocked at the module level so `randomBytes` can be pinned
 * to an exact value in tests that need a deterministic `a` (the known-answer
 * fixture and the oracle cases below); every other export (`createHash`,
 * `createHmac`, `hkdfSync`, and `randomBytes` itself when nothing is queued)
 * passes straight through to the real implementation, so this file exercises
 * real SHA-256/HMAC/HKDF throughout — only the *randomness* is ever faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes as nodeRandomBytes } from "node:crypto";
import type * as NodeCrypto from "node:crypto";

const queuedRandomBytes: Buffer[] = [];

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return {
    ...actual,
    randomBytes: (size: number): Buffer => {
      const next = queuedRandomBytes.shift();
      if (next) {
        if (next.length !== size) {
          throw new Error(`mock randomBytes: queued ${next.length} bytes, but ${size} were requested`);
        }
        return next;
      }
      return actual.randomBytes(size);
    },
  };
});

/** Pin the next call to `node:crypto.randomBytes` inside `srp.ts` to `bytes`. */
function pinNextRandomBytes(bytes: Buffer): void {
  queuedRandomBytes.push(bytes);
}

afterEach(() => {
  queuedRandomBytes.length = 0;
});

const { N, G, pad, modPow, reduceModN, assertNonZero, formatCognitoTimestamp, createSrpClient } = await import(
  "../../src/auth/srp.js"
);

// ---------------------------------------------------------------------------
// PAD() — Java `BigInteger.toByteArray()` semantics (PLAN.md §5 A5
// acceptance: "PAD() tested against Java BigInteger.toByteArray() semantics,
// including the high-bit 0x00 prefix case").
//
// Reference values below are exactly what `new java.math.BigInteger(n)
// .toByteArray()` produces for each `n`: Java never sets the sign bit of the
// leading byte of a positive value's encoding, prepending 0x00 whenever the
// natural encoding would.
// ---------------------------------------------------------------------------
describe("pad()", () => {
  it("encodes zero as a single zero byte", () => {
    expect(pad(0n)).toEqual(Buffer.from([0x00]));
  });

  it("does not extend a value whose high bit is already clear", () => {
    // 127 = 0x7F — high bit of the single byte is clear, no padding needed.
    expect(pad(0x7fn)).toEqual(Buffer.from([0x7f]));
  });

  it("prefixes a single 0x00 byte when the high bit would otherwise be set", () => {
    // 128 = 0x80 — the sign bit would be set on a bare single byte.
    expect(pad(0x80n)).toEqual(Buffer.from([0x00, 0x80]));
  });

  it("prefixes 0x00 for a multi-byte value whose top byte has the high bit set", () => {
    // 0xFF00 — even-length hex ("ff00"), leading nibble in [8-f], needs the
    // 0x00 prefix.
    expect(pad(0xff00n)).toEqual(Buffer.from([0x00, 0xff, 0x00]));
  });

  it("odd-length hex gets a single leading zero nibble, never a whole zero byte", () => {
    // 256 = 0x100 — three hex digits, pads to "0100" (2 bytes), not "000100"
    // (3 bytes) — the len%2 branch, not the high-bit branch, applies here.
    expect(pad(0x100n)).toEqual(Buffer.from([0x01, 0x00]));
  });

  it("odd-length padding can never leave the high bit set on the new leading byte", () => {
    // 0xF00 -> "f00" (odd length) -> "0f00": the original high nibble 'f'
    // becomes the *low* nibble of the new leading byte, so the high-bit
    // check never needs to (and does not) additionally fire.
    expect(pad(0xf00n)).toEqual(Buffer.from([0x0f, 0x00]));
  });

  it("matches Java's encoding of BigInteger.ONE", () => {
    expect(pad(1n)).toEqual(Buffer.from([0x01]));
  });

  it("rejects negative values — SRP never pads a negative magnitude", () => {
    expect(() => pad(-1n)).toThrow(RangeError);
  });

  it("pads N itself with a leading 0x00 guard byte (N's top byte is 0xFF)", () => {
    const padded = pad(N);
    expect(padded[0]).toBe(0x00);
    expect(padded.length).toBe(385); // 384-byte prime + 1 guard byte
  });

  it("pads g=2 to a single, non-prefixed byte", () => {
    expect(pad(G)).toEqual(Buffer.from([0x02]));
  });
});

// ---------------------------------------------------------------------------
// modPow() / reduceModN() — the modular arithmetic primitives.
// ---------------------------------------------------------------------------
describe("modPow()", () => {
  it("computes textbook modular exponentiation", () => {
    expect(modPow(2n, 10n, 1000n)).toBe(1024n % 1000n);
    expect(modPow(4n, 13n, 497n)).toBe(445n);
  });

  it("returns 1 for a zero exponent", () => {
    expect(modPow(5n, 0n, 13n)).toBe(1n);
  });

  it("handles a base already congruent to 0 mod the modulus", () => {
    expect(modPow(9n, 3n, 3n)).toBe(0n);
  });
});

describe("reduceModN()", () => {
  it("leaves an already-reduced non-negative value unchanged", () => {
    expect(reduceModN(5n)).toBe(5n);
  });

  it("wraps a negative value into [0, N)", () => {
    expect(reduceModN(-5n)).toBe(N - 5n);
  });

  it("reduces a value already >= N", () => {
    expect(reduceModN(N + 7n)).toBe(7n);
  });
});

// ---------------------------------------------------------------------------
// assertNonZero() — the u == 0 / A mod N == 0 rejection paths (PLAN.md §5 A5
// acceptance). Both conditions are mathematically unreachable through honest
// random inputs (N is prime, g=2 is coprime to it; u==0 needs a SHA-256
// preimage), so the only way to exercise the throwing branch deterministically
// is to call the guard directly with a contrived zero — exactly what
// `createSrpClient` does internally for both A and u.
// ---------------------------------------------------------------------------
describe("assertNonZero()", () => {
  it("throws for zero", () => {
    expect(() => assertNonZero(0n, "u")).toThrow(/u must not be zero/);
  });

  it("does not throw for a non-zero value", () => {
    expect(() => assertNonZero(1n, "A")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatCognitoTimestamp() — dedicated timestamp-format test (PLAN.md §5 A5
// acceptance): non-padded day, literal "UTC" marker, independent of host
// TZ/locale.
// ---------------------------------------------------------------------------
describe("formatCognitoTimestamp()", () => {
  it("never zero-pads the day", () => {
    // 2024-01-02T15:04:05Z -> "Tue Jan 2 15:04:05 UTC 2024", NOT "Jan 02".
    const formatted = formatCognitoTimestamp(new Date("2024-01-02T15:04:05.000Z"));
    expect(formatted).toBe("Tue Jan 2 15:04:05 UTC 2024");
    expect(formatted).not.toContain("Jan 02");
  });

  it("zero-pads hours, minutes and seconds", () => {
    const formatted = formatCognitoTimestamp(new Date("2024-03-09T01:02:03.000Z"));
    expect(formatted).toBe("Sat Mar 9 01:02:03 UTC 2024");
  });

  it("uses the literal UTC marker and UTC fields regardless of host TZ", () => {
    const original = process.env["TZ"];
    process.env["TZ"] = "Australia/Adelaide"; // UTC+9:30, deliberately a half-hour offset
    try {
      const formatted = formatCognitoTimestamp(new Date("2024-06-15T23:45:00.000Z"));
      expect(formatted).toBe("Sat Jun 15 23:45:00 UTC 2024");
    } finally {
      if (original === undefined) {
        delete process.env["TZ"];
      } else {
        process.env["TZ"] = original;
      }
    }
  });

  it("formats a two-digit day unpadded", () => {
    const formatted = formatCognitoTimestamp(new Date("2024-12-25T00:00:00.000Z"));
    expect(formatted).toBe("Wed Dec 25 00:00:00 UTC 2024");
  });
});

// ---------------------------------------------------------------------------
// createSrpClient() — smoke tests over the full public contract A6 codes
// against.
// ---------------------------------------------------------------------------
describe("createSrpClient()", () => {
  it("produces a non-empty hex srpA smaller than N", () => {
    const client = createSrpClient("zWnqo6ASv");
    expect(client.srpA).toMatch(/^[0-9a-f]+$/);
    expect(BigInt(`0x${client.srpA}`) < N).toBe(true);
  });

  it("produces a different A on every call (fresh randomness per client)", () => {
    const a = createSrpClient("zWnqo6ASv");
    const b = createSrpClient("zWnqo6ASv");
    expect(a.srpA).not.toBe(b.srpA);
  });

  it("computes a challenge response with a base64 HMAC-SHA256 signature", () => {
    const client = createSrpClient("zWnqo6ASv");
    const salt = nodeRandomBytes(16).toString("hex");
    const srpB = nodeRandomBytes(128).toString("hex");
    const secretBlock = nodeRandomBytes(32).toString("base64");
    const timestamp = new Date("2024-01-02T15:04:05.000Z");

    const result = client.computeChallengeResponse({
      srpB,
      salt,
      secretBlock,
      username: "test-user-id",
      password: "hunter2",
      timestamp,
    });

    expect(result.timestamp).toBe("Tue Jan 2 15:04:05 UTC 2024");
    expect(result.signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(result.signature, "base64").length).toBe(32); // HMAC-SHA256 digest length
  });

  it("defaults the timestamp to the current time when omitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-07-04T09:08:07.000Z"));
    try {
      const client = createSrpClient("zWnqo6ASv");
      const result = client.computeChallengeResponse({
        srpB: nodeRandomBytes(128).toString("hex"),
        salt: nodeRandomBytes(16).toString("hex"),
        secretBlock: nodeRandomBytes(32).toString("base64"),
        username: "test-user-id",
        password: "hunter2",
      });
      expect(result.timestamp).toBe("Thu Jul 4 09:08:07 UTC 2024");
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------------
  // Known-answer test (PLAN.md §5 A5 acceptance): with `a`, `B`, `salt` and
  // the clock all pinned, the derived signature must match a fixture value.
  // The fixture was computed by independently evaluating the SRP algorithm
  // (RFC 5054 + PLAN.md §3.3) against these exact inputs outside this
  // module, using the standard library primitives directly (see the module
  // docstring above) — it cross-checks the wiring (concatenation order,
  // hex/base64 boundaries, HKDF parameters) independent of both srp.ts's own
  // code and the differential oracle below.
  // -------------------------------------------------------------------------
  it("matches a known-answer fixture for pinned a/B/salt/timestamp", () => {
    const fixedA = Buffer.from("1f".repeat(64) + "2a".repeat(64), "hex"); // 128 bytes
    pinNextRandomBytes(fixedA);

    const client = createSrpClient("zWnqo6ASv");

    const a = BigInt(`0x${fixedA.toString("hex")}`);
    const A = modPow(G, a, N);
    expect(client.srpA).toBe(A.toString(16));

    const result = client.computeChallengeResponse({
      srpB: "abcd".repeat(64), // 128 hex chars
      salt: "0011223344556677".repeat(4), // 64 hex chars
      secretBlock: Buffer.from("hello-secret-block").toString("base64"),
      username: "test-user-id",
      password: "correct horse battery staple",
      timestamp: new Date("2024-01-02T15:04:05.000Z"),
    });

    expect(result.timestamp).toBe("Tue Jan 2 15:04:05 UTC 2024");
    expect(result.signature).toBe("y84blWSezE6m5W6ldWtimFOJ/X2STfp1/fXapeLo594=");
  });
});

// ---------------------------------------------------------------------------
// Differential oracle against `amazon-cognito-identity-js` (PLAN.md §5 A5,
// §8 risk 1, §10.7). `amazon-cognito-identity-js` is proven to complete
// `USER_SRP_AUTH` against this exact Cognito pool from Node — this test
// drives its *public* `CognitoUser.authenticateUser` API against a stubbed
// transport (`fetch`) and reads the `PASSWORD_CLAIM_SIGNATURE` it actually
// puts on the wire, rather than importing its internal `AuthenticationHelper`
// (not part of its public surface, and may move). It stays entirely offline
// and adds no runtime dependency: `amazon-cognito-identity-js` is a
// devDependency only (see package.json).
//
// To compare signatures byte-for-byte, both implementations must agree on
// every input that feeds the HMAC — including the private exponent `a`,
// which the library also draws at random internally. `a` is pinned on both
// sides simultaneously:
//   - our side, via the `node:crypto.randomBytes` mock declared above;
//   - the library's side, via `globalThis.crypto.getRandomValues`, which is
//     what its own randomness (`cryptoSecureRandomInt`, used by
//     `AuthenticationHelper.generateRandomSmallA`) bottoms out on in Node 20+
//     (no browser `window`, so it falls through to the global Web Crypto
//     object) — fed the *same* fixed byte buffer, 4 bytes (one `Uint32`) per
//     call, so both implementations compute the identical `a`, and therefore
//     the identical `A`, `u`, `x` and `S`.
// The clock is pinned via `vi.useFakeTimers`, since both `formatCognitoTimestamp`
// (ours) and the library's `DateHelper.getNowString` call `new Date()`.
// ---------------------------------------------------------------------------
type GetRandomValues = typeof globalThis.crypto.getRandomValues;

describe("differential oracle: amazon-cognito-identity-js", () => {
  let originalGetRandomValues: GetRandomValues;

  beforeEach(() => {
    originalGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto) as GetRandomValues;
  });

  afterEach(() => {
    globalThis.crypto.getRandomValues = originalGetRandomValues;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Feed `bytes` to the library's WebCrypto-backed random source, 4 bytes per `Uint32Array(1)` call. */
  function pinLibraryRandomBytes(bytes: Buffer): void {
    let callIndex = 0;
    globalThis.crypto.getRandomValues = (<T extends Exclude<NodeJS.TypedArray, Float32Array | Float64Array>>(
      array: T,
    ): T => {
      if (array instanceof Uint32Array && array.length === 1) {
        const offset = callIndex * 4;
        if (offset + 4 <= bytes.length) {
          array[0] = bytes.readUInt32BE(offset);
          callIndex += 1;
          return array;
        }
      }
      return originalGetRandomValues(array);
    }) as GetRandomValues;
  }

  interface InitiateAuthRequestBody {
    AuthFlow: string;
    ClientId: string;
    AuthParameters: { USERNAME: string; SRP_A: string };
  }

  interface RespondToAuthChallengeRequestBody {
    ChallengeName: string;
    ClientId: string;
    Session: string;
    ChallengeResponses: {
      USERNAME: string;
      PASSWORD_CLAIM_SECRET_BLOCK: string;
      TIMESTAMP: string;
      PASSWORD_CLAIM_SIGNATURE: string;
    };
  }

  function amzTarget(headers: RequestInit["headers"] | undefined): string {
    if (headers && typeof headers === "object" && !(headers instanceof Headers) && !Array.isArray(headers)) {
      const value = (headers as Record<string, string>)["X-Amz-Target"];
      return typeof value === "string" ? value : "";
    }
    return "";
  }

  interface OracleCase {
    /** 128 deterministic bytes standing in for the private exponent `a`, pinned on both sides. */
    fixedA: Buffer;
    poolName: string;
    userIdForSrp: string;
    password: string;
    saltHex: string;
    srpBHex: string;
    secretBlockB64: string;
    now: Date;
  }

  /**
   * Runs one case through both `amazon-cognito-identity-js`'s public
   * `CognitoUser.authenticateUser` (via a stubbed `fetch`) and our own
   * `createSrpClient`, and returns both `PASSWORD_CLAIM_SIGNATURE` values for
   * comparison.
   */
  async function runOracleCase(
    caseInputs: OracleCase,
  ): Promise<{ ours: string; theirs: string; theirTimestamp: string; ourTimestamp: string }> {
    const { fixedA, poolName, userIdForSrp, password, saltHex, srpBHex, secretBlockB64, now } = caseInputs;

    pinLibraryRandomBytes(fixedA);
    pinNextRandomBytes(fixedA);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    let capturedChallengeResponses: RespondToAuthChallengeRequestBody["ChallengeResponses"] | undefined;

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit): Promise<Response> => {
      const target = amzTarget(init?.headers);
      const body: unknown = JSON.parse(String(init?.body ?? "{}"));

      if (target.endsWith("InitiateAuth")) {
        const req = body as InitiateAuthRequestBody;
        expect(req.AuthFlow).toBe("USER_SRP_AUTH");
        return new Response(
          JSON.stringify({
            ChallengeName: "PASSWORD_VERIFIER",
            ChallengeParameters: {
              SALT: saltHex,
              SRP_B: srpBHex,
              SECRET_BLOCK: secretBlockB64,
              USER_ID_FOR_SRP: userIdForSrp,
              USERNAME: "someone@example.com",
            },
            Session: "fake-session",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("RespondToAuthChallenge")) {
        const req = body as RespondToAuthChallengeRequestBody;
        capturedChallengeResponses = req.ChallengeResponses;
        return new Response(
          JSON.stringify({
            AuthenticationResult: {
              AccessToken: "fake.access.token",
              IdToken: "fake.id.token",
              RefreshToken: "fake-refresh-token",
              ExpiresIn: 3600,
              TokenType: "Bearer",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`unexpected Cognito operation for X-Amz-Target: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { CognitoUser, CognitoUserPool, AuthenticationDetails } = await import("amazon-cognito-identity-js");
    const pool = new CognitoUserPool({
      UserPoolId: `ap-southeast-2_${poolName}`,
      ClientId: "test-client-id",
    });
    const user = new CognitoUser({ Username: "someone@example.com", Pool: pool });
    const authDetails = new AuthenticationDetails({ Username: "someone@example.com", Password: password });

    await new Promise<void>((resolve, reject) => {
      user.authenticateUser(authDetails, {
        onSuccess: () => resolve(),
        onFailure: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
      });
    });

    if (!capturedChallengeResponses) {
      throw new Error("oracle case never reached RespondToAuthChallenge");
    }

    const ours = createSrpClient(poolName).computeChallengeResponse({
      srpB: srpBHex,
      salt: saltHex,
      secretBlock: secretBlockB64,
      username: userIdForSrp,
      password,
      timestamp: now,
    });

    return {
      ours: ours.signature,
      theirs: capturedChallengeResponses.PASSWORD_CLAIM_SIGNATURE,
      theirTimestamp: capturedChallengeResponses.TIMESTAMP,
      ourTimestamp: ours.timestamp,
    };
  }

  it("matches the library's signature for pinned input set 1", async () => {
    const { ours, theirs, theirTimestamp, ourTimestamp } = await runOracleCase({
      fixedA: Buffer.from("ab".repeat(128), "hex"),
      poolName: "zWnqo6ASv",
      userIdForSrp: "11111111-1111-1111-1111-111111111111",
      password: "correct horse battery staple",
      saltHex: nodeRandomBytes(16).toString("hex"),
      srpBHex: nodeRandomBytes(128).toString("hex"),
      secretBlockB64: nodeRandomBytes(32).toString("base64"),
      now: new Date("2024-01-02T15:04:05.000Z"),
    });
    expect(ourTimestamp).toBe(theirTimestamp);
    expect(ours).toBe(theirs);
  });

  it("matches the library's signature for pinned input set 2 (different pool/user/password)", async () => {
    const { ours, theirs, theirTimestamp, ourTimestamp } = await runOracleCase({
      fixedA: Buffer.from("5c".repeat(128), "hex"),
      poolName: "differentPool9",
      userIdForSrp: "22222222-2222-2222-2222-222222222222",
      password: "hunter2!",
      saltHex: nodeRandomBytes(16).toString("hex"),
      srpBHex: nodeRandomBytes(128).toString("hex"),
      secretBlockB64: nodeRandomBytes(48).toString("base64"),
      now: new Date("2023-11-09T00:00:09.000Z"),
    });
    expect(ourTimestamp).toBe(theirTimestamp);
    expect(ours).toBe(theirs);
  });

  it("matches the library's signature for pinned input set 3 (a day requiring no zero-pad)", async () => {
    const { ours, theirs, theirTimestamp, ourTimestamp } = await runOracleCase({
      fixedA: nodeRandomBytes(128),
      poolName: "zWnqo6ASv",
      userIdForSrp: "33333333-3333-3333-3333-333333333333",
      password: "🔒 unicode password ☕",
      saltHex: nodeRandomBytes(16).toString("hex"),
      srpBHex: nodeRandomBytes(128).toString("hex"),
      secretBlockB64: nodeRandomBytes(64).toString("base64"),
      now: new Date("2024-03-05T04:03:02.000Z"), // day 5 -> unpadded "5"
    });
    expect(ourTimestamp).toBe("Tue Mar 5 04:03:02 UTC 2024");
    expect(ourTimestamp).toBe(theirTimestamp);
    expect(ours).toBe(theirs);
  });

  it("also matches for a fourth, independently random input set", async () => {
    const { ours, theirs } = await runOracleCase({
      fixedA: nodeRandomBytes(128),
      poolName: "zWnqo6ASv",
      userIdForSrp: "44444444-4444-4444-4444-444444444444",
      password: nodeRandomBytes(12).toString("base64"),
      saltHex: nodeRandomBytes(16).toString("hex"),
      srpBHex: nodeRandomBytes(128).toString("hex"),
      secretBlockB64: nodeRandomBytes(32).toString("base64"),
      now: new Date(),
    });
    expect(ours).toBe(theirs);
  });
});
