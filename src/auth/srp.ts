/**
 * SRP (Secure Remote Password) protocol maths for Cognito's `USER_SRP_AUTH`,
 * per RFC 5054 with AWS's Cognito-specific variations — see PLAN.md §3.3.
 *
 * Pure, dependency-free, network-free: the highest-risk component in the
 * port, deliberately isolated so it can be tested exhaustively without any
 * AWS involvement (a differential oracle against `amazon-cognito-identity-js`
 * is the primary mitigation — PLAN.md §5 A5, §8 risk 1).
 *
 * Ported from `pycognito.aws_srp.AWSSRP` (`process_challenge` /
 * `get_password_authentication_key`), cross-checked line-for-line against
 * `amazon-cognito-identity-js`'s `AuthenticationHelper` — both are doing the
 * same RFC 5054 handshake the Cognito service implements.
 *
 * A handful of pure helpers below (`pad`, `modPow`, `reduceModN`,
 * `assertNonZero`, `formatCognitoTimestamp`, plus the constant `N`) are
 * exported beyond the fixed `createSrpClient` contract purely so the acceptance
 * criteria in PLAN.md §5 A5 — PAD() against Java `BigInteger.toByteArray()`
 * semantics, the `u == 0` / `A mod N == 0` rejection paths, and the timestamp
 * format — can each be driven directly, deterministically, and at 100%
 * branch coverage, without needing to search for SHA-256 preimages just to
 * exercise a branch. `createSrpClient` remains the only contract A6 codes
 * against.
 */

import { createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";

export interface SrpChallengeParams {
  srpB: string;
  salt: string;
  secretBlock: string;
  /**
   * The Cognito-assigned `USER_ID_FOR_SRP` from the `InitiateAuth` challenge
   * parameters — *not* the login username/email. `pycognito` and
   * `amazon-cognito-identity-js` both re-key on this value the moment the
   * server returns it, and it is what actually enters the signed message and
   * the `x` derivation (PLAN.md §3.3). The caller (A6's adapter) is
   * responsible for passing `USER_ID_FOR_SRP` here.
   */
  username: string;
  password: string;
  /** Overridable for deterministic tests; defaults to the current time. */
  timestamp?: Date;
}

export interface SrpChallengeResponse {
  signature: string;
  timestamp: string;
}

export interface SrpClient {
  /** `A = g^a mod N`, hex-encoded, to send as `SRP_A` in `InitiateAuth`. */
  srpA: string;
  computeChallengeResponse(params: SrpChallengeParams): SrpChallengeResponse;
}

// https://datatracker.ietf.org/doc/html/rfc5054#appendix-A — the 3072-bit
// safe prime, identical to the constant `pycognito` and
// `amazon-cognito-identity-js` both embed (their `N_HEX` / `initN`).
const N_HEX =
  "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1" +
  "29024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
  "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245" +
  "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
  "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D" +
  "C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
  "83655D23DCA3AD961C62F356208552BB9ED529077096966D" +
  "670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
  "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9" +
  "DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
  "15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64" +
  "ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7" +
  "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B" +
  "F12FFA06D98A0864D87602733EC86A64521F2B18177B200C" +
  "BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31" +
  "43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF";

/** The RFC 5054 Appendix A 3072-bit safe prime. Exported for direct testing. */
export const N: bigint = BigInt(`0x${N_HEX}`);

/** The RFC 5054 generator for `N`; Cognito fixes this at 2. */
export const G = 2n;

const INFO_BITS = Buffer.from("Caldera Derived Key", "utf8");

/**
 * Left-pads the big-endian byte representation of a non-negative integer to
 * an even length, prefixing `0x00` when the high bit of the first byte would
 * otherwise be set — i.e. Java `BigInteger.toByteArray()` semantics, which is
 * what Cognito's server implementation (and both reference client libraries)
 * expect every value hashed or HMAC'd in this protocol to be encoded as
 * (PLAN.md §3.3).
 */
export function pad(value: bigint): Buffer {
  if (value < 0n) {
    throw new RangeError("pad: expected a non-negative integer");
  }
  let hex = value.toString(16);
  if (hex.length % 2 === 1) {
    hex = `0${hex}`;
  } else if (/^[89a-fA-F]/.test(hex)) {
    hex = `00${hex}`;
  }
  return Buffer.from(hex, "hex");
}

/** SHA-256 of the concatenation of its arguments. */
function sha256(...parts: readonly Buffer[]): Buffer {
  return createHash("sha256").update(Buffer.concat(parts)).digest();
}

function hexToBigInt(hex: string): bigint {
  return BigInt(`0x${hex}`);
}

// k = SHA256(PAD(N) || PAD(g)) — the SRP-6a multiplier, fixed once per module
// since N and g are both protocol constants (PLAN.md §3.3).
const K = hexToBigInt(sha256(pad(N), pad(G)).toString("hex"));

/**
 * Exponentiation by squaring, modulo `modulus`. `base` is assumed
 * non-negative on entry — every call site here normalises its base into
 * `[0, N)` first (via `reduceModN`, or because it is already a `modPow`
 * result), so no defensive branch is needed to keep it correct, and none is
 * added, so as not to introduce a branch this module can never actually
 * exercise (and would otherwise cost 100% branch coverage to fake).
 */
export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % modulus;
    }
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

