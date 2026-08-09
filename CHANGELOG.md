# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This package does not mirror `python-evnex`'s own version numbers — starting
at `0.1.0` avoids implying a shared release history with the upstream Python
project it is ported from.

## [Unreleased]

## [0.1.0] - 2026-08-09

Initial release. A complete TypeScript/ESM port of
[`hardbyte/python-evnex`](https://github.com/hardbyte/python-evnex) 0.7.0's
public surface, audited for parity against the Python source
(see `PARITY.md` and `test/PARITY.md`) with 855 tests and 100% line and
branch coverage per file.

**Not yet validated against a live Evnex account.** This release has been
checked against upstream's own test fixtures and a line-by-line parity
audit, but not yet exercised end-to-end against real hardware or a live
Cognito pool — that validation is tracked separately and has not run yet.
Treat the SRP handshake, live response parsing, and any endpoint without a
captured fixture as unconfirmed until it has.

### Added

- `Evnex` — the API client: charge points (v2 and v3), sessions, locations,
  organisation insights, cost/electricity data, load schedules, and remote
  commands (override, availability, schedule).
- `EvnexAuth` — Cognito authentication via a hand-written SRP (`USER_SRP_AUTH`)
  implementation and the AWS SDK for the surrounding Cognito operations: sign
  in, refresh, sign out, password change/reset, and TOTP MFA enrollment
  (enable/disable/enroll/confirm), matching `pycognito`'s behaviour.
- Zod v4 schemas for every response model, parsed rather than merely typed,
  mirroring the original's pydantic models field-for-field.
- The retry policy from `evnex/http.py`, ported to match `tenacity`'s
  semantics: which exceptions retry, how many attempts, and the backoff
  shape.
- `evnex` CLI (`bin`): `auth`, `status`, `charge-points`, `sessions`,
  `locations`, `insights`, `schedule`, `charge` — an in-house
  `node:util.parseArgs`-based router, no CLI framework dependency.
- ESM-only package (`"type": "module"`), Node 20+, built with
  `tsc -p tsconfig.build.json` — no bundler.
- `exports` map: `.` (the client), `./auth` (`EvnexAuth` and friends), and
  `./package.json`.
- Optional `qrcode` peer for terminal QR rendering during MFA enrollment;
  without it, enrollment falls back to printing the `otpauth://` URI, which
  upstream treats as a supported opt-out rather than a required dependency.

### Dependencies

- Runtime: `zod` (^4), `@aws-sdk/client-cognito-identity-provider` (^3).
- Optional: `qrcode` (^1.5), CLI-only.
- See `foundational/PLAN.md` §0 for the measured transitive-package rationale
  behind this shape, including the still-open question of whether the AWS
  SDK's Cognito client is worth its share of the dependency graph given the
  SRP handshake is already hand-written — deliberately left unresolved in
  this release; see the release notes/PR discussion for the current
  measurements.

[Unreleased]: https://github.com/brianramseyau/typescript-evnex/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/brianramseyau/typescript-evnex/releases/tag/v0.1.0
