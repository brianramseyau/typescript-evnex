# Releasing

This is the maintainer's guide to cutting a release. It assumes no memory
of how the pipeline was built — everything needed is below.

## One-time setup: the `NPM_TOKEN` secret

`.github/workflows/release.yml` publishes via `npm publish --provenance`,
authenticated with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. That secret
does not exist yet — the workflow will fail at the publish step until it's
added. This is a one-time setup, done outside this repo (an npm access
token is tied to your npm account, not something a repo checkout can
generate for you):

1. On [npmjs.com](https://www.npmjs.com): **Access Tokens → Generate New
   Token → "Automation"** (bypasses 2FA-on-publish, which CI needs since
   nothing there can answer a 2FA prompt). A "Granular Access Token" scoped
   to publish-only access on the `evnex` package works too, if you want
   tighter scope than a classic Automation token.
2. Add it as a repo secret:
   ```shell
   gh secret set NPM_TOKEN -R brianramseyau/typescript-evnex
   ```
   (pastes the token value when prompted), or via GitHub's web UI: repo →
   Settings → Secrets and variables → Actions → New repository secret.
3. Verify it's there: `gh secret list -R brianramseyau/typescript-evnex`
   should show `NPM_TOKEN` (the value itself is never shown back).

Nothing else in the pipeline needs configuring — `release.yml` already
reads this secret correctly, and every step before the publish itself
(lint, typecheck, test, build, the README-sample check, the dependency
gate, `npm audit --omit=dev`, and a real tarball-install verification) has
been run and passes as of this writing.

## Cutting a release

1. Bump `version` in `package.json` (and add a `CHANGELOG.md` entry) on
   `main`, in its own commit or PR.
2. Publish a [GitHub Release](https://github.com/brianramseyau/typescript-evnex/releases/new)
   against `main`, tagged `v<version>` to match `package.json`. Publishing
   the release (not just creating a tag) is what triggers the workflow —
   it listens for `release: types: [published]`.
3. Watch the `Release` workflow run: `gh run watch -R brianramseyau/typescript-evnex`,
   or the Actions tab. It re-runs the full verification gate from scratch
   (nothing from your local machine is trusted) before publishing.
4. If it fails before the publish step, nothing was published — fix the
   issue, delete the (unpublished) GitHub Release and tag, and start again
   from step 2. If it fails *at* or after the publish step, check
   npmjs.com directly for what actually landed before retrying.

## What the pipeline verifies before it will publish

In order, all of which must pass:

- `npm run lint`, `npm run typecheck`, `npm test` (100% coverage,
  per-file), `npm run build`
- Every README code sample type-checks (`scripts/check-readme-samples.mjs`)
- The dependency gate: `dependencies`/`optionalDependencies` match PLAN.md
  §0's shape, and the total transitive package count hasn't grown
  unexpectedly (`scripts/check-dependency-gate.mjs`)
- `npm audit --omit=dev` — the *published* runtime graph is clean (dev-only
  tooling vulnerabilities don't block a release; they don't ship)
- A real `npm pack` → install-the-tarball-into-a-throwaway-directory check,
  twice — once with the optional `qrcode` peer present, once genuinely
  absent — proving `npx evnex --version` runs via npm's own bin-symlink
  mechanism and the CLI's QR path degrades gracefully without it
  (`scripts/verify-release-tarball.mjs`)

Only then: `npm publish --provenance`.

## Where each piece lives

| Concern | File |
|---|---|
| The workflow itself | `.github/workflows/release.yml` |
| Dependency shape/count gate | `scripts/check-dependency-gate.mjs`, `scripts/dependency-baseline.json` |
| Tarball install verification | `scripts/verify-release-tarball.mjs` |
| README sample type-checking | `scripts/check-readme-samples.mjs` |
| CI (every push/PR to `main`, not release-gated) | `.github/workflows/ci.yml` |
