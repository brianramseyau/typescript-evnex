/**
 * Immutable session token set — ported from `evnex/auth.py`'s `TokenSet`
 * (a frozen dataclass).
 *
 * `TokenSet` is immutable (`readonly` fields, `Object.freeze`d instances).
 * The constructor derives `expiresAt` from the access token's `exp` claim
 * when not supplied. `toJSON()`/`fromJSON()` key names (`access_token`,
 * `id_token`, `refresh_token`, `expires_at`) match Python's
 * `to_dict`/`from_dict` exactly, so the on-disk cache format stays
 * interchangeable with the Python CLI's.
 */

import { inspect } from "node:util";
import { decodeExpiry } from "./jwt.js";

export interface TokenSetOptions {
  accessToken?: string | undefined;
  idToken?: string | undefined;
  refreshToken?: string | undefined;
  expiresAt?: Date | undefined;
}

/** The on-disk / wire JSON shape, matching python-evnex's `to_dict`/`from_dict`. */
export interface TokenSetJSON {
  access_token: string | null;
  id_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
}

// A stored timestamp with no timezone designator (no trailing "Z" and no
// "+HH:MM"/"-HH:MM" offset). Python's datetime.fromisoformat() on such a
// string yields a naive datetime, and TokenSet.__post_init__ then labels it
// UTC. JS's Date parser instead treats a zone-less date-TIME string as
// *local* time — a real ambiguity, not just a formatting nuance, since the
// same cache file would decode to a different instant depending on the
// reading machine's timezone. We replicate Python's "naive means UTC" rule
// explicitly rather than falling into that default.
const HAS_TIMEZONE_DESIGNATOR = /(Z|[+-]\d{2}:?\d{2})$/;

function parseStoredTimestamp(value: string): Date | undefined {
  const normalized = HAS_TIMEZONE_DESIGNATOR.test(value) ? value : `${value}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export class TokenSet {
  readonly accessToken: string | undefined;
  readonly idToken: string | undefined;
  readonly refreshToken: string | undefined;
  readonly expiresAt: Date | undefined;

  constructor(options: TokenSetOptions = {}) {
    this.accessToken = options.accessToken;
    this.idToken = options.idToken;
    this.refreshToken = options.refreshToken;
    this.expiresAt =
      options.expiresAt ??
      (options.accessToken !== undefined ? decodeExpiry(options.accessToken) : undefined);
    Object.freeze(this);
  }

  toJSON(): TokenSetJSON {
    return {
      access_token: this.accessToken ?? null,
      id_token: this.idToken ?? null,
      refresh_token: this.refreshToken ?? null,
      expires_at: this.expiresAt ? this.expiresAt.toISOString() : null,
    };
  }

  static fromJSON(data: Partial<TokenSetJSON>): TokenSet {
    const rawExpiresAt = data.expires_at;
    const expiresAt =
      typeof rawExpiresAt === "string" ? parseStoredTimestamp(rawExpiresAt) : undefined;
    return new TokenSet({
      accessToken: data.access_token ?? undefined,
      idToken: data.id_token ?? undefined,
      refreshToken: data.refresh_token ?? undefined,
      expiresAt,
    });
  }

  /**
   * Redacted string form: tokens are secrets and must never land in logs.
   * Mirrors the Python dataclass's `repr=False` fields — only `expiresAt`
   * (never a secret) is shown.
   */
  toString(): string {
    return `TokenSet { expiresAt: ${this.expiresAt ? this.expiresAt.toISOString() : "undefined"} }`;
  }

  [inspect.custom](): string {
    return this.toString();
  }
}
