# Downstream validation (D5) — operator's guide

This is the guide for the person actually running D5's live verification —
a human, at a terminal, with a real EVNEX account and a real charger. It
assumes no memory of how this tooling was built: everything you need to
know is below.

D5 has two halves. **This document covers both**, but only one of them —
§2, the schema sweep — has a script to run. §1 (the seven-point downstream
validation checklist) is verified by hand against `ev-charging-log`, an
independent consumer of this package; there is no tool for it because its
whole point is an independent, human-driven A/B comparison.

---

## 1. The seven-point downstream validation checklist

Reproduced verbatim from `foundational/PLAN.md`'s D5 section, so this
document is self-contained:

> **Method.** `npm pack` this package, install the tarball into a scratch
> branch of [`ev-charging-log`](https://github.com/brianramseyau/ev-charging-log),
> and replace its hand-rolled `src/lib/server/evnex-client.ts` and
> `evnex-auth.ts` with calls into it. That project already has an
> independent implementation of the same endpoints and a live account, so
> the swap is a genuine A/B: for one poll cycle, run both paths and diff the
> results.
>
> **Checklist.**
>
> 1. `EvnexAuth` signs in via our SRP against the live pool. _(Kills §8 risk 1.)_
> 2. Refresh from a stored refresh token alone succeeds.
> 3. `getOrgChargePoints`, `getChargePointDetailV3` and `getChargePointSessions`
>    parse **live** responses with no `ZodError`.
> 4. Sessions match `fetchSessions`'s output field-for-field after
>    normalisation — ids, `startDate`, `sessionStatus`, and energy.
> 5. A live response containing a load schedule parses — the §10.1
>    regression, against real data rather than a fixture.
> 6. `evnex status`, `charge-points list` and `sessions list` run against
>    the real account and render plausible output.
> 7. **The full GET sweep below runs clean**, and its report is committed.
>
> Any schema too tight for a live response is a **defect in the owning
> agent's module**, not something to patch downstream. Report it; do not
> fix it locally.
>
> **Acceptance.** All seven pass, with the live payloads (credentials and
> tokens redacted) added to `test/support/` as fixtures so the next
> regression is caught offline. Do not merge the scratch branch of
> `ev-charging-log` — it is a test harness, and the real migration is that
> project's own call, on its own schedule.

Item 7 is exactly the schema sweep §2 below covers. Items 1-6 need the
`ev-charging-log` scratch-branch A/B swap described above; there is
deliberately no automated script for them here — the whole value of that
check is an independently-written consumer agreeing with this package on a
live account, and scripting "does the other implementation get the same
answer" would just be a second implementation of `ev-charging-log`, not a
check of it.

**A schema mismatch anywhere in this process is a defect in the schema
module that owns it, not something to patch downstream or in
`ev-charging-log`.** File it; the fix belongs in `src/schema/**`.

---

## 2. The schema sweep (item 7)

### What it does

`tools/schema-sweep/` walks all 14 read-only endpoints this package
exposes — every `GET`, plus the four read-only `POST .../commands/get-*`
calls — against your real account, one shot each, sequentially, honouring
the existing retry policy. For each endpoint it:

1. Captures the **raw** response body before any schema validation runs.
2. Validates it against this package's own Zod schema, without letting a
   validation failure destroy the captured evidence.
3. Redacts the captured body (see §4 below) and writes it to disk.
4. Computes and records three structural findings against the schema —
   fields the wire sent that the schema doesn't declare, fields the schema
   requires that the wire omitted, and any other type/shape mismatch — plus
   hand-researched notes comparing this package's schema against
   `python-evnex`'s model for the same endpoint.

It never calls a state-changing endpoint. See §6 for how that is enforced,
not just intended.

### What it needs from you

One of:

- **A token cache** (recommended). Run `npx evnex auth login` once (this
  package's own CLI — it handles MFA, TOTP, everything). That writes a
  token cache to `$EVNEX_TOKEN_CACHE`, or `~/.cache/evnex/tokens.json` by
  default. The sweep resumes from it automatically — a refresh token alone
  is enough, no password needed for the sweep run itself.
- **`EVNEX_CLIENT_USERNAME` / `EVNEX_CLIENT_PASSWORD`**, for an account with
  no MFA enabled. If the account has MFA, the sweep will tell you to run
  `evnex auth login` first and stop — it does not answer MFA challenges
  itself.

The sweep never reads a raw password or token cache file into anything it
writes to disk — see §4.

### How to run it

```shell
# From the repo root, with credentials resolved per the section above:
npm run sweep

# Or directly:
npx tsx tools/schema-sweep/cli.ts
```

Useful flags:

| Flag                                 | Effect                                                                                                                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--out <dir>`                        | Where per-endpoint capture files go. Default `./schema-sweep-output`.                                                                                                                                                                                     |
| `--report <path>`                    | Where the markdown report is written. Default `docs/schema-sweep.md` in live mode (refuses this default in `--dry-run` mode — see §5).                                                                                                                    |
| `--org <id>` / `--charge-point <id>` | Skip discovery and target a specific org/charge point. Otherwise the sweep discovers the account's first organisation and first charge point automatically, exactly like `getUserDetail()` → `getOrgChargePoints()` already do elsewhere in this package. |
| `--force`                            | Re-fetch every endpoint even if a capture from an earlier run already exists in `--out`.                                                                                                                                                                  |

### How long it takes, and what happens if it's interrupted

Fourteen sequential requests, each honouring the existing retry policy (up
to 5 attempts with jittered backoff on a transient failure) — expect it to
finish in well under a minute against a healthy account, longer if a
charger is offline (the `get-status`/`get-override`/`get-solar`/
`get-energy-meter-reading` commands against an offline charger time out
rather than erroring immediately, exactly like the rest of this package's
client does).

**Every endpoint's capture is written to disk the moment it completes** —
not batched and flushed at the end. If your access token expires mid-run
(they last about an hour), a network blip happens, or you Ctrl-C, whatever
was already captured stays on disk. Just run the same command again: it
skips every endpoint it already has a capture file for and picks up where
it left off. Pass `--force` only if you deliberately want to re-fetch
something (e.g. you fixed the account's MFA and want a fresh capture of an
endpoint that previously hit an auth error).

A persistent 401 (session no longer usable even after the sweep's own
refresh-and-resend) stops the whole run — sign in again
(`npx evnex auth login`) and re-run. Every other failure — an HTTP error, a
timeout, an invalid-JSON body, an unexpected exception — is recorded as a
finding for that one endpoint, and the sweep continues to the next one.

### What it writes

- `<out>/<endpoint-id>.json` — one file per endpoint, the full capture
  record (outcome, HTTP status, the three structural findings, and the
  **redacted** response body).
- `docs/schema-sweep.md` (by default, in live mode) — the human-readable
  report PLAN.md's D5 checklist item 7 asks to be committed.

### Before you commit anything

**Review every redacted payload in `docs/schema-sweep.md` (and the raw
capture files, if you're also committing those under `test/support/`) by
eye before committing.** `tools/schema-sweep/redact.ts` is a safety net,
not a guarantee. It redacts by field name — tokens, the SRP secret block,
email, charge point serial, `ocppChargePointId`, `iccid`, and
latitude/longitude — and it's been tested against nested objects, arrays,
and keys at unexpected depths (`test/tools/redact.test.ts`). It has not
been run against your account's actual field names, which the sweep's
authors have never seen. If the API ever nests a serial number, an email,
or a coordinate under a field name not on that list, it will not be
redacted automatically. Read the report before you `git add` it. Do not
assume clean because the tool ran without errors — "ran without errors" and
"redacted everything sensitive" are different claims.

`schema-sweep-output/` is in `.gitignore` on purpose, so a routine
`git add -A` after a run cannot commit an unreviewed capture. Getting a
payload into the repository is therefore a deliberate act: copy the
specific file you have read into `test/support/` yourself. Do not remove
that ignore rule to make the copying easier.

If you find something the redaction layer missed, do not commit it. Either
hand-redact it and note that you did, or fix `tools/schema-sweep/redact.ts`
directly (adding the missing key to `REDACTED_KEYS`) and re-run with
`--force` for the affected endpoint before committing.

### Turning a finding into a fixture / defect

For PLAN.md's D5 acceptance criterion ("live payloads ... added to
`test/support/` as fixtures"): once you've reviewed a redacted capture and
you're satisfied it's clean, you can add a trimmed/adapted version of it to
`test/support/fixtures.ts` as a new named export, following the existing
convention there (see the file's own header comment). Do not paste redacted
markers (`<redacted:...>`) into a fixture meant to exercise real field
shapes — either use a synthetic-but-realistic replacement value, or omit
the field from the fixture if its exact value doesn't matter to the test
it backs.

Every **missing-required-field** finding in the report is a candidate
defect against the schema module that declares it (`src/schema/**`) — the
§10.1 class of bug this sweep exists to catch. File it against that module;
the fix is almost always loosening the field to `.nullish()`, never
tightening the live API. Every **extra-field** finding is expected and
harmless (this package deliberately never uses `.strict()`) — no action
needed unless you want to extend the schema to model the new field. Every
**divergence-from-Python** note is worth a second look: if Python is also
wrong, it's an upstream bug worth reporting to `hardbyte/python-evnex`; if
only this package is wrong, it's a porting error.

---

## 3. Two priority targets

The report will flag these prominently, but they're worth knowing before
you start:

1. **`chargePointDetailV2`** (`GET /v2/apps/charge-points/{id}`) — the v2
   charge point detail endpoint has **no captured fixture anywhere**, in
   this project or in `python-evnex`. `configuration`, `electricityCost`,
   `loadSchedule`, and `connectors` are all required fields with zero live
   corroboration. This is the single most likely place to find a real
   §10.1-class defect. If this endpoint 404s or has been withdrawn
   entirely (it's deprecated), that's itself worth recording — it isn't a
   tooling failure.
2. **`EvnexV3APIResponse.included`** — Python's model makes this key
   required-but-nullable; this package's Zod schema makes it optional and
   nullable (strictly more lenient). The `chargePointDetailV3` capture's
   raw body is the evidence to check: is `included` ever actually _absent_
   from a real response, or does Python's stricter reading turn out to be
   right in practice?

---

## 4. What redaction covers (and what it would miss)

Two paths, both in `tools/schema-sweep/redact.ts`:

- **A parsed JSON body** (`redactJson`) is walked recursively — objects,
  arrays, arbitrary nesting — and the _value_ of any key matching a curated
  list of sensitive field names is replaced with a marker string like
  `"<redacted:serial>"`. The key itself, and the surrounding structure, is
  always preserved — a removed key would be indistinguishable from a key
  the wire never sent, which is exactly the distinction this sweep exists
  to measure. `null` values are left as `null` rather than replaced: there
  is nothing to hide in the absence of a value, and replacing it would
  destroy the presence/nullity signal the sweep is trying to capture (see
  §3's `included` question above).
- **A response body that fails `JSON.parse`** (`redactRawText`) — an HTML
  error page, a plain-text 5xx body — is pattern-matched instead: JWT-shaped
  tokens, email addresses, and `Bearer ...` headers echoed into the body
  text.

The curated key list (see the file itself for the exact set) covers: access/
id/refresh tokens and bearer headers; the Cognito SRP handshake's secret
material (defensive — the sweep never talks to Cognito itself, but a
captured error body could conceivably echo one back); email; charge point
serial; `ocppChargePointId`; `iccid`; and latitude/longitude coordinates.
Matching is by exact, normalised key name (case- and separator-insensitive),
not a substring match — `tokenRequired` (a real, non-sensitive field) is
correctly left alone.

**What it would miss:** anything not on that key list. If a future API
response nests a phone number, a street address, a device MAC address, or
any other identifying value under a field name this list doesn't recognise,
it passes through unredacted. This is exactly why §2's "review by eye
before committing" step is not optional.

---

## 5. Dry-run mode (proving the tool without an account)

```shell
npm run sweep:dry-run
# or: npx tsx tools/schema-sweep/cli.ts --dry-run
```

Runs the identical pipeline — graph walk, capture, redaction, diffing,
report generation — against recorded fixtures instead of the network. No
credentials, no network access, needed or used. Its report defaults to
`<out>/dry-run-report.md`, and the CLI **refuses outright** to write a
dry-run report to `docs/schema-sweep.md` — that path is reserved for real
findings, and a dry-run report there could be mistaken for one.

Roughly half the dry-run's fixtures are real payloads inherited from
`test/support/fixtures.ts` (itself ported from `python-evnex`'s own test
suite); the rest — including `chargePointDetailV2`, the top-priority target
from §3 — are hand-authored synthetic payloads, because no real fixture
exists anywhere to inherit. Each endpoint's section in the dry-run report
says which. **A synthetic fixture proves the sweep tool works. It proves
nothing about whether the real API's schema is right** — that is exactly
what running this against your account (§2) is for.

---

## 6. How "read-only" is enforced, not just intended

The sweep's own client (`tools/schema-sweep/readClient.ts`) never imports
`Evnex` (`src/api.ts`) or the package barrel (`src/index.ts`, which
re-exports `Evnex`) — both bundle every state-changing method (override,
remote-stop, availability, unlock, load profile, schedule) together with
the read ones in one class. Importing either at all would drag the
mutators into the sweep's import graph even if nothing in the sweep called
them. Instead, the sweep hand-builds its own read-only requests from the
same path templates `src/api.ts` uses, importing only `Transport` /
`withAuthFlow` / `withRetry` (pure request plumbing) and the Zod schemas.

`test/tools/readonly-import.test.ts` enforces this structurally: it walks
the sweep's actual import graph and fails if `src/api.ts` or `src/index.ts`
is ever reached, and separately greps every file under `tools/schema-sweep/`
for the eight mutating method names by their literal identifiers
(`setChargePointOverride`, `stopChargePoint`, `enableCharger`,
`disableCharger`, `setChargerAvailability`, `unlockCharger`,
`setChargerLoadProfile`, `setChargePointSchedule`). A future edit that adds
a mutating call to the sweep — even indirectly — fails this test.

---

## 7. What could not be verified without a live account

This document, and the sweep tool it describes, were built and tested
entirely offline — there are no EVNEX credentials in that environment, and
there never will be. Every claim about the sweep's _mechanics_ (redaction,
diffing, resumability, read-only enforcement, report generation) is backed
by an automated test against real code and fixture data. Every claim about
what the _live API actually returns_ — whether `chargePointDetailV2` still
works, whether `included` is ever really absent, whether any endpoint has a
genuine §10.1-class defect — is **not yet known**, and needs an actual run
of `npm run sweep` (or `evnex` more broadly, for the six checklist items in
§1) against a real account to find out. That run, and its resulting
`docs/schema-sweep.md`, is what this document exists to walk you through.
