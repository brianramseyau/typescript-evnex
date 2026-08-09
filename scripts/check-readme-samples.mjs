#!/usr/bin/env node
/* global process, console */
// This file sits outside the `src/**` / `test/**` / `examples/**` globs
// `eslint.config.js` scopes its rules to, so it only ever gets the base
// `js.configs.recommended` layer — which has no Node globals — rather than
// a Node-aware env. Declaring them here (a standard ESLint directive
// comment, unaffected by flat-config's lack of `/* eslint-env */` support)
// is the fix available without editing `eslint.config.js`, which is outside
// this agent's remit.
/**
 * Extracts every fenced ```ts / ```typescript block from README.md and
 * type-checks it with the project's own `tsconfig.json` (same strictness,
 * same TypeScript version — `node_modules/.bin/tsc`).
 *
 * README samples are fragments, not whole programs: they reference a
 * `Evnex`/`EvnexAuth` imported in an earlier, separate code block, or a
 * variable (`code`, `username`, `myStore`, ...) the surrounding prose implies
 * without declaring. Each block is compiled on its own — README readers copy
 * one block at a time — so this script gives every block a small preamble
 * supplying exactly two things, and nothing else:
 *
 *  1. An import for any of this package's own exports (`Evnex`, `EvnexAuth`,
 *     `TokenSet`, `isAuthChallenge`) the block *uses* but does not itself
 *     import. Skipped when the block already imports that name itself, so a
 *     block's own (possibly wrong) import is never silently overridden.
 *  2. An ambient `declare const`/`declare function` for a small, fixed
 *     vocabulary of "the reader is assumed to already have this" free
 *     variables the README's prose sets up but a single fenced block can't
 *     (e.g. `username`, `promptForCode`, `myStore`). Skipped the same way if
 *     the block declares the name itself.
 *
 * Nothing else is added or rewritten: no `@ts-ignore`, no `any`, no widened
 * types, no stripped statements. A sample that is genuinely broken — a typo,
 * a wrong method name, a type mismatch against the real `src/` signatures —
 * still fails, because the preamble only ever *adds* missing bindings; it
 * never touches the sample's own code. `evnex` / `evnex/auth` resolve via a
 * `paths` mapping straight to `src/index.ts` / `src/auth/index.ts` — see the
 * comment on `paths` below for why plain resolution can't be used instead.
 *
 * Exit code is non-zero if any block fails to compile, or if README.md
 * contains no fenced ts/typescript block at all (that would mean this
 * checker silently stopped checking anything).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const readmePath = join(repoRoot, "README.md");

// -- 1. Extract fenced ts/typescript blocks, with their starting line number
// (1-indexed, pointing at the ``` fence itself) for error reporting. --------

const FENCE_RE = /^```(ts|typescript)\s*$/;

function extractSamples(markdown) {
  const lines = markdown.split("\n");
  const samples = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE_RE.test(line.trim())) {
      const startLine = i + 1;
      const body = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== "```") {
        body.push(lines[i]);
        i += 1;
      }
      // i is now on the closing fence (or EOF, treated as unterminated below).
      samples.push({ startLine, source: body.join("\n") });
    }
    i += 1;
  }
  return samples;
}

// -- 2. The fixed vocabulary of package exports and ambient free variables. -

// name -> module specifier, for anything this package itself exports that a
// sample might reference. Add to this list if README.md starts using another
// exported symbol in a fragment; do NOT add ad hoc example-specific names
// here — those belong in AMBIENT_DECLARATIONS below instead.
const PACKAGE_EXPORTS = {
  Evnex: "evnex",
  EvnexAuth: "evnex/auth",
  TokenSet: "evnex/auth",
  isAuthChallenge: "evnex/auth",
};

// name -> the `declare` statement to inject when a sample uses the name
// without defining it. This is deliberately a closed, hand-reviewed list —
// widening it silently to "any undeclared identifier becomes `any`" would
// let a genuine typo in a sample pass unnoticed.
const AMBIENT_DECLARATIONS = {
  auth: 'declare const auth: import("evnex/auth").EvnexAuth;',
  evnex: 'declare const evnex: import("evnex").Evnex;',
  username: "declare const username: string;",
  password: "declare const password: string;",
  code: "declare const code: string;",
  currentPassword: "declare const currentPassword: string;",
  newPassword: "declare const newPassword: string;",
  emailedCode: "declare const emailedCode: string;",
  promptForCode:
    "declare function promptForCode(challengeName: string): Promise<string>;",
  // Shaped to match how the sample actually uses it (`TokenSet.fromJSON(await
  // myStore.read())` / `myStore.write(tokens.toJSON())`), not an arbitrary
  // guess — a store that round-trips a plain string would make the sample's
  // own calls fail to type-check regardless of what this declares.
  myStore:
    'declare const myStore: { read(): Promise<Partial<import("evnex/auth").TokenSetJSON>>; write(data: import("evnex/auth").TokenSetJSON): Promise<void> };',
};

/** True if `source` already declares/imports `name` itself (so we must not shadow it). */
function alreadyDeclares(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\b(const|let|var|function|class)\\s+${escaped}\\b`),
    // `import { Name }` / `import { Other as Name }` / `import Name` — any
    // form that binds the local identifier `Name`.
    new RegExp(`\\bimport\\b[^;]*\\b${escaped}\\b[^;]*\\bfrom\\b`),
  ];
  return patterns.some((re) => re.test(source));
}

function buildPreamble(source) {
  const lines = [];
  for (const [name, moduleSpecifier] of Object.entries(PACKAGE_EXPORTS)) {
    if (new RegExp(`\\b${name}\\b`).test(source) && !alreadyDeclares(source, name)) {
      lines.push(`import { ${name} } from "${moduleSpecifier}";`);
    }
  }
  for (const [name, declaration] of Object.entries(AMBIENT_DECLARATIONS)) {
    if (new RegExp(`\\b${name}\\b`).test(source) && !alreadyDeclares(source, name)) {
      lines.push(declaration);
    }
  }
  return lines;
}

// -- 3. Write each augmented sample + a tsconfig that can resolve "evnex". --

function main() {
  const markdown = readFileSync(readmePath, "utf8");
  const samples = extractSamples(markdown);

  if (samples.length === 0) {
    console.error(
      "check-readme-samples: found zero ```ts/```typescript blocks in README.md " +
        "— that almost certainly means this checker is broken, not that the " +
        "README has no code samples. Failing loudly rather than reporting a " +
        "false 'all clean'.",
    );
    process.exit(1);
  }

  const workDir = mkdtempSync(join(tmpdir(), "evnex-readme-samples-"));
  const preambleLineCounts = [];

  try {
    for (const [index, sample] of samples.entries()) {
      const preamble = buildPreamble(sample.source);
      preambleLineCounts.push(preamble.length);
      const content = [...preamble, sample.source].join("\n") + "\n";
      writeFileSync(join(workDir, `sample-${index}.ts`), content, "utf8");
    }

    // TypeScript picks CJS vs ESM per file by walking up from that file for
    // the nearest package.json's "type" field. workDir lives outside the
    // repo (a plain OS temp directory, so nothing here ever touches the
    // working tree), so without its own package.json that walk would either
    // find nothing (defaulting to CJS — top-level `await` then fails) or,
    // worse, find some unrelated package.json elsewhere under /tmp.
    writeFileSync(
      join(workDir, "package.json"),
      JSON.stringify({ type: "module" }, null, 2),
      "utf8",
    );

    const tsconfig = {
      extends: join(repoRoot, "tsconfig.json"),
      compilerOptions: {
        noEmit: true,
        composite: false,
        declaration: false,
        // "evnex" / "evnex/auth" resolve straight to source via this path
        // mapping. The obvious alternative — let plain node-modules
        // resolution find the real package.json "exports" map, the way an
        // actual installed consumer would — doesn't work here: there is no
        // published `evnex` package to link in workDir's node_modules, and
        // TypeScript's *self-referencing-package* resolution (a package
        // importing its own name via its own "exports" map with no
        // node_modules entry) hits TS2209 "the project root is ambiguous"
        // against this project's tsconfig.json, which sets no `rootDir`
        // (correctly, for the real build — see tsconfig.build.json for the
        // one that does). That's a TypeScript resolver limitation around
        // self-reference, not something fixable from this script alone, so
        // `paths` sidesteps the whole self-reference code path instead.
        paths: {
          evnex: [join(repoRoot, "src", "index.ts")],
          "evnex/auth": [join(repoRoot, "src", "auth", "index.ts")],
        },
        // Default typeRoots discovery walks up from workDir's own location
        // (outside the repo) and would never find this project's
        // node_modules/@types (for @types/node's ambient `process`,
        // `console`, ... globals the samples rely on); point at it directly.
        typeRoots: [join(repoRoot, "node_modules", "@types")],
      },
      include: ["*.ts"],
    };
    const tsconfigPath = join(workDir, "tsconfig.json");
    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf8");

    const tscBin = join(repoRoot, "node_modules", ".bin", "tsc");
    const result = spawnSync(
      tscBin,
      ["-p", tsconfigPath, "--noEmit", "--pretty", "false"],
      {
        cwd: workDir,
        encoding: "utf8",
      },
    );

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (result.status === 0) {
      console.log(
        `check-readme-samples: ${samples.length} sample(s) extracted from README.md, all type-check cleanly.`,
      );
      return;
    }

    // Re-map "sample-N.ts:L:C" errors back to the README's own line numbers,
    // accounting for the preamble lines this script injected.
    console.error(
      `check-readme-samples: ${samples.length} sample(s) checked, errors found:\n`,
    );
    const errorLineRe = /^sample-(\d+)\.ts\((\d+),(\d+)\):/;
    for (const line of output.split("\n")) {
      const match = errorLineRe.exec(line);
      if (match) {
        const idx = Number(match[1]);
        const tsLine = Number(match[2]);
        const col = match[3];
        const sample = samples[idx];
        const injected = preambleLineCounts[idx] ?? 0;
        const readmeLine = sample.startLine + (tsLine - injected);
        console.error(
          `README.md:${readmeLine} (sample #${idx + 1}, fenced block starting README.md:${sample.startLine}, col ${col}): ` +
            line.slice(match[0].length).trim(),
        );
      } else if (line.trim() !== "") {
        console.error(line);
      }
    }
    process.exitCode = 1;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();
