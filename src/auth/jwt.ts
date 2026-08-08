/**
 * Unverified JWT expiry decode, and JWKS-backed verification — ported from
 * `evnex/auth.py`'s `_decode_expiry`, plus the `verifyTokens` path described
 * in PLAN.md §3.4 / §8 risk 3.
 *
 * TODO(A7): implement.
 *
 * `decodeExpiry` is a best-effort **unverified** decode: split on `.`,
 * `Buffer.from(part, "base64url")`, `JSON.parse`, read `exp`. No `jose`. Must
 * not throw on a non-JWT string, a truncated token, a valid JWT with no
 * `exp`, or a non-numeric `exp` — every malformed input returns `undefined`.
 *
 * `verifyJwt` is built on `node:crypto`: `createPublicKey({ key: jwk, format:
 * "jwk" })` then `crypto.verify("RSA-SHA256", ...)`. JWKS comes from
 * `https://cognito-idp.{region}.amazonaws.com/{poolId}/.well-known/jwks.json`,
 * fetched once and cached by `kid`.
 */

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

/** Best-effort, unverified read of a JWT's `exp` claim. */
export function decodeExpiry(token: string): Date | undefined {
  throw new Error("TODO(A7)");
}

/**
 * Verify a JWT's signature against a JWKS and return its decoded claims.
 *
 * @throws {import("../errors.js").EvnexAuthError} the signature, issuer, or
 *   expiry is invalid
 */
export async function verifyJwt(
  token: string,
  jwks: Jwks,
): Promise<Record<string, unknown>> {
  throw new Error("TODO(A7)");
}

/** Fetch and cache-by-`kid` the JWKS for a Cognito user pool. */
export async function fetchJwks(userPoolId: string): Promise<Jwks> {
  throw new Error("TODO(A7)");
}
