/**
 * CLI session-token cache — ported from the cache helpers in
 * `evnex/cli/_auth.py` (`_default_cache`, `_load_tokens`, `_save_tokens_factory`).
 *
 * ⚠ `cli/_auth.py` is only 52% covered upstream (PLAN.md §6.3) — the
 * token-cache writer is entirely unverified there. The 0600 permission
 * behaviour is security-relevant; treat this as original work, not a port.
 *
 * - Default path `$XDG_CACHE_HOME/evnex/tokens.json` (falling back to
 *   `~/.cache`), overridable via `EVNEX_TOKEN_CACHE`.
 * - Writes must pin mode 0600 on pre-existing files too:
 *   `fs.open(path, "w", 0o600)` then `fchmod` — a plain write leaves an
 *   existing file's permissions alone (`open()`'s mode argument only
 *   applies at *creation* time, never to a file that already exists).
 * - Unreadable caches warn on stderr and are ignored, never thrown. This is
 *   a deliberate broadening of Python's behaviour: `_load_tokens` there only
 *   catches `(ValueError, KeyError)` (bad JSON / missing keys), so a
 *   permission-denied read would propagate as an uncaught exception. Since
 *   a cache is always disposable — deleting it just forces a re-login — we
 *   fold every "could not use this cache file" outcome into the same warn
 *   path here.
 */

import { promises as fs, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { TokenSet } from "../auth/tokens.js";
import type { TokenSetJSON } from "../auth/tokens.js";

/** The token cache path: `$EVNEX_TOKEN_CACHE`, or the XDG default. */
export function defaultTokenCachePath(): string {
  const override = process.env["EVNEX_TOKEN_CACHE"];
  if (override !== undefined && override.length > 0) return override;

  const xdgCacheHome = process.env["XDG_CACHE_HOME"];
  const cacheHome =
    xdgCacheHome !== undefined && xdgCacheHome.length > 0
      ? xdgCacheHome
      : join(homedir(), ".cache");
  return join(cacheHome, "evnex", "tokens.json");
}

/** True for the errno codes that mean "there is nothing here to read" (silent, not a warning). */
function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  // ENOENT: no such path. EISDIR: the path is a directory, not a cache
  // file — matches Python's `cache.is_file()` guard, which is silently
  // false (no warning) for both.
  return code === "ENOENT" || code === "EISDIR";
}

/**
 * Read cached tokens, or `undefined` if there is no cache or it is
 * unreadable. Synchronous, matching Python's `_load_tokens`: it runs once,
 * before any session work has started, so there is nothing for a blocking
 * read to contend with (PLAN.md §2.3 deletes `asyncio.to_thread` wrappers
 * for exactly this reason — Node has no event loop to protect here either).
 */
export function loadTokens(path: string): TokenSet | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      process.stderr.write(`Ignoring unreadable token cache at ${path}\n`);
    }
    return undefined;
  }

  try {
    const data = JSON.parse(raw) as Partial<TokenSetJSON>;
    return TokenSet.fromJSON(data);
  } catch {
    process.stderr.write(`Ignoring unreadable token cache at ${path}\n`);
    return undefined;
  }
}

/** Build an `onTokenUpdate` callback that persists to `path` with mode 0600. */
export function createTokenSaver(path: string): (tokens: TokenSet) => Promise<void> {
  return async (tokens: TokenSet): Promise<void> => {
    await fs.mkdir(dirname(path), { recursive: true });
    // `open()`'s mode argument only pins permissions when it *creates* the
    // file; a pre-existing file keeps whatever mode it already had. The
    // explicit `chmod` after opening is what makes this correct on
    // overwrite too — that's the exact case a plain `writeFile` gets wrong.
    const handle = await fs.open(path, "w", 0o600);
    try {
      await handle.chmod(0o600);
      await handle.writeFile(JSON.stringify(tokens.toJSON()), "utf8");
    } finally {
      await handle.close();
    }
  };
}

/** Delete the cache file, if present. Returns whether it existed. */
export async function removeTokenCache(path: string): Promise<boolean> {
  let stat;
  try {
    stat = await fs.stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isFile()) return false;
  await fs.unlink(path);
  return true;
}
