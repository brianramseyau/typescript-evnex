/**
 * Proves the schema sweep is read-only *structurally*, not just by
 * convention — PLAN.md's D5 sweep spec: "The sweep script must not import
 * the mutating client methods at all, so a future edit cannot quietly add
 * one."
 *
 * Two independent checks, either of which catching a regression is enough:
 *
 *  1. **Import-graph walk.** Starting from every file directly under
 *     `tools/schema-sweep/` (there is no single entry point that reaches
 *     100% of them import-wise in every direction, so each is walked as its
 *     own root), follow every relative import/export/dynamic-import
 *     specifier and assert `src/api.ts` — the one file that bundles all 8
 *     mutating `Evnex` methods together with the read ones — is never
 *     reached. Also asserts `src/index.ts` (the package barrel, which
 *     re-exports `Evnex` too) is never reached, since importing the barrel
 *     would be the same mistake one level removed.
 *  2. **Literal identifier grep**, as a second, independent line of defence
 *     in case a future edit reimplements one of the eight mutating
 *     operations locally under a different import path rather than calling
 *     `Evnex`'s method directly. Named explicitly, per the brief: the eight
 *     mutating methods on `Evnex` (`src/api.ts`) are
 *     `setChargePointOverride`, `stopChargePoint`, `enableCharger`,
 *     `disableCharger`, `setChargerAvailability`, `unlockCharger`,
 *     `setChargerLoadProfile`, `setChargePointSchedule`.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "..", "..");
const SWEEP_DIR = join(REPO_ROOT, "tools", "schema-sweep");
const SRC_API = join(REPO_ROOT, "src", "api.ts");
const SRC_INDEX = join(REPO_ROOT, "src", "index.ts");

const IMPORT_SPECIFIER_RE = /(?:from\s+|import\()\s*["']([^"']+)["']/g;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Resolve a relative specifier (always written with a ".js" extension, NodeNext-style) to the real .ts file on disk. */
function resolveRelativeSpecifier(fromFile: string, specifier: string): string {
  const target = resolve(dirname(fromFile), specifier);
  const asTs = target.endsWith(".js") ? target.slice(0, -3) + ".ts" : target;
  if (!existsSync(asTs)) {
    throw new Error(
      `readonly-import.test.ts's walker could not resolve "${specifier}" imported from ` +
        `${fromFile} (tried ${asTs}) — the walker itself may need updating, this is not ` +
        "necessarily a real read-only violation.",
    );
  }
  return asTs;
}

/** Every file reachable from `roots` by following relative imports/exports/dynamic imports, transitively. */
function walkImportGraph(roots: readonly string[]): Set<string> {
  const visited = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);

    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(IMPORT_SPECIFIER_RE)) {
      const specifier = match[1];
      if (specifier === undefined || !specifier.startsWith(".")) continue; // external package, not followed
      const resolved = resolveRelativeSpecifier(file, specifier);
      if (!visited.has(resolved)) queue.push(resolved);
    }
  }

  return visited;
}

describe("schema sweep is read-only", () => {
  it("never reaches src/api.ts or src/index.ts from any file in tools/schema-sweep/", () => {
    const roots = listTsFiles(SWEEP_DIR);
    expect(roots.length).toBeGreaterThan(0); // otherwise this test is vacuously true

    const reached = walkImportGraph(roots);

    expect(reached.has(SRC_API)).toBe(false);
    expect(reached.has(SRC_INDEX)).toBe(false);
  });

  it("never imports 'evnex' (the published package name, resolving to the same barrel)", () => {
    for (const file of listTsFiles(SWEEP_DIR)) {
      const text = readFileSync(file, "utf8");
      // Bare "evnex" / "evnex/..." specifiers (not "evnex-something-else").
      expect(text).not.toMatch(/from\s+["']evnex(\/|["'])/);
    }
  });

  const MUTATING_METHOD_NAMES = [
    "setChargePointOverride",
    "stopChargePoint",
    "enableCharger",
    "disableCharger",
    "setChargerAvailability",
    "unlockCharger",
    "setChargerLoadProfile",
    "setChargePointSchedule",
  ] as const;

  it.each(MUTATING_METHOD_NAMES)(
    "never references the mutating method name %s anywhere under tools/schema-sweep/",
    (methodName) => {
      const wordBoundary = new RegExp(`\\b${methodName}\\b`);
      for (const file of listTsFiles(SWEEP_DIR)) {
        const text = readFileSync(file, "utf8");
        expect(text, `${file} references "${methodName}"`).not.toMatch(wordBoundary);
      }
    },
  );

  it("confirms src/api.ts genuinely does define all 8 mutating methods named above (so this test would actually catch a rename)", () => {
    const apiSource = readFileSync(SRC_API, "utf8");
    for (const methodName of MUTATING_METHOD_NAMES) {
      expect(
        apiSource,
        `src/api.ts no longer defines ${methodName} — update this test's list`,
      ).toMatch(new RegExp(`\\basync ${methodName}\\b`));
    }
  });
});
