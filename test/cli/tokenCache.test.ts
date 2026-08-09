import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTokenSaver,
  defaultTokenCachePath,
  loadTokens,
  removeTokenCache,
} from "../../src/cli/tokenCache.js";
import { TokenSet } from "../../src/auth/tokens.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "evnex-token-cache-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("defaultTokenCachePath", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv["EVNEX_TOKEN_CACHE"] = process.env["EVNEX_TOKEN_CACHE"];
    savedEnv["XDG_CACHE_HOME"] = process.env["XDG_CACHE_HOME"];
    delete process.env["EVNEX_TOKEN_CACHE"];
    delete process.env["XDG_CACHE_HOME"];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("honours EVNEX_TOKEN_CACHE when set", () => {
    process.env["EVNEX_TOKEN_CACHE"] = "/custom/path/tokens.json";
    expect(defaultTokenCachePath()).toBe("/custom/path/tokens.json");
  });

  it("ignores an empty EVNEX_TOKEN_CACHE and falls back to XDG", () => {
    process.env["EVNEX_TOKEN_CACHE"] = "";
    process.env["XDG_CACHE_HOME"] = "/xdg-cache";
    expect(defaultTokenCachePath()).toBe(join("/xdg-cache", "evnex", "tokens.json"));
  });

  it("uses XDG_CACHE_HOME/evnex/tokens.json when set", () => {
    process.env["XDG_CACHE_HOME"] = "/xdg-cache";
    expect(defaultTokenCachePath()).toBe(join("/xdg-cache", "evnex", "tokens.json"));
  });

  it("falls back to ~/.cache/evnex/tokens.json when XDG_CACHE_HOME is unset", () => {
    expect(defaultTokenCachePath()).toBe(join(homedir(), ".cache", "evnex", "tokens.json"));
  });

  it("falls back to ~/.cache when XDG_CACHE_HOME is empty", () => {
    process.env["XDG_CACHE_HOME"] = "";
    expect(defaultTokenCachePath()).toBe(join(homedir(), ".cache", "evnex", "tokens.json"));
  });
});

describe("loadTokens", () => {
  let stderr: string[];

  beforeEach(() => {
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined, silently, when the file does not exist", () => {
    expect(loadTokens(join(dir, "missing.json"))).toBeUndefined();
    expect(stderr).toEqual([]);
  });

  it("returns undefined, silently, when the path is a directory", () => {
    const asDir = join(dir, "tokens.json");
    mkdirSync(asDir);
    expect(loadTokens(asDir)).toBeUndefined();
    expect(stderr).toEqual([]);
  });

  it("reads back a previously-saved TokenSet", () => {
    const path = join(dir, "tokens.json");
    const tokens = new TokenSet({
      accessToken: "access-0",
      idToken: "id-0",
      refreshToken: "refresh-0",
    });
    writeFileSync(path, JSON.stringify(tokens.toJSON()));

    const loaded = loadTokens(path);
    expect(loaded).toBeInstanceOf(TokenSet);
    expect(loaded?.accessToken).toBe("access-0");
    expect(loaded?.idToken).toBe("id-0");
    expect(loaded?.refreshToken).toBe("refresh-0");
  });

  it("warns and returns undefined for malformed JSON", () => {
    const path = join(dir, "tokens.json");
    writeFileSync(path, "not json");
    expect(loadTokens(path)).toBeUndefined();
    expect(stderr.join("")).toContain(`Ignoring unreadable token cache at ${path}`);
  });

  it("warns and returns undefined for valid JSON that is not a token object", () => {
    const path = join(dir, "tokens.json");
    writeFileSync(path, "null");
    expect(loadTokens(path)).toBeUndefined();
    expect(stderr.join("")).toContain(`Ignoring unreadable token cache at ${path}`);
  });

  it("warns and returns undefined for a read failure that isn't ENOENT/EISDIR", () => {
    // A path where a parent segment is a regular file gives ENOTDIR, not
    // ENOENT/EISDIR — this exercises the "genuinely unreadable" branch
    // rather than the silent "nothing there" one.
    const notADir = join(dir, "notadir");
    writeFileSync(notADir, "x");
    const path = join(notADir, "tokens.json");

    expect(loadTokens(path)).toBeUndefined();
    expect(stderr.join("")).toContain(`Ignoring unreadable token cache at ${path}`);
  });
});

describe("createTokenSaver", () => {
  it("writes the TokenSet's JSON to the target path", async () => {
    const path = join(dir, "tokens.json");
    const save = createTokenSaver(path);
    const tokens = new TokenSet({ accessToken: "access-1", idToken: "id-1" });

    await save(tokens);

    const written = JSON.parse(readFileSync(path, "utf8")) as unknown;
    expect(written).toEqual(tokens.toJSON());
  });

  it("creates missing parent directories", async () => {
    const path = join(dir, "nested", "deeper", "tokens.json");
    const save = createTokenSaver(path);

    await save(new TokenSet({ accessToken: "access-2" }));

    expect(statSync(path).isFile()).toBe(true);
  });

  it("creates a new file with mode 0600", async () => {
    const path = join(dir, "tokens.json");
    const save = createTokenSaver(path);

    await save(new TokenSet({ accessToken: "access-3" }));

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("pins mode 0600 on an overwrite too, even if the file was world-readable", async () => {
    const path = join(dir, "tokens.json");
    writeFileSync(path, "{}", { mode: 0o644 });
    expect(statSync(path).mode & 0o777).toBe(0o644); // sanity check the starting mode

    const save = createTokenSaver(path);
    await save(new TokenSet({ accessToken: "access-4" }));

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe("removeTokenCache", () => {
  it("returns false when there is nothing to remove", async () => {
    await expect(removeTokenCache(join(dir, "missing.json"))).resolves.toBe(false);
  });

  it("returns false, without unlinking, when the path is a directory", async () => {
    const asDir = join(dir, "tokens.json");
    mkdirSync(asDir);
    await expect(removeTokenCache(asDir)).resolves.toBe(false);
    expect(statSync(asDir).isDirectory()).toBe(true);
  });

  it("unlinks an existing cache file and returns true", async () => {
    const path = join(dir, "tokens.json");
    writeFileSync(path, "{}");
    await expect(removeTokenCache(path)).resolves.toBe(true);
    expect(() => statSync(path)).toThrow();
  });

  it("propagates a stat failure that is not ENOENT", async () => {
    const notADir = join(dir, "notadir");
    writeFileSync(notADir, "x");
    const path = join(notADir, "tokens.json");
    await expect(removeTokenCache(path)).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});
