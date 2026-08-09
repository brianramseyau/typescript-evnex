#!/usr/bin/env node
/* global process, console, URL */
// See the `check-readme-samples.mjs` header for why this directive comment
// is needed: this file sits outside the `src/**`/`test/**`/`examples/**`
// globs `eslint.config.js` scopes Node-aware rules to.
/**
 * Dependency gate — PLAN.md §0 / Wave 4 D4.
 *
 * Enforces the supply-chain shape the plan settled on:
 *
 *  1. `dependencies` is *exactly* `{ "@aws-sdk/client-cognito-identity-provider",
 *     "zod" }` — the §0 table, no more, no less, no version-range drift
 *     unnoticed.
 *  2. `optionalDependencies` is *exactly* `{ "qrcode" }` — it must never
 *     become a hard dependency.
 *  3. `amazon-cognito-identity-js` (the dev-only differential SRP oracle,
 *     PLAN.md §10.7) never appears in `dependencies` or
 *     `optionalDependencies`, and is confirmed absent from the resolved
 *     production install graph — not just absent from the declared fields.
 *  4. The total size of the published runtime graph (dependencies +
 *     optionalDependencies, transitively, deduplicated by `name@version`,
 *     computed from the *committed* package-lock.json via
 *     `npm ls --all --omit=dev --json` — deterministic, no registry call)
 *     has not grown past the committed baseline
 *     (`scripts/dependency-baseline.json`) without that baseline being
 *     bumped in the same change. An unexplained increase fails the gate;
 *     a deliberate one is "explained" by updating the baseline file itself.
 *
 * This does not install anything and makes no network call — it reads
 * `package.json` plus whatever `npm ls` can already see in the local
 * `node_modules` (populated by `npm ci` earlier in the CI job).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const EXPECTED_DEPENDENCIES = {
  "@aws-sdk/client-cognito-identity-provider": "^3",
  zod: "^4",
};
const EXPECTED_OPTIONAL_DEPENDENCIES = {
  qrcode: "^1.5",
};
const FORBIDDEN_IN_RUNTIME = "amazon-cognito-identity-js";

/** @type {string[]} */
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sameShape(actual, expected, label) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.join(",") !== expectedKeys.join(",")) {
    fail(
      `${label}: expected exactly [${expectedKeys.join(", ")}], got [${actualKeys.join(", ")}]`,
    );
    return;
  }
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) {
      fail(`${label}.${key}: expected "${expected[key]}", got "${actual[key]}"`);
    }
  }
}

const pkg = readJson(new URL("../package.json", import.meta.url));

sameShape(pkg.dependencies ?? {}, EXPECTED_DEPENDENCIES, "dependencies");
sameShape(
  pkg.optionalDependencies ?? {},
  EXPECTED_OPTIONAL_DEPENDENCIES,
  "optionalDependencies",
);

if (FORBIDDEN_IN_RUNTIME in (pkg.dependencies ?? {})) {
  fail(`${FORBIDDEN_IN_RUNTIME} must not appear in "dependencies"`);
}
if (FORBIDDEN_IN_RUNTIME in (pkg.optionalDependencies ?? {})) {
  fail(`${FORBIDDEN_IN_RUNTIME} must not appear in "optionalDependencies"`);
}
if (!(FORBIDDEN_IN_RUNTIME in (pkg.devDependencies ?? {}))) {
  fail(
    `${FORBIDDEN_IN_RUNTIME} is expected in "devDependencies" (it is A5's differential ` +
      "SRP test oracle, PLAN.md §10.7) but was not found there. If it was intentionally " +
      "removed, update this script's expectation too.",
  );
}

// -- Resolved-graph checks: walk what npm actually installed, not just what
// package.json declares. Catches the case where a transitive dependency of
// one of our two runtime packages somehow pulls the forbidden package back
// in, which the field-level checks above cannot see.
let lsOutput;
try {
  lsOutput = execFileSync("npm", ["ls", "--all", "--omit=dev", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  // `npm ls` exits non-zero for tree problems (extraneous/invalid/missing)
  // but still writes the JSON tree to stdout; only give up if there is no
  // parseable output at all.
  const stdout = /** @type {{ stdout?: string }} */ (error).stdout;
  if (typeof stdout === "string" && stdout.length > 0) {
    lsOutput = stdout;
  } else {
    fail(`npm ls failed with no output: ${/** @type {Error} */ (error).message}`);
    lsOutput = undefined;
  }
}

let total = undefined;
let requiredOnly = undefined;
const breakdown = {};

if (lsOutput !== undefined) {
  const tree = JSON.parse(lsOutput);

  const collect = (deps) => {
    const seen = new Set();
    const walk = (node) => {
      if (node === undefined) return;
      for (const [name, info] of Object.entries(node)) {
        const key = `${name}@${info.version ?? "?"}`;
        if (!seen.has(key)) {
          seen.add(key);
          walk(info.dependencies);
        }
      }
    };
    walk(deps);
    return seen;
  };

  const topLevel = tree.dependencies ?? {};
  const all = collect(topLevel);
  total = all.size;

  if (
    all.has(`${FORBIDDEN_IN_RUNTIME}@${topLevel[FORBIDDEN_IN_RUNTIME]?.version ?? "?"}`)
  ) {
    fail(`${FORBIDDEN_IN_RUNTIME} is reachable from the production install graph`);
  }
  for (const key of all) {
    if (key.startsWith(`${FORBIDDEN_IN_RUNTIME}@`)) {
      fail(
        `${FORBIDDEN_IN_RUNTIME} is reachable from the production install graph (${key})`,
      );
    }
  }

  for (const [name, info] of Object.entries(topLevel)) {
    breakdown[name] = collect({ [name]: info }).size;
  }
  const optionalNames = Object.keys(EXPECTED_OPTIONAL_DEPENDENCIES);
  const requiredTrees = Object.entries(topLevel).filter(
    ([name]) => !optionalNames.includes(name),
  );
  requiredOnly = collect(Object.fromEntries(requiredTrees)).size;
}

const baseline = readJson(new URL("./dependency-baseline.json", import.meta.url));

console.log("Dependency gate — published runtime graph");
console.log(`  dependencies:          ${JSON.stringify(pkg.dependencies)}`);
console.log(`  optionalDependencies:  ${JSON.stringify(pkg.optionalDependencies)}`);
console.log(`  per-package transitive counts: ${JSON.stringify(breakdown)}`);
console.log(`  total (deps + optional, deduped): ${total} (baseline: ${baseline.total})`);
console.log(
  `  required-only (no qrcode):        ${requiredOnly} (baseline: ${baseline.requiredOnly})`,
);

if (total !== undefined && total > baseline.total) {
  fail(
    `Total transitive runtime package count grew from ${baseline.total} to ${total} ` +
      "without the baseline (scripts/dependency-baseline.json) being updated. " +
      "If this growth is expected (a version bump pulled in a new transitive dependency), " +
      "update the baseline in the same change and say why. If not, a dependency was added " +
      "or a range widened unexpectedly — investigate before merging.",
  );
}
if (requiredOnly !== undefined && requiredOnly > baseline.requiredOnly) {
  fail(
    `Required-only (non-optional) transitive package count grew from ` +
      `${baseline.requiredOnly} to ${requiredOnly} without the baseline being updated.`,
  );
}

if (failures.length > 0) {
  console.error("\nDependency gate FAILED:");
  for (const message of failures) {
    console.error(`  - ${message}`);
  }
  process.exitCode = 1;
} else {
  console.log("\nDependency gate passed.");
}
