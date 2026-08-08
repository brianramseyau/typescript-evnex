/**
 * Immutable session token set — ported from `evnex/auth.py`'s `TokenSet`
 * (a frozen dataclass).
 *
 * TODO(A7): implement. `TokenSet` must be immutable (`readonly` fields,
 * `Object.freeze`d instances). The constructor derives `expiresAt` from the
 * access token's `exp` claim when not supplied (via `decodeExpiry` from
 * `./jwt.js`), and normalises a naive/ambiguous stored timestamp to UTC.
 * `toJSON()`/`fromJSON()` key names (`access_token`, `id_token`,
 * `refresh_token`, `expires_at`) must match Python's `to_dict`/`from_dict`
 * exactly — the on-disk cache format stays interchangeable with the Python
 * CLI's.
 */

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

export class TokenSet {
  readonly accessToken: string | undefined;
  readonly idToken: string | undefined;
  readonly refreshToken: string | undefined;
  readonly expiresAt: Date | undefined;

  constructor(options: TokenSetOptions = {}) {
    this.accessToken = options.accessToken;
    this.idToken = options.idToken;
    this.refreshToken = options.refreshToken;
    this.expiresAt = options.expiresAt;
    throw new Error("TODO(A7)");
  }

  toJSON(): TokenSetJSON {
    throw new Error("TODO(A7)");
  }

  static fromJSON(data: Partial<TokenSetJSON>): TokenSet {
    throw new Error("TODO(A7)");
  }
}
