import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { decodeExpiry, fetchJwks, verifyJwt } from "../../src/auth/jwt.js";
import type { Jwk, Jwks } from "../../src/auth/jwt.js";

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// ---------------------------------------------------------------------------
// decodeExpiry — best-effort, unverified, never throws
// ---------------------------------------------------------------------------

/** A structurally valid (unsigned) JWT — decodeExpiry never checks the
 * signature, so an empty third segment is fine. */
function makeUnsignedJwt(claims: Record<string, unknown>): string {
  return `${encodeJson({ alg: "none", typ: "JWT" })}.${encodeJson(claims)}.`;
}

describe("decodeExpiry", () => {
  it("reads the exp claim of a well-formed token", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeUnsignedJwt({ exp });

    expect(decodeExpiry(token)).toEqual(new Date(exp * 1000));
  });

  it("returns undefined, without throwing, for a non-JWT string", () => {
    expect(decodeExpiry("not-a-jwt-token")).toBeUndefined();
  });

  it("returns undefined, without throwing, for a truncated/corrupted token", () => {
    const valid = makeUnsignedJwt({ exp: 123 });
    const [header, payload, signature] = valid.split(".");
    const corrupted = `${header}.${(payload ?? "").slice(0, 4)}.${signature}`;

    expect(decodeExpiry(corrupted)).toBeUndefined();
  });

  it("returns undefined, without throwing, for a valid JWT with no exp claim", () => {
    const token = makeUnsignedJwt({ sub: "user-1" });
    expect(decodeExpiry(token)).toBeUndefined();
  });

  it("returns undefined, without throwing, for a non-numeric exp", () => {
    const token = makeUnsignedJwt({ exp: "soon" });
    expect(decodeExpiry(token)).toBeUndefined();
  });

  it("returns undefined for a non-finite exp", () => {
    // JSON.parse("1e400") legitimately yields Infinity in V8; this hits the
    // Number.isFinite() branch specifically (typeof exp === "number" but
    // not finite), distinct from the non-numeric case above.
    const payload = Buffer.from('{"exp":1e400}').toString("base64url");
    const token = `${encodeJson({ alg: "none" })}.${payload}.`;

    expect(decodeExpiry(token)).toBeUndefined();
  });

  it("returns undefined when the payload segment decodes to a JSON primitive, not an object", () => {
    const payload = Buffer.from("42").toString("base64url");
    const token = `${encodeJson({ alg: "none" })}.${payload}.`;

    expect(decodeExpiry(token)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// verifyJwt — node:crypto RS256 verification against a JWKS
// ---------------------------------------------------------------------------

const KID = "test-signing-key";
let privateKey: KeyObject;
let jwk: Jwk;
let jwks: Jwks;

beforeAll(() => {
  const { publicKey, privateKey: generatedPrivateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  privateKey = generatedPrivateKey;
  const exported = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  jwk = {
    ...exported,
    kty: exported["kty"] as string,
    kid: KID,
    alg: "RS256",
    use: "sig",
  } as Jwk;
  jwks = { keys: [jwk] };
});

function signJwt(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", typ: "JWT", kid: KID },
): string {
  const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;
  const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

describe("verifyJwt", () => {
  it("verifies a correctly signed, unexpired token and returns its claims", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = signJwt({ sub: "user-1", exp });

    await expect(verifyJwt(token, jwks)).resolves.toEqual({ sub: "user-1", exp });
  });

  it("succeeds for a token with no exp claim (nothing to check)", async () => {
    const token = signJwt({ sub: "user-1" });
    await expect(verifyJwt(token, jwks)).resolves.toEqual({ sub: "user-1" });
  });

  it("succeeds for a token whose exp is present but not a finite number", async () => {
    const header = encodeJson({ alg: "RS256", typ: "JWT", kid: KID });
    const payload = Buffer.from('{"exp":1e400}').toString("base64url");
    const signingInput = `${header}.${payload}`;
    const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput), privateKey);
    const token = `${signingInput}.${signature.toString("base64url")}`;

    await expect(verifyJwt(token, jwks)).resolves.toEqual({ exp: Infinity });
  });

  it("rejects with EvnexAuthError for a token that is not three segments", async () => {
    await expect(verifyJwt("not-a-jwt", jwks)).rejects.toThrow(
      "Malformed JWT: expected three dot-separated segments",
    );
  });

  it("rejects with EvnexAuthError for a malformed header/payload", async () => {
    const valid = signJwt({ sub: "user-1", exp: 9999999999 });
    const [, payload, signature] = valid.split(".");
    const token = `not-valid-base64json.${payload}.${signature}`;

    await expect(verifyJwt(token, jwks)).rejects.toThrow(
      "Malformed JWT: could not decode header or payload",
    );
  });

  it("rejects an unsupported signing algorithm", async () => {
    const token = signJwt(
      { sub: "user-1", exp: 9999999999 },
      { alg: "HS256", typ: "JWT", kid: KID },
    );

    await expect(verifyJwt(token, jwks)).rejects.toThrow(
      "Unsupported JWT signing algorithm: HS256",
    );
  });

  it("rejects when the header has no kid", async () => {
    const token = signJwt(
      { sub: "user-1", exp: 9999999999 },
      { alg: "RS256", typ: "JWT" },
    );
    await expect(verifyJwt(token, jwks)).rejects.toThrow(
      "No JWKS key found matching kid",
    );
  });

  it("rejects when no JWKS key matches the header's kid", async () => {
    const token = signJwt(
      { sub: "user-1", exp: 9999999999 },
      { alg: "RS256", typ: "JWT", kid: "some-other-key" },
    );
    await expect(verifyJwt(token, jwks)).rejects.toThrow(
      "No JWKS key found matching kid",
    );
  });

  it("rejects an unimportable JWKS key", async () => {
    const brokenJwks: Jwks = { keys: [{ kty: "RSA", kid: KID }] };
    const token = signJwt({ sub: "user-1", exp: 9999999999 });

    await expect(verifyJwt(token, brokenJwks)).rejects.toThrow("Invalid JWKS key");
  });

  it("rejects a tampered signature", async () => {
    const token = signJwt({ sub: "user-1", exp: 9999999999 });
    const parts = token.split(".");
    // Flip the payload after signing without re-signing, invalidating it.
    const tamperedPayload = Buffer.from('{"sub":"attacker","exp":9999999999}').toString(
      "base64url",
    );
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    await expect(verifyJwt(tampered, jwks)).rejects.toThrow(
      "JWT signature verification failed",
    );
  });

  it("rejects when crypto.verify itself throws (key/algorithm mismatch)", async () => {
    const { publicKey: edPublicKey, privateKey: edPrivateKey } =
      generateKeyPairSync("ed25519");
    const edExported = edPublicKey.export({ format: "jwk" }) as Record<string, unknown>;
    const edJwk = { ...edExported, kid: "ed-key" } as Jwk;
    const edJwks: Jwks = { keys: [edJwk] };

    const signingInput = `${encodeJson({ alg: "RS256", typ: "JWT", kid: "ed-key" })}.${encodeJson(
      { sub: "user-1", exp: 9999999999 },
    )}`;
    const signature = cryptoSign(null, Buffer.from(signingInput), edPrivateKey);
    const token = `${signingInput}.${signature.toString("base64url")}`;

    await expect(verifyJwt(token, edJwks)).rejects.toThrow(
      "JWT signature verification failed",
    );
  });

  it("rejects an expired token", async () => {
    const token = signJwt({ sub: "user-1", exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(verifyJwt(token, jwks)).rejects.toThrow("JWT has expired");
  });
});

// ---------------------------------------------------------------------------
// fetchJwks — fetched once per user pool, cached thereafter
// ---------------------------------------------------------------------------

describe("fetchJwks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches from the Cognito well-known JWKS URL derived from the pool id", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(jwks), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJwks("ap-southeast-2_fetchOnce1");

    expect(result).toEqual(jwks);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_fetchOnce1/.well-known/jwks.json",
    );
  });

  it("fetches only once per user pool id, serving later calls from cache", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(jwks), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const poolId = "ap-southeast-2_fetchOnce2";
    await fetchJwks(poolId);
    await fetchJwks(poolId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws EvnexAuthError when the endpoint responds with a non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );

    await expect(fetchJwks("ap-southeast-2_fetchFails")).rejects.toThrow(
      "Failed to fetch JWKS for user pool ap-southeast-2_fetchFails: HTTP 404",
    );
  });

  it("throws EvnexAuthError for a user pool id with no derivable region, without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJwks("")).rejects.toThrow(
      "Cannot derive an AWS region from user pool id",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
