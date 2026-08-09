#!/usr/bin/env node
/* global process, console, URL */
// See `check-readme-samples.mjs`'s header for why this directive comment is
// needed: this file is outside the `src/**`/`test/**`/`examples/**` globs
// `eslint.config.js` scopes Node-aware rules to.
/**
 * Release-tarball verification — PLAN.md Wave 4 / D4.
 *
 * Builds the package, `npm pack`s it, and installs the *tarball* (never the
 * repo directly, and never `npm link`) into two disposable directories
 * outside the repo:
 *
 *   1. A normal install (optional `qrcode` present) — proves `npx evnex
 *      --version` actually runs from what a real `npm install evnex` would
 *      produce, via npm's own bin-symlink mechanism in `node_modules/.bin`
 *      (exactly what `npx` resolves to for an already-installed package).
 *   2. An install with `--omit=optional` (`qrcode` genuinely absent from
 *      `node_modules`, not just unused) — proves the CLI's MFA-enrollment
 *      QR path degrades to printing the `otpauth://` URI instead of
 *      crashing, exercising the *installed* `dist/cli/qr.js`, not a mock.
 *
 * Exits non-zero (and prints exactly what failed) if either check fails.
 * Nothing here mutates the working tree beyond the build output already
 * covered by `.gitignore`, and nothing publishes anywhere.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** @type {string[]} */
const failures = [];
function fail(message) {
  failures.push(message);
  console.error(`  FAIL: ${message}`);
}
function ok(message) {
  console.log(`  ok:   ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  return result;
}

console.log("== 1. Build ==");
execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });

console.log("\n== 2. Pack ==");
const packRoot = mkdtempSync(join(tmpdir(), "evnex-pack-"));
const packOutput = execFileSync(
  "npm",
  ["pack", "--pack-destination", packRoot, "--json"],
  { cwd: repoRoot, encoding: "utf8" },
);
const [packInfo] = JSON.parse(packOutput);
const tarballPath = join(packRoot, packInfo.filename);
console.log(`  tarball: ${tarballPath} (${packInfo.entryCount} entries)`);

// Sanity-check tarball contents: only what `files` declares (plus the
// npm-always-included package.json), never dev-only directories.
const forbidden = ["foundational/", "examples/", "scripts/", "test/", "coverage/"];
const hit = (packInfo.files ?? [])
  .map((f) => f.path)
  .filter((p) => forbidden.some((f) => p.startsWith(f)));
if (hit.length > 0) {
  fail(`tarball contains files it should not: ${hit.join(", ")}`);
} else {
  ok("tarball excludes foundational/, examples/, scripts/, test/, coverage/");
}

console.log("\n== 3. Install into a clean directory (qrcode present) ==");
const withOptDir = mkdtempSync(join(tmpdir(), "evnex-install-with-optional-"));
execFileSync("npm", ["init", "-y"], { cwd: withOptDir, stdio: "ignore" });
execFileSync("npm", ["install", tarballPath], { cwd: withOptDir, stdio: "inherit" });

const binPath = join(withOptDir, "node_modules", ".bin", "evnex");
const versionResult = run(binPath, ["--version"], { cwd: withOptDir });
console.log(
  `  \`node_modules/.bin/evnex --version\` -> exit ${versionResult.status}, ` +
    `stdout=${JSON.stringify(versionResult.stdout)}, stderr=${JSON.stringify(versionResult.stderr)}`,
);
if (
  versionResult.status === 0 &&
  /evnex \d+\.\d+\.\d+/.test(versionResult.stdout ?? "")
) {
  ok(`--version prints a sensible version string via the installed bin shim`);
} else {
  fail(
    "`evnex --version`, invoked the way `npx evnex --version` invokes it (through the " +
      "`node_modules/.bin/evnex` symlink npm creates for the package's `bin` entry), " +
      "produced no usable output. This is a bug in src/cli/index.ts's entrypoint " +
      "detection, not a release-engineering config problem — see this script's exit " +
      "report for the root cause.",
  );
}

console.log(
  "\n== 4. Install into a clean directory with --omit=optional (qrcode absent) ==",
);
const noOptDir = mkdtempSync(join(tmpdir(), "evnex-install-no-optional-"));
execFileSync("npm", ["init", "-y"], { cwd: noOptDir, stdio: "ignore" });
execFileSync("npm", ["install", "--omit=optional", tarballPath], {
  cwd: noOptDir,
  stdio: "inherit",
});

const qrcodeCheck = run("node", ["-e", "require.resolve('qrcode')"], { cwd: noOptDir });
if (qrcodeCheck.status === 0) {
  fail(
    "qrcode resolved even though it was installed with --omit=optional; test is invalid",
  );
} else {
  ok("qrcode is genuinely absent from node_modules in this install");
}

// Exercise the installed dist/cli/qr.js's `showQr` directly — not a mock,
// the real built file from the tarball above — and confirm the documented
// fallback (print the otpauth:// URI's caller already printed it; here we
// only need the "(install the qrcode package...)" stderr notice, no throw,
// no attempt to render terminal ASCII art).
const qrProbe = `
import { showQr } from ${JSON.stringify(join(noOptDir, "node_modules", "evnex", "dist", "cli", "qr.js"))};
try {
  await showQr("otpauth://totp/evnex-test?secret=JBSWY3DPEHPK3PXP&issuer=evnex");
  process.exit(0);
} catch (err) {
  console.error("THREW:", err);
  process.exit(1);
}
`;
const qrProbePath = join(noOptDir, "probe-qr.mjs");
writeFileSync(qrProbePath, qrProbe);
const qrRun = run("node", [qrProbePath], { cwd: noOptDir });
console.log(
  `  showQr() with qrcode absent -> exit ${qrRun.status}, stderr=${JSON.stringify(qrRun.stderr)}`,
);
if (
  qrRun.status === 0 &&
  (qrRun.stderr ?? "").includes("install the qrcode package for a scannable QR code")
) {
  ok("showQr() degrades to the otpauth:// fallback notice with qrcode absent, no throw");
} else {
  fail(
    "showQr() did not degrade gracefully with qrcode absent (see stdout/stderr above); " +
      "the CLI's documented optional-dependency fallback is broken.",
  );
}

console.log("\n== cleanup ==");
for (const dir of [withOptDir, noOptDir, packRoot]) {
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nverify-release-tarball FAILED (${failures.length} issue(s) above).`);
  process.exitCode = 1;
} else {
  console.log("\nverify-release-tarball passed.");
}
