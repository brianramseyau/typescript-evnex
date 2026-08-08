import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { TokenSet } from "../../src/auth/tokens.js";
import type { TokenSetJSON } from "../../src/auth/tokens.js";

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** A structurally valid (unsigned) access token with an `exp` claim — the
 * TS analogue of conftest.py's `make_jwt`. `decodeExpiry` never checks the
 * signature, so an empty third segment is fine. */
function makeJwt(expiresInSeconds = 24 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ exp })}.`;
}

describe("TokenSet", () => {
  // Mirrors python-evnex's TestTokenSet.test_round_trips_through_dict.
  it("round-trips through to_dict/from_dict-equivalent JSON", () => {
    const tokens = new TokenSet({
      accessToken: makeJwt(),
      idToken: "id",
      refreshToken: "refresh",
    });

    const restored = TokenSet.fromJSON(tokens.toJSON());

    expect(restored).toEqual(tokens);
  });

  // Mirrors test_expiry_derived_from_jwt_when_missing.
  it("derives expiresAt from the access token's exp claim when missing", () => {
    const data: Partial<TokenSetJSON> = {
      access_token: makeJwt(3600),
      refresh_token: "r",
    };

    const tokens = TokenSet.fromJSON(data);

    expect(tokens.expiresAt).toBeInstanceOf(Date);
  });

  // Mirrors test_repr_redacts_tokens: tokens are secrets and must never
  // leak into a log line via string coercion or util.inspect.
  it("redacts token values from toString() and util.inspect()", () => {
    const tokens = new TokenSet({
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
      idToken: "secret-id",
    });

    expect(tokens.toString()).not.toContain("secret");
    expect(inspect(tokens)).not.toContain("secret");
    expect(String(tokens)).not.toContain("secret");
  });

  it("toString still reports expiresAt, which is not a secret", () => {
    const tokens = new TokenSet({ expiresAt: new Date("2024-01-01T00:00:00.000Z") });
    expect(tokens.toString()).toContain("2024-01-01T00:00:00.000Z");
  });

  it("is constructible with only a refresh token", () => {
    const tokens = new TokenSet({ refreshToken: "refresh-0" });
    expect(tokens.accessToken).toBeUndefined();
    expect(tokens.idToken).toBeUndefined();
    expect(tokens.refreshToken).toBe("refresh-0");
    expect(tokens.expiresAt).toBeUndefined();
  });

  it("is deeply immutable", () => {
    const tokens = new TokenSet({ accessToken: "a" });
    expect(Object.isFrozen(tokens)).toBe(true);
    expect(() => {
      (tokens as unknown as { accessToken: string }).accessToken = "changed";
    }).toThrow();
  });

  it("an explicit expiresAt wins over deriving one from the access token", () => {
    const explicit = new Date("2030-01-01T00:00:00.000Z");
    const tokens = new TokenSet({ accessToken: makeJwt(60), expiresAt: explicit });
    expect(tokens.expiresAt).toBe(explicit);
  });

  it("leaves expiresAt undefined with neither an access token nor an explicit value", () => {
    const tokens = new TokenSet({ refreshToken: "r" });
    expect(tokens.expiresAt).toBeUndefined();
  });

  describe("toJSON", () => {
    it("uses python-evnex's to_dict key names exactly", () => {
      const tokens = new TokenSet({
        accessToken: "a",
        idToken: "i",
        refreshToken: "r",
        expiresAt: new Date("2024-06-01T12:30:00.000Z"),
      });

      expect(tokens.toJSON()).toEqual({
        access_token: "a",
        id_token: "i",
        refresh_token: "r",
        expires_at: "2024-06-01T12:30:00.000Z",
      });
      expect(Object.keys(tokens.toJSON()).sort()).toEqual(
        ["access_token", "expires_at", "id_token", "refresh_token"].sort(),
      );
    });

    it("represents an entirely empty token set as all-null fields", () => {
      const tokens = new TokenSet();
      expect(tokens.toJSON()).toEqual({
        access_token: null,
        id_token: null,
        refresh_token: null,
        expires_at: null,
      });
    });

    it("is used automatically by JSON.stringify", () => {
      const tokens = new TokenSet({ accessToken: "a", refreshToken: "r" });
      const parsed = JSON.parse(JSON.stringify(tokens)) as TokenSetJSON;
      expect(parsed.access_token).toBe("a");
      expect(parsed.refresh_token).toBe("r");
    });
  });

  describe("fromJSON", () => {
    it("treats missing optional fields as undefined", () => {
      const tokens = TokenSet.fromJSON({ access_token: "a" });
      expect(tokens.idToken).toBeUndefined();
      expect(tokens.refreshToken).toBeUndefined();
    });

    it("treats explicit nulls the same as missing fields", () => {
      const tokens = TokenSet.fromJSON({
        access_token: null,
        id_token: null,
        refresh_token: "r",
        expires_at: null,
      });
      expect(tokens.accessToken).toBeUndefined();
      expect(tokens.idToken).toBeUndefined();
      expect(tokens.refreshToken).toBe("r");
      expect(tokens.expiresAt).toBeUndefined();
    });

    // A stored timestamp with no timezone designator must be read as UTC —
    // matching Python's __post_init__ normalisation — rather than JS's
    // default of treating a zone-less date-time string as local time.
    it("normalises a naive (timezone-less) stored timestamp to UTC", () => {
      const tokens = TokenSet.fromJSON({ expires_at: "2024-01-01T00:00:00" });
      expect(tokens.expiresAt?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    });

    it("parses a stored timestamp with a 'Z' suffix", () => {
      const tokens = TokenSet.fromJSON({ expires_at: "2024-01-01T00:00:00Z" });
      expect(tokens.expiresAt?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    });

    it("parses a stored timestamp with an explicit non-UTC offset", () => {
      // Python's isoformat() on an aware datetime emits "+HH:MM"; this is
      // exactly what a cache file written by the Python CLI contains.
      const tokens = TokenSet.fromJSON({ expires_at: "2024-01-01T02:00:00+02:00" });
      expect(tokens.expiresAt?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    });

    it("returns undefined expiresAt for an unparseable timestamp string", () => {
      const tokens = TokenSet.fromJSON({ expires_at: "not-a-timestamp" });
      expect(tokens.expiresAt).toBeUndefined();
    });
  });

  describe("Python cache-file interchangeability", () => {
    it("parses a cache file written by the Python CLI (to_dict output)", () => {
      // Literal JSON as python-evnex's TokenSet.to_dict() -> json.dumps
      // would produce it: an aware datetime's isoformat() with a "+00:00"
      // offset.
      const pythonCacheFile =
        '{"access_token": "py-access", "id_token": "py-id", ' +
        '"refresh_token": "py-refresh", "expires_at": "2025-03-15T09:00:00+00:00"}';

      const tokens = TokenSet.fromJSON(JSON.parse(pythonCacheFile) as TokenSetJSON);

      expect(tokens.accessToken).toBe("py-access");
      expect(tokens.idToken).toBe("py-id");
      expect(tokens.refreshToken).toBe("py-refresh");
      expect(tokens.expiresAt?.toISOString()).toBe("2025-03-15T09:00:00.000Z");
    });

    it("writes a cache file whose keys match Python's to_dict exactly", () => {
      const tokens = new TokenSet({
        accessToken: "a",
        idToken: "i",
        refreshToken: "r",
        expiresAt: new Date("2025-03-15T09:00:00.000Z"),
      });

      const json = tokens.toJSON();
      expect(Object.keys(json).sort()).toEqual(
        ["access_token", "id_token", "refresh_token", "expires_at"].sort(),
      );
      // A Python `TokenSet.from_dict(json.loads(<this>))` would read the
      // same isoformat-compatible offset form.
      expect(json.expires_at).toMatch(/Z$/);
    });
  });
});
