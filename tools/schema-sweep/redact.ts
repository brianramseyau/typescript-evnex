/**
 * Redaction layer — D5's highest-risk code.
 *
 * Redacts by *replacement*, never by deletion (PLAN.md §D5's schema sweep
 * subsection): a removed key is indistinguishable from an absent one, which
 * is exactly the distinction this sweep exists to measure (e.g. whether
 * `EvnexV3APIResponse.included` is ever truly absent vs. merely `null`).
 *
 * Two entry points:
 *  - `redactJson` walks a parsed JSON value recursively (objects, arrays,
 *    arbitrary nesting depth) and replaces the *value* of any key matching
 *    the sensitive-key list below with a typed marker string. `null` is left
 *    as `null` — there is no secret to hide in the absence of a value, and
 *    doing so would corrupt the exact presence/nullity signal the sweep is
 *    trying to capture.
 *  - `redactRawText` is the fallback for a response body that failed to
 *    parse as JSON at all (an HTML error page, a plain-text 5xx body, ...).
 *    It cannot walk a key/value structure, so it pattern-matches likely
 *    secrets directly in the string (JWTs, email addresses, bare "Bearer "
 *    tokens) and flags the result as needing human review.
 *
 * Matching is by *normalised* key name (lowercased, non-alphanumerics
 * stripped) so `access_token`, `accessToken`, and `ACCESS-TOKEN` all match
 * the same entry, and is an **exact** match against the normalised key, not
 * a substring — `tokenRequired` (a legitimate boolean field on
 * `EvnexChargePoint`) normalises to `tokenrequired`, which is not `token`,
 * so it is correctly left alone. Over-redaction is a real failure mode too
 * (PLAN.md's D5 brief: it makes the evidence worthless), so this list is
 * deliberately an exact-match allowlist of known-sensitive field names
 * rather than a broad substring/heuristic match.
 */

/** Sensitive key (normalised: lowercase, non-alphanumeric stripped) -> marker label. */
const REDACTED_KEYS: Readonly<Record<string, string>> = {
  // Session / bearer tokens (the sweep's own client never logs these, but a
  // future endpoint or a captured error body could easily echo one back).
  accesstoken: "token",
  idtoken: "token",
  refreshtoken: "token",
  authorization: "token",
  bearertoken: "token",
  token: "token",
  // The Cognito SRP handshake's secret material (PLAN.md's explicit "the SRP
  // secret block" callout) — defensive, in case a captured error body from
  // an auth-adjacent path ever echoes a challenge parameter back.
  secretblock: "srp",
  srpa: "srp",
  srpb: "srp",
  salt: "srp",
  passwordclaimsignature: "srp",
  passwordclaimsecretblock: "srp",
  verifier: "srp",
  // Account / hardware identity.
  email: "email",
  serial: "serial",
  ocppchargepointid: "ocppChargePointId",
  iccid: "iccid",
  // Location.
  latitude: "coordinate",
  longitude: "coordinate",
  // Generic credential catch-alls — not currently produced by any modelled
  // schema, kept as a defensive backstop for an unmodelled/additive field a
  // future API version might introduce.
  password: "password",
  secret: "secret",
};

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True if `key` names a field this module redacts the value of. */
export function isSensitiveKey(key: string): boolean {
  return normaliseKey(key) in REDACTED_KEYS;
}

function markerFor(key: string): string {
  const label = REDACTED_KEYS[normaliseKey(key)];
  return `<redacted:${label ?? "value"}>`;
}

/**
 * Deep-clone `value`, replacing the value of every sensitive key with a
 * marker string. `null`/`undefined` values are left untouched (nothing to
 * hide, and replacing them would erase the presence/nullity distinction the
 * sweep measures). Non-plain-object/array leaf values are returned as-is.
 *
 * Safe against cycles is not attempted: parsed `JSON.parse` output is
 * always a tree, never a cycle, and this function is never called on
 * arbitrary live objects — only on `JSON.parse`d response bodies.
 */
export function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === null || child === undefined) {
        out[key] = child;
        continue;
      }
      if (isSensitiveKey(key)) {
        out[key] = markerFor(key);
        continue;
      }
      out[key] = redactJson(child);
    }
    return out;
  }
  return value;
}

// -- Fallback for a body that failed JSON.parse ------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Three base64url segments separated by dots — a JWT access/id token shape.
const JWT_RE = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+/gi;

/**
 * Best-effort redaction of a raw string body that did not parse as JSON —
 * an HTML error page or a plain-text response, for example. Pattern-matches
 * likely secrets (JWT-shaped tokens, email addresses, `Bearer ...` headers
 * echoed into a body) rather than walking a key/value structure, since none
 * exists. Always returns a value the caller should still have a human look
 * at before committing (`docs/downstream-validation.md` says so explicitly).
 */
export function redactRawText(text: string): string {
  return text
    .replace(BEARER_RE, "Bearer <redacted:token>")
    .replace(JWT_RE, "<redacted:token>")
    .replace(EMAIL_RE, "<redacted:email>");
}
