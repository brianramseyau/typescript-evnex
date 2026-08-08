/**
 * Unverified JWT expiry decode, and JWKS-backed verification — ported from
 * `evnex/auth.py`'s `_decode_expiry`, plus the `verifyTokens` path described
 * in PLAN.md §3.4 / §8 risk 3.
 *
 * `decodeExpiry` is a best-effort **unverified** decode: split on `.`,
 * `Buffer.from(part, "base64url")`, `JSON.parse`, read `exp`. No `jose`. Must
 * not throw on a non-JWT string, a truncated token, a valid JWT with no
 * `exp`, or a non-numeric `exp` — every malformed input returns `undefined`.
 *
 * `verifyJwt` is built on `node:crypto`: `createPublicKey({ key: jwk, format:
 * "jwk" })` then `crypto.verify("RSA-SHA256", ...)`. JWKS comes from
 * `https://cognito-idp.{region}.amazonaws.com/{poolId}/.well-known/jwks.json`,
 * fetched once and cached by user pool id (§3.4's "no jose" note applies to
 * the unverified decode; `jose` was considered here too — see the module
 * README notes in PLAN.md §0 — but `node:crypto`'s native JWK import made it
 * unnecessary).
 */

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { EvnexAuthError } from "../errors.js";

/** A single JSON Web Key, as returned by a Cognito user pool's JWKS endpoint. */
export interface Jwk {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

export interface Jwks {
  keys: Jwk[];
}

/** Decode one base64url JWT segment as JSON. Throws on any malformed input. */
function decodeSegment(segment: string): Record<string, unknown> {
  const json = Buffer.from(segment, "base64url").toString("utf8");
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("JWT segment did not decode to a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Best-effort, unverified read of a JWT's `exp` claim. */
export function decodeExpiry(token: string): Date | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return undefined;
    }
    // parts.length === 3 guarantees index 1 exists; the assertion just
    // works around noUncheckedIndexedAccess rather than adding a branch
    // that can never actually be false.
    const claims = decodeSegment(parts[1]!);
    const exp = claims["exp"];
    if (typeof exp !== "number" || !Number.isFinite(exp)) {
      return undefined;
    }
    return new Date(exp * 1000);
  } catch {
    return undefined;
  }
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

/**
 * Verify a JWT's signature against a JWKS and return its decoded claims.
 *
 * Only RS256 (the algorithm Cognito issues) is accepted. Expiry is checked
 * against the `exp` claim when present.
 *
 * @throws {EvnexAuthError} the token is malformed, its algorithm is
 *   unsupported, no JWKS key matches its `kid`, the signature does not
 *   verify, or the token has expired.
 */
export async function verifyJwt(
  token: string,
  jwks: Jwks,
): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new EvnexAuthError("Malformed JWT: expected three dot-separated segments");
  }
  // parts.length === 3 guarantees all three indices exist; the cast just
  // works around noUncheckedIndexedAccess rather than adding branches that
  // can never actually be false.
  const [headerSegment, payloadSegment, signatureSegment] = parts as [
    string,
    string,
    string,
  ];

  let header: JwtHeader;
  let claims: Record<string, unknown>;
  try {
    header = decodeSegment(headerSegment) as JwtHeader;
    claims = decodeSegment(payloadSegment);
  } catch (err) {
    throw new EvnexAuthError("Malformed JWT: could not decode header or payload", {
      cause: err,
    });
  }

  if (header.alg !== "RS256") {
    throw new EvnexAuthError(`Unsupported JWT signing algorithm: ${String(header.alg)}`);
  }

  const kid = header.kid;
  const jwk = typeof kid === "string" ? jwks.keys.find((k) => k.kid === kid) : undefined;
  if (!jwk) {
    throw new EvnexAuthError(`No JWKS key found matching kid ${JSON.stringify(kid)}`);
  }

  let publicKey;
  try {
    publicKey = createPublicKey({ key: jwk, format: "jwk" });
  } catch (err) {
    throw new EvnexAuthError("Invalid JWKS key", { cause: err });
  }

  const signedData = Buffer.from(`${headerSegment}.${payloadSegment}`, "utf8");
  const signature = Buffer.from(signatureSegment, "base64url");
  let valid: boolean;
  try {
    valid = cryptoVerify("RSA-SHA256", signedData, publicKey, signature);
  } catch (err) {
    throw new EvnexAuthError("JWT signature verification failed", { cause: err });
  }
  if (!valid) {
    throw new EvnexAuthError("JWT signature verification failed");
  }

  const exp = claims["exp"];
  if (typeof exp === "number" && Number.isFinite(exp) && Date.now() >= exp * 1000) {
    throw new EvnexAuthError("JWT has expired");
  }

  return claims;
}

// Fetched JWKS documents, keyed by Cognito user pool id, so repeated
// verifications never re-fetch: each entry's individual keys are then
// looked up by `kid` in verifyJwt above.
const jwksCache = new Map<string, Jwks>();

/** Fetch and cache-by-user-pool-id the JWKS for a Cognito user pool. */
export async function fetchJwks(userPoolId: string): Promise<Jwks> {
  const cached = jwksCache.get(userPoolId);
  if (cached !== undefined) {
    return cached;
  }
  const region = userPoolId.split("_")[0];
  if (!region) {
    throw new EvnexAuthError(
      `Cannot derive an AWS region from user pool id ${JSON.stringify(userPoolId)}`,
    );
  }
  const url = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new EvnexAuthError(
      `Failed to fetch JWKS for user pool ${userPoolId}: HTTP ${response.status}`,
    );
  }
  const data = (await response.json()) as Jwks;
  jwksCache.set(userPoolId, data);
  return data;
}