/** Reduces `value` into `[0, N)`, correcting for BigInt `%`'s sign-preserving remainder. */
export function reduceModN(value: bigint): bigint {
  const remainder = value % N;
  return remainder < 0n ? remainder + N : remainder;
}

/**
 * Guards the two SRP safety checks the protocol requires (PLAN.md §3.3,
 * acceptance criteria): the client's public value `A` must not be `0 mod N`,
 * and the shared randomness `u` must not be zero. Both are mathematically
 * unreachable via honest random inputs — `N` is prime and `g = 2` is
 * coprime to it, so `g^a mod N` can never land on 0, and `u` is a SHA-256
 * output with a `2^-256` chance of being exactly zero — but a malicious or
 * broken server could still send a `B` engineered to hit one of them, so the
 * check stays, matching `pycognito`'s `ValueError`s and
 * `amazon-cognito-identity-js`'s equivalent throws.
 */
export function assertNonZero(value: bigint, label: string): void {
  if (value === 0n) {
    throw new Error(`SRP protocol safety check failed: ${label} must not be zero`);
  }
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Formats a `Date` as Cognito expects for `TIMESTAMP`:
 * `"EEE MMM d HH:mm:ss 'UTC' yyyy"` in the C locale, with a **non-zero-padded
 * day** (`Tue Jan 2 …`, never `Tue Jan 02 …`) — the single most common
 * source of `NotAuthorizedException` in SRP re-implementations (PLAN.md
 * §3.3). Every field is read via the `getUTC*` accessors, so the result is
 * independent of the host's `TZ` and locale.
 */
export function formatCognitoTimestamp(date: Date): string {
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const month = MONTH_NAMES[date.getUTCMonth()];
  const day = date.getUTCDate();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${weekday} ${month} ${day} ${hours}:${minutes}:${seconds} UTC ${year}`;
}

function randomBigInt(byteLength: number): bigint {
  return hexToBigInt(randomBytes(byteLength).toString("hex"));
}

/**
 * HKDF-SHA256 with Cognito's fixed `"Caldera Derived Key"` info string and a
 * 16-byte output (PLAN.md §3.3). `node:crypto`'s `hkdfSync` implements
 * RFC 5869 directly, which is exactly what `pycognito`'s hand-rolled
 * extract-then-expand-once also computes for an output this short (one
 * expansion round covers up to 32 bytes for SHA-256).
 */
function deriveKey(sValue: bigint, uValue: bigint): Buffer {
  return Buffer.from(hkdfSync("sha256", pad(sValue), pad(uValue), INFO_BITS, 16));
}

/**
 * Build an SRP client for one authentication attempt.
 *
 * @param poolName the user pool id's segment after the underscore
 *   (`ap-southeast-2_zWnqo6ASv` -> `zWnqo6ASv`)
 */
export function createSrpClient(poolName: string): SrpClient {
  const a = randomBigInt(128);
  const A = modPow(G, a, N);
  assertNonZero(A, "A (the client's public SRP value)");
  const srpA = A.toString(16);

  return {
    srpA,
    computeChallengeResponse({ srpB, salt, secretBlock, username, password, timestamp }) {
      const B = hexToBigInt(srpB);
      const u = hexToBigInt(sha256(pad(A), pad(B)).toString("hex"));
      assertNonZero(u, "u (the shared SRP randomness)");

      const usernamePasswordHash = sha256(Buffer.from(`${poolName}${username}:${password}`, "utf8"));
      const saltValue = hexToBigInt(salt);
      const x = hexToBigInt(sha256(pad(saltValue), usernamePasswordHash).toString("hex"));

      const gModPowX = modPow(G, x, N);
      const base = reduceModN(B - K * gModPowX);
      const exponent = a + u * x;
      const S = modPow(base, exponent, N);

      const key = deriveKey(S, u);

      const timestampStr = formatCognitoTimestamp(timestamp ?? new Date());

      const message = Buffer.concat([
        Buffer.from(poolName, "utf8"),
        Buffer.from(username, "utf8"),
        Buffer.from(secretBlock, "base64"),
        Buffer.from(timestampStr, "utf8"),
      ]);
      const signature = createHmac("sha256", key).update(message).digest("base64");

      return { signature, timestamp: timestampStr };
    },
  };
}
