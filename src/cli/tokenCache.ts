/**
 * CLI session-token cache — ported from the cache helpers in
 * `evnex/cli/_auth.py` (`_default_cache`, `_load_tokens`, `_save_tokens_factory`).
 *
 * ⚠ `cli/_auth.py` is only 52% covered upstream (PLAN.md §6.3) — the
 * token-cache writer is entirely unverified there. The 0600 permission
 * behaviour is security-relevant; treat this as original work, not a port.
 *
 * TODO(A10): implement.
 *
 * - Default path `$XDG_CACHE_HOME/evnex/tokens.json` (falling back to
 *   `~/.cache`), overridable via `EVNEX_TOKEN_CACHE`.
 * - Writes must pin mode 0600 on pre-existing files too:
 *   `fs.open(path, "w", 0o600)` then `fchmod` — a plain write leaves an
 *   existing file's permissions alone.
 * - Unreadable caches warn on stderr and are ignored, never thrown.
 */

import type { TokenSet } from "../auth/tokens.js";

/** The token cache path: `$EVNEX_TOKEN_CACHE`, or the XDG default. */
export function defaultTokenCachePath(): string {
  throw new Error("TODO(A10)");
}

/** Read cached tokens, or `undefined` if there is no cache or it is unreadable. */
export function loadTokens(path: string): TokenSet | undefined {
  throw new Error("TODO(A10)");
}

/** Build an `onTokenUpdate` callback that persists to `path` with mode 0600. */
export function createTokenSaver(path: string): (tokens: TokenSet) => Promise<void> {
  throw new Error("TODO(A10)");
}

/** Delete the cache file, if present. Returns whether it existed. */
export async function removeTokenCache(path: string): Promise<boolean> {
  throw new Error("TODO(A10)");
}
