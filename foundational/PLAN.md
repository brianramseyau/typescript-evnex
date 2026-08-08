# typescript-evnex — Port Plan

A full-parity TypeScript port of [`hardbyte/python-evnex`](https://github.com/hardbyte/python-evnex)
(v0.7.0, Apache-2.0, by Brian Thorne), structured so that the work can be
executed by ~23 delegated agents running in as many parallel lanes as the
dependency graph allows.

- **Source of truth:** `python-evnex` @ v0.7.0 — 5,458 lines across `evnex/`
  (library, 2,077 lines), `evnex/cli/` (1,106 lines) and `tests/` (1,749 lines).
- **Target:** Node 20+, ESM-only, TypeScript 5.6+, published to npm.
- **Auth:** `@aws-sdk/client-cognito-identity-provider` v3 + a hand-written
  SRP (Secure Remote Password) implementation replacing `pycognito`.
- **Scope:** full parity — every API method (including the deprecated v2 ones),
  the complete auth/MFA/password surface, every schema, and the entire `evnex`
  CLI including `--json`, the token cache, `--otp-command` and QR enrollment.

---

## 0. Decisions already made

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node 20+ | Native `fetch`, `AbortSignal.timeout`, stable `node:crypto` webcrypto |
| Module format | ESM-only (`"type": "module"`) | No dual-build matrix; matches modern npm publishing |
| Validation | **Zod v4** | Closest analogue to pydantic: parse-don't-validate, inferred static types, coercion, `.transform()` for field aliases |
| HTTP | Native `fetch` + a thin transport layer | Replaces `httpx`; no runtime HTTP dependency |
| Cognito | `@aws-sdk/client-cognito-identity-provider` + own SRP | `pycognito` has no maintained JS equivalent that covers every operation used |
| Retry | Hand-written, mirroring `tenacity` semantics exactly | The retry *policy* is load-bearing behaviour and must be ported precisely, not approximated by a generic library |
| CLI | `commander` | Mature TS types; supports options in trailing position, which the Python test suite asserts |
| Tests | `vitest` + `msw` (HTTP) + `aws-sdk-client-mock` (Cognito) | Direct analogues of `pytest` + `respx` + the `FakeCognito` fixture |
| Lint/format | `eslint` (typescript-eslint, flat config) + `prettier` | Analogue of `ruff check` / `ruff format` |

### Open decisions (resolve before Wave 4 / D4)

1. **npm package name.** Preferred `evnex`; fall back to `evnex-client` or a
   scoped `@<org>/evnex` if taken. Placeholder used throughout: `evnex`.
2. **Initial version.** Recommend `0.1.0` with `PARITY.md` recording
   "parity target: python-evnex 0.7.0", rather than mirroring `0.7.0` and
   implying a shared release history.

---

## 1. Target repository layout

Every path below has exactly one owning agent. **No two agents write the same
file.** This is the property that makes the parallelism safe.

```
.
├── foundational/
│   └── PLAN.md                      # this document
├── README.md                        # includes acknowledgements to the original author
├── LICENSE                          # Apache-2.0 (inherited)
├── NOTICE                           # attribution to python-evnex / Brian Thorne
├── PARITY.md                        # symbol-by-symbol port audit
├── CHANGELOG.md
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── eslint.config.js
├── .prettierrc
├── .github/workflows/ci.yml
├── .github/workflows/release.yml
├── src/
│   ├── index.ts                     # public surface
│   ├── config.ts                    # EvnexConfig  ← evnex/config.py
│   ├── errors.ts                    # error hierarchy  ← evnex/errors.py
│   ├── status.ts                    # DeviceStatus, ConnectorOcppStatus  ← evnex/status.py
│   ├── models.ts                    # parseModel, EvnexModelInfo  ← evnex/models.py
│   ├── api.ts                       # class Evnex  ← evnex/api.py
│   ├── http/
│   │   ├── transport.ts             # request pipeline, base URL, headers
│   │   ├── retry.ts                 # tenacity-equivalent retry policy
│   │   ├── authFlow.ts              # 401 → refresh → resend  ← EvnexHttpxAuth
│   │   └── errors.ts                # EvnexHttpError, EvnexTimeoutError
│   ├── auth/
│   │   ├── index.ts                 # class EvnexAuth (facade)
│   │   ├── session.ts               # CognitoSession: tokens, lock, refresh
│   │   ├── account.ts               # MFA + password operations
│   │   ├── tokens.ts                # TokenSet
│   │   ├── challenge.ts             # AuthChallenge
│   │   ├── mfa.ts                   # TotpEnrollment, MfaStatus
│   │   ├── cognito.ts               # AWS SDK v3 adapter
│   │   ├── srp.ts                   # SRP protocol maths
│   │   ├── jwt.ts                   # unverified exp-claim decode
│   │   └── mutex.ts                 # asyncio.Lock equivalent
│   ├── schema/
│   │   ├── cost.ts
│   │   ├── user.ts
│   │   ├── org.ts
│   │   ├── commands.ts
│   │   ├── chargePoints.ts
│   │   └── v3/
│   │       ├── generic.ts
│   │       ├── relationships.ts
│   │       ├── chargePoints.ts
│   │       ├── locations.ts
│   │       ├── org.ts
│   │       ├── commands.ts
│   │       └── cost.ts
│   └── cli/
│       ├── index.ts                 # bin entrypoint, top-level error mapping
│       ├── parser.ts                # commander wiring, shared flag groups
│       ├── tokenCache.ts            # 0600 token cache
│       ├── prompt.ts                # input()/getpass() equivalents
│       ├── otp.ts                   # --otp / --otp-command resolution
│       ├── qr.ts                    # terminal + browser QR rendering
│       ├── format.ts                # table, kW/kWh, datetime, period
│       ├── resolve.ts               # charge point selection
│       └── commands/
│           ├── auth.ts
│           ├── resources.ts
│           └── charge.ts
├── test/
│   ├── support/                     # fixtures, fakes, MSW handlers
│   └── **/*.test.ts
└── examples/
    ├── getToken.ts
    ├── getChargePointDetail.ts
    ├── getOrgInsights.ts
    ├── setChargePointAvailability.ts
    └── configureChargerLoadManagement.ts
```

---

## 2. Porting rules (binding on every agent)

These are the decisions that keep 20+ independent agents producing one coherent
codebase. Deviating from them is a review failure, not a style preference.

### 2.1 Naming

- **Keep the `Evnex*` type names verbatim** from Python (`EvnexChargePoint`,
  `EvnexGetOrgInsights`, …). They are the port's recognisability contract.
- **Method names become camelCase**: `get_org_charge_points` → `getOrgChargePoints`.
- **Wire field names are never renamed.** `ocppChargePointId`, `networkStatus`,
  `chargingProfilePeriods` are already camelCase in the API and stay as-is.
- One exception, inherited from Python: `EvnexChargePointConnectorMeter.register`
  (wire) is exposed as `rawRegister`. Implement with a Zod `.transform()`; do
  not silently drop the rename.

### 2.2 pydantic → Zod

| pydantic | Zod v4 |
|---|---|
| `class X(BaseModel)` | `export const X = z.object({...}); export type X = z.infer<typeof X>;` |
| `str \| None = None` | `.nullish()` — the API uses both `null` and omission |
| `datetime` | `z.coerce.date()` |
| `UUID` | `z.uuid()` (kept as `string`, not a branded type) |
| `Literal["User", "Installer"] = "User"` | `z.enum(["User","Installer"]).default("User")` |
| `StrEnum` | `z.enum([...])` + exported `const` object for value access |
| `Field(..., alias="register")` | `z.object({ register: z.number() }).transform(v => ({ rawRegister: v.register }))` |
| `Field(default_factory=list)` | `.default([])` |
| `Any` | `z.unknown()` — **never `any`** |
| `Generic[T]` model | factory function `evnexV3ApiResponse(<T schema>)` |
| `.model_validate(x)` | `Schema.parse(x)` |
| `.model_dump(mode="json")` | a shared `toJson()` helper (see 2.6) |
| `ValidationError` | `z.ZodError`, wrapped at the boundary in `EvnexValidationError` |

Objects are **not** `.strict()`: pydantic ignores unknown fields by default, and
the EVNEX API adds fields without warning. Preserving that tolerance is a
correctness requirement — a strict schema turns a benign API addition into a
hard outage for every consumer.

### 2.3 async primitives

| Python | TypeScript |
|---|---|
| `asyncio.Lock` | `Mutex` in `src/auth/mutex.ts` — a promise-chain lock with `runExclusive(fn)` |
| `asyncio.to_thread(...)` | **Delete.** There is no blocking-I/O-off-the-event-loop problem in Node; the AWS SDK is natively async. Every `to_thread` wrapper collapses to a direct `await`. |
| `blockbuster` fixture | Not ported — it exists only to police `to_thread` usage |
| `asyncio.create_subprocess_shell` | `node:child_process` `execFile`/`spawn` |

The single-flight refresh logic in `force_refresh` **is** ported, exactly: the
`_ALWAYS_REFRESH` sentinel, the `staleAccessToken` comparison, and the ordering
guarantee in `_store_tokens` (persist callback completes *before* the new tokens
become visible). These are the subtlest correctness properties in the codebase.

### 2.4 Errors

Port the hierarchy 1:1. `EvnexAuthError extends Error` (Python's `ValueError`
base has no meaningful JS analogue). Every class sets `this.name` explicitly so
it survives minification, and uses `cause` for the underlying error.

```
EvnexError
├── EvnexAuthError
│   ├── InvalidCredentialsError
│   ├── ReauthenticationRequiredError
│   ├── ChallengeExpiredError
│   ├── PasswordChangeRequiredError
│   └── InvalidChallengeResponseError
├── EvnexConfigurationError
├── EvnexValidationError        (wraps ZodError)
├── EvnexHttpError              (status, body)
└── EvnexTimeoutError           (httpx.ReadTimeout analogue)
```

Do **not** port the deprecated `NotAuthorizedException` module-level `__getattr__`
alias; it is scheduled for removal in Python 0.8.0 and has no idiomatic TS form.
Record the omission in `PARITY.md`.

### 2.5 Retry policy — port exactly

`tenacity`'s configuration in `evnex/api.py` is:

```python
retry(
    wait=wait_random_exponential(multiplier=1, max=60),
    stop=stop_after_attempt(5),
    retry=retry_if_not_exception_type(NON_RETRYABLE + extra),
    reraise=True,
)
```

Semantics to reproduce in `src/http/retry.ts`:

- **5 total attempts** (1 initial + 4 retries), not 5 retries.
- Delay before attempt *n* (1-indexed retries) is
  `Math.random() * Math.min(60_000, 1000 * 2 ** n)` — a *uniform* draw across
  the whole window, not full backoff with jitter added on top. Getting this
  wrong is the classic tenacity mis-port.
- `reraise: true` — surface the underlying error, never a wrapper.
- Never-retryable, always: `EvnexValidationError`, `EvnexAuthError`,
  `EvnexConfigurationError`. Plus per-call additions.

The per-method non-retryable additions must be transcribed verbatim — they
encode hard-won operational knowledge:

| Method | Extra non-retryable |
|---|---|
| `getOrgChargePoints`, `getOrgLocations` | `EvnexHttpError` |
| `getChargePointDetailV3` | `TypeError` |
| `getChargePointSolarConfig`, `getChargePointOverride`, `getChargePointStatus`, `getChargePointEnergyMeterReading` | `EvnexTimeoutError` |
| `setChargePointOverride`, `stopChargePoint` | `EvnexHttpError`, `EvnexTimeoutError` |

`set_charger_availability`, `unlock_charger`, `set_charger_load_profile` and
`set_charge_point_schedule` carry **no** retry decorator in Python. Do not add one.

### 2.6 JSON output

`model_dump(mode="json")` produces ISO strings for datetimes and plain values
elsewhere. Provide one shared helper in `src/schema/json.ts` (owned by the v2
schema agent) that recursively converts `Date` → `toISOString()`, drops
`undefined`, and preserves `null`. Every CLI `--json` path uses it, so output is
byte-comparable with the Python CLI's.

### 2.7 Timeouts

`httpx`'s `timeout=` parameter maps to `AbortSignal.timeout(ms)`. An abort from
that signal must be translated into `EvnexTimeoutError`, because several call
sites depend on distinguishing "the charge point is offline / no active session"
(a 504 surfacing as a read timeout) from a genuine HTTP error. Default timeout:
30s, matching `httpx`'s default. Explicit per-call timeouts from Python
(`timeout=15`, `timeout=10`) are carried over verbatim.

---

## 3. Cognito: what `pycognito` was doing, and what replaces it

This is the highest-risk area of the port and the reason for a dedicated,
early-wave agent pair (A5 + A6).

### 3.1 Operation mapping

| pycognito call | AWS SDK v3 command | Used by |
|---|---|---|
| `Cognito.authenticate(password)` | `InitiateAuthCommand(USER_SRP_AUTH)` → `RespondToAuthChallengeCommand(PASSWORD_VERIFIER)` | `startAuthentication` |
| `respond_to_software_token_mfa_challenge` | `RespondToAuthChallengeCommand(SOFTWARE_TOKEN_MFA)` | `respondToChallenge` |
| `respond_to_sms_mfa_challenge` | `RespondToAuthChallengeCommand(SMS_MFA)` | `respondToChallenge` |
| `renew_access_token()` | `InitiateAuthCommand(REFRESH_TOKEN_AUTH)` | `forceRefresh` |
| `client.get_user(AccessToken=…)` | `GetUserCommand` | `getMfaStatus` |
| `associate_software_token()` | `AssociateSoftwareTokenCommand` | `beginTotpEnrollment` |
| `verify_software_token(code, name)` | `VerifySoftwareTokenCommand` | `confirmTotpEnrollment` |
| `set_user_mfa_preference(...)` | `SetUserMFAPreferenceCommand` | `setMfaPreference` |
| `change_password(cur, new)` | `ChangePasswordCommand` | `changePassword` |
| `client.forgot_password(...)` | `ForgotPasswordCommand` | `startPasswordReset` |
| `confirm_forgot_password(code, new)` | `ConfirmForgotPasswordCommand` | `confirmPasswordReset` |

Region is derived from the pool id: `ap-southeast-2_zWnqo6ASv` → `ap-southeast-2`.
The client has **no** client secret, so no `SECRET_HASH` is ever computed —
`python-evnex` relies on this and so may the port.

### 3.2 Error-code mapping

`botocore.exceptions.ClientError` → `err.response["Error"]["Code"]` becomes, in
SDK v3, `error.name` (with `error.$metadata` for the rest). The mappings that
must be preserved:

| Cognito error name | Raised as | Site |
|---|---|---|
| any `ClientError` during sign-in | `InvalidCredentialsError` | `startAuthentication` |
| `NEW_PASSWORD_REQUIRED` challenge | `PasswordChangeRequiredError` | `startAuthentication` |
| `CodeMismatchException` | `InvalidChallengeResponseError` | challenge / TOTP confirm / password reset |
| `ExpiredCodeException` | `ChallengeExpiredError` | challenge, password reset |
| `NotAuthorizedException` (during challenge) | `ChallengeExpiredError` | Cognito reports a lapsed challenge session this way |
| `NotAuthorizedException` (during refresh) | `ReauthenticationRequiredError` | `forceRefresh` |
| `NotAuthorizedException` (during `changePassword`) | `InvalidCredentialsError` | `changePassword` |
| `NotAuthorizedException` (during a user-pool op) | triggers **one** refresh + retry | `runUserPoolOp` |
| `EnableSoftwareTokenMFAException` | `InvalidChallengeResponseError` | `confirmTotpEnrollment` |
| any other | `EvnexAuthError` | everywhere |

Note the same error name maps to three different port-side errors depending on
call site. This is deliberate in the original; preserve it.

### 3.3 SRP specification for agent A5

Implement `USER_SRP_AUTH` per RFC 5054 with AWS's Cognito-specific variations.
`node:crypto` provides SHA-256, HMAC and HKDF; use native `BigInt` for the
modular arithmetic.

- `N` = the 3072-bit safe prime from RFC 5054 Appendix A; `g` = 2.
- `k = SHA256(PAD(N) ‖ PAD(g))`.
- Client secret `a` = 128 random bytes; `A = g^a mod N` (redraw if `A mod N == 0`).
- Send `InitiateAuth(USER_SRP_AUTH)` with `AuthParameters: { USERNAME, SRP_A: A.toString(16) }`.
- Server returns `SRP_B`, `SALT`, `SECRET_BLOCK`, `USER_ID_FOR_SRP` in
  `ChallengeParameters`.
- `u = SHA256(PAD(A) ‖ PAD(B))`; abort if `u == 0`.
- `x = SHA256(PAD(salt) ‖ SHA256(poolName ‖ USER_ID_FOR_SRP ‖ ":" ‖ password))`
  where `poolName` is the pool id **after** the underscore (`zWnqo6ASv`).
- `S = (B − k·g^x)^(a + u·x) mod N`, normalising `B − k·g^x` into `[0, N)`.
- `key = HKDF-SHA256(ikm = PAD(S), salt = PAD(u), info = "Caldera Derived Key", L = 16)`.
- `signature = HMAC-SHA256(key, poolName ‖ USER_ID_FOR_SRP ‖ SECRET_BLOCK ‖ timestamp)`.
- `timestamp` format is **`"EEE MMM d HH:mm:ss 'UTC' yyyy"` in the C locale with
  a non-zero-padded day** — e.g. `Tue Jan 2 15:04:05 UTC 2024`. This is the
  single most common source of `NotAuthorizedException` in SRP re-implementations;
  it gets its own unit test.
- Respond with `RespondToAuthChallenge(PASSWORD_VERIFIER)` and
  `ChallengeResponses: { USERNAME: USER_ID_FOR_SRP, PASSWORD_CLAIM_SECRET_BLOCK,
  PASSWORD_CLAIM_SIGNATURE, TIMESTAMP }`.

`PAD(x)` left-pads the big-endian byte representation to an even length and
prefixes `0x00` when the high bit is set — matching Java `BigInteger.toByteArray()`,
which is what Cognito's server implementation expects.

### 3.4 Known gaps to flag, not silently absorb

- **Token verification.** `pycognito` verifies freshly issued tokens against the
  pool JWKS and raises `TokenVerificationException` (mapped to `EvnexAuthError` /
  `ReauthenticationRequiredError`). Port this with `jose` + a cached JWKS fetch,
  behind a `verifyTokens` config flag defaulting to `true`. If it proves
  impractical, it must be recorded in `PARITY.md` as a deliberate behavioural
  difference — not dropped quietly.
- **Device tracking.** If the pool ever enables device tracking, Cognito answers
  with a `DEVICE_SRP_AUTH` challenge that `pycognito` handles and this port will
  not. Detect it and raise a clear `EvnexAuthError` naming the limitation.
- **`ForceChangePasswordException`.** In SDK v3 this is not an exception but a
  `NEW_PASSWORD_REQUIRED` value in `ChallengeName`. Check for it explicitly.

---

## 4. Parallel execution model

### 4.1 Shape

23 agent roles across 5 waves, with up to **10 running concurrently**. The
dependency graph is deliberately shallow: Wave 0 produces compile-time contracts
so that Wave 1's ten agents never block on each other.

```
Wave 0  F0 Architect ────────────────────────────────────  (1 agent, blocking)
            │
Wave 1  ┌───┴──────────────────────────────────────────┐   (10 agents, parallel)
        A1 A2 A3 A4 A5 A6 A7 A8 A9 A10
            │
Wave 2  ┌───┴────────────────────┐                         (3 agents, parallel)
        B1 B2 B3
            │
Wave 3  ┌───┴────────────────────┐                         (4 agents, parallel)
        C1 C2 C3 C4
            │
Wave 4  ┌───┴────────────────────┐                         (4 agents, parallel)
        D1 D2 D3 D4

        INT Integrator ─────────────────────────────────  (standing, all waves)
```

### 4.2 Isolation and integration protocol

- Each agent runs in its **own git worktree** (`isolation: "worktree"` on the
  Agent tool), branched from the current integration head.
- Because file ownership is disjoint, wave-mates never touch the same file.
  Merges within a wave are therefore expected to be conflict-free; if one
  conflicts, that is a plan defect — escalate to INT rather than resolving by
  hand and moving on.
- **INT (Integrator)** merges each agent's branch into
  `claude/typescript-evnex-port-zpbiqu` as it completes, and runs the wave gate.
- A wave gate is: `tsc --noEmit` clean, `eslint` clean, `vitest run` green,
  and every acceptance criterion in the wave's agent briefs checked off. The
  next wave does not launch until the gate passes.

### 4.3 The contract-first trick

Wave 0's deliverable is not "a scaffold". It is **every exported signature in
the codebase, stubbed**:

```ts
// src/api.ts (Wave 0 output)
export class Evnex {
  constructor(options: EvnexOptions) { throw new Error("TODO(B3)"); }
  async getUserDetail(): Promise<EvnexUserDetail> { throw new Error("TODO(B3)"); }
  // ... all 20 methods, fully typed
}
```

Every stub carries a `TODO(<agent-id>)` marker naming its owner. Consequences:

- Downstream agents type-check against real signatures from minute one.
- `grep -r "TODO(" src/` is an exact, machine-checkable progress ledger.
- A wave-4 gate asserts zero `TODO(` markers remain.

### 4.4 Standing rules for every agent

1. **Write only your owned files.** If you need a change in someone else's file,
   report it to INT; do not edit it.
2. **Read the Python source.** Every agent brief names its source files. Port
   the behaviour, including the comments that explain *why* — several of them
   document API quirks that are not otherwise discoverable.
3. **Port the tests too.** Test files are part of your ownership, not a separate
   agent's job (§6 lists which tests belong to whom).
4. **No `any`.** `unknown` + a Zod parse, or a precise type.
5. **No new runtime dependencies** beyond those in §7 without INT approval.
6. **Report deliberate deviations** from Python behaviour; they become
   `PARITY.md` rows.

---

## 5. Agent briefs

### Wave 0 — Foundation

---

#### **F0 — Architect** *(blocking; must complete before Wave 1)*

**Mission.** Stand up the repository and publish the compile-time contracts that
let ten agents work simultaneously.

**Owns.** `package.json`, `tsconfig.json`, `tsconfig.build.json`,
`vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`,
`.github/workflows/ci.yml`, `src/index.ts`, `src/auth/index.ts`, and **stub
versions of every file in §1** with complete type signatures and
`TODO(<agent>)` bodies.

**Deliverables.**
1. Repo skeleton; `npm ci && npm run build && npm run lint && npm test` all
   succeed on an empty test suite.
2. Every `src/**` file exists with its full exported signature set, derived from
   the Python source, each body `throw new Error("TODO(<agent-id>)")`.
3. `src/index.ts` exporting the intended public surface.
4. `src/auth/index.ts` — the `EvnexAuth` facade. This is a *real* implementation
   (pure delegation to `CognitoSession` and the account operations), not a stub,
   because it is the seam that keeps B1 and B2 from colliding.
5. `PARITY.md` skeleton: a table with one row per Python public symbol, all
   marked `⬜ not started`.

**Acceptance.** `tsc --noEmit` passes. `grep -c "TODO(" src/` returns a count
matching the number of stubs. Every agent id A1–D4 appears in at least one TODO.

---

### Wave 1 — Leaf modules *(10 agents, fully parallel)*

---

#### **A1 — Config, errors, status**

**Ports.** `evnex/config.py`, `evnex/errors.py`, `evnex/status.py`.
**Owns.** `src/config.ts`, `src/errors.ts`, `src/status.ts`, `src/http/errors.ts`,
and their tests.

**Details.**
- `EvnexConfig` replaces `pydantic-settings` with a plain resolver reading
  `process.env` for `EVNEX_BASE_URL`, `EVNEX_COGNITO_USER_POOL_ID`,
  `EVNEX_COGNITO_CLIENT_ID`, `EVNEX_ORG_ID`, with the same defaults
  (`https://client-api.evnex.io`, `ap-southeast-2_zWnqo6ASv`,
  `rol3lsv2vg41783550i18r7vi`, `undefined`). Accept an explicit partial override
  object that wins over the environment.
- Full error hierarchy per §2.4, each with an explicit `name` and `cause` support.
- `DeviceStatus` as a `z.enum` plus a `const` object; `ConnectorOcppStatus` as a
  `Record<DeviceStatus, string>` with every string preserved verbatim.

**Acceptance.** Env-var precedence tested; every error class `instanceof`-checks
correctly through the hierarchy; `ConnectorOcppStatus` is exhaustive over
`DeviceStatus`.

---

#### **A2 — Model parsing**

**Ports.** `evnex/models.py`.
**Owns.** `src/models.ts` + tests.

**Details.** `parseModel(modelId)` → `EvnexModelInfo` for the E2, X and E7
series, including every lookup table and each `Unknown` fallback path. Note the
Python E7 branch sets `power: "7"` (not `"7 kW"`) — that asymmetry is in the
original and is preserved; flag it in `PARITY.md` as an upstream quirk carried
forward deliberately.

**Acceptance.** Table-driven tests covering `E2C-25VO`, `E2-18SN`, `X7-T2S-G`,
`X22-P1T-W`, `E7-T2S-WC`, plus malformed inputs for every fallback branch.

---

#### **A3 — Schemas (v2)**

**Ports.** `evnex/schema/{cost,commands,user,org,charge_points}.py`.
**Owns.** `src/schema/{cost,commands,user,org,chargePoints}.ts`,
`src/schema/json.ts`, + tests.

**Details.** Per §2.2. Includes the four `StrEnum`s in `charge_points.py`
(`ChargingLogic`, `ChargingCurrentControl`, `E2LEDState`, `AntiSleepState`), the
`register` → `rawRegister` alias, and the shared `toJson()` helper described in
§2.6 (which A9's fixture tests and every CLI `--json` path consume).

**Acceptance.** `toJson()` round-trips a fully populated charge point to output
byte-identical to Python's `model_dump(mode="json")` for the shared fixtures.
A user payload with no `name` validates (mirrors `test_user_without_name_validates`).

---

#### **A4 — Schemas (v3)**

**Ports.** `evnex/schema/v3/*.py`.
**Owns.** `src/schema/v3/*.ts` + tests.

**Details.** The generic `EvnexV3APIResponse[T]` becomes a factory:

```ts
export const evnexV3ApiResponse = <T extends z.ZodTypeAny>(attributes: T) =>
  z.object({
    data: z.object({ id: z.string(), type: z.string(), attributes, relationships: EvnexRelationships }),
    included: z.array(EvnexV3Include).nullish(),
  });
```

Note `EvnexChargePointConnectorMeter` here also aliases `register` → `rawRegister`
and carries the optional `supplyActivePower` (present only when a power sensor
is installed) — the CLI's grid-power display depends on distinguishing absent
from zero.

**Acceptance.** Tests mirroring `test_connector_meter_exposes_supply_active_power`
and `test_connector_meter_without_power_sensor`. The generic factory type-infers
correctly for `EvnexChargePointDetail`.

---

#### **A5 — SRP core**

**Ports.** The SRP machinery inside `pycognito` that `evnex/auth.py` relies on.
**Owns.** `src/auth/srp.ts` + tests.

**Details.** Implement §3.3 as a **pure, dependency-free, network-free** module:

```ts
export function createSrpClient(poolName: string): {
  srpA: string;
  computeChallengeResponse(params: {
    srpB: string; salt: string; secretBlock: string;
    username: string; password: string; timestamp?: Date;
  }): { signature: string; timestamp: string };
};
```

Highest-risk component in the port; it is deliberately isolated so it can be
tested exhaustively without any AWS involvement.

**Acceptance.**
- Known-answer tests: with `a`, `B`, `salt` and the clock all pinned, the
  derived `signature` matches a fixture vector.
- A dedicated test for the timestamp format asserting a non-padded day
  (`Tue Jan 2 …`, never `Tue Jan 02 …`) and the literal `UTC` marker,
  independent of the host `TZ` and locale.
- `PAD()` tested against Java `BigInteger.toByteArray()` semantics, including
  the high-bit `0x00` prefix case.
- `u == 0` and `A mod N == 0` rejection paths covered.

---

#### **A6 — Cognito adapter**

**Ports.** The `pycognito` surface used by `evnex/auth.py`.
**Owns.** `src/auth/cognito.ts` + tests.

**Details.** A narrow adapter exposing exactly the eleven operations in §3.1,
each returning plain data (no SDK types leaking past this module), each mapping
SDK errors per §3.2 into a `CognitoError` carrying `{ name, message }` for the
caller's own mapping. Depends on A5's `createSrpClient` — code against its
signature from the F0 stub; do not wait for A5 to land.

**Acceptance.** Every operation tested with `aws-sdk-client-mock`. The
`NEW_PASSWORD_REQUIRED` challenge path is covered. No `@aws-sdk/*` type appears
in any exported signature.

---

#### **A7 — Tokens, challenges, JWT, mutex**

**Ports.** `TokenSet`, `AuthChallenge`, `TotpEnrollment`, `MfaStatus`,
`_decode_expiry` from `evnex/auth.py`.
**Owns.** `src/auth/{tokens,challenge,mfa,jwt,mutex}.ts` + tests.

**Details.**
- `TokenSet` is **immutable** (`readonly` fields, `Object.freeze`), with
  `toJSON()`/`fromJSON()` matching Python's `to_dict`/`from_dict` key names
  exactly (`access_token`, `id_token`, `refresh_token`, `expires_at`) — the
  on-disk cache format must stay interchangeable with the Python CLI's.
- The constructor derives `expiresAt` from the access token's `exp` claim when
  not supplied, and normalises a naive/ambiguous stored timestamp to UTC.
- `decodeExpiry()` is a best-effort **unverified** decode; every malformed input
  returns `undefined` rather than throwing.
- `AuthChallenge` is JSON-serialisable so a web backend can answer it in a later
  request or another process.
- `TotpEnrollment.provisioningUri(accountName, issuer = "Evnex")` must
  percent-encode exactly as Python's `quote()` does.
- `Mutex.runExclusive(fn)` — FIFO, re-entrancy-free, releases on throw.

**Acceptance.** Tests mirroring the Python `TestTokenSet` and `TestAuthChallenge`
classes. A cache file written by the Python CLI parses; one written here matches
Python's JSON keys. `Mutex` serialises 100 concurrent tasks in submission order
and stays unlocked after a rejection.

---

#### **A8 — HTTP transport and retry**

**Ports.** `_request` / `_check_api_response` / `_ensure_success` / `api_retry`
from `evnex/api.py`, and `EvnexHttpxAuth` from `evnex/auth.py`.
**Owns.** `src/http/{transport,retry,authFlow}.ts` + tests.

**Details.**
- `transport.ts`: base-URL joining, the three common headers
  (`Accept`, `content-type`, `User-Agent: evnex-ts/<version>`), timeout →
  `EvnexTimeoutError`, and JSON parsing.
- `authFlow.ts`: inject `Authorization: <accessToken>` (note: **no `Bearer`
  prefix** — the API takes the bare token, as in the original), and on a 401
  call `forceRefresh({ staleAccessToken })` and resend **once**. A 401 after
  that becomes `ReauthenticationRequiredError`. The comment in the original
  explains why the single resend is safe even for command endpoints; carry it over.
- `retry.ts`: §2.5, exactly. Export `withRetry(fn, { nonRetryable })` plus a
  test seam for injecting the delay function (Python does this with
  `wait_none()`; tests must not actually sleep).

**Acceptance.** Delay distribution test asserting the uniform-over-window draw
and the 5-attempt cap. 401→refresh→resend covered, including the
"still 401 after refresh" path. Timeout produces `EvnexTimeoutError`, not a raw
`AbortError`.

---

#### **A9 — Test harness and fixtures**

**Ports.** `tests/conftest.py` and the JSON fixtures embedded across the Python
test suite.
**Owns.** `test/support/**`, `vitest.setup.ts` + the fixture-validation test.

**Details.**
- `fakeCognito.ts` — the `aws-sdk-client-mock` analogue of `FakeCognito`,
  including the token-serial rotation behaviour and the detail that **refresh
  responses omit the refresh token** unless pool rotation is enabled. That
  detail is what `TokenSet` carry-forward logic exists for.
- `msw` handlers + response fixtures for every EVNEX endpoint, lifted verbatim
  from the Python tests so both suites assert against identical payloads.
- Builders: `makeJwt({ expiresIn })`, `makeAuth()`, `makeResumedAuth()`,
  `makeClient()` — the analogues of the Python fixtures.
- A CLI harness capturing stdout/stderr separately and the process exit code,
  so the "`--json` output is the only thing on stdout" assertions port directly.

**Acceptance.** A test that validates every fixture against its schema
(the `test_fixtures_validate_against_models` analogue). The harness is consumed
by at least one test in each of B3, C2, C3 and C4 — coordinate the shape with
INT early, since this module has the most downstream readers.

---

#### **A10 — CLI primitives**

**Ports.** The non-command helpers in `evnex/cli/_auth.py` and `_resources.py`.
**Owns.** `src/cli/{tokenCache,prompt,otp,qr,format}.ts` + tests.

**Details.**
- `tokenCache.ts`: default path `$XDG_CACHE_HOME/evnex/tokens.json` (falling
  back to `~/.cache`), overridable via `EVNEX_TOKEN_CACHE`. Writes **must** pin
  mode `0600` on pre-existing files too — `fs.open(path, "w", 0o600)` then
  `fchmod`, exactly as the original does, because a plain `open` leaves an
  existing file's permissions alone. Unreadable caches warn on stderr and are
  ignored, never thrown.
- `prompt.ts`: `promptLine()` on stderr, `promptSecret()` with echo disabled via
  raw-mode readline. Prompts go to **stderr** so `--json` stdout stays valid.
- `otp.ts`: `--otp` (single-use — consumed on first read) and `--otp-command`
  (shell out, trim stdout, exit 1 on non-zero status or empty output, relay the
  child's stderr).
- `qr.ts`: terminal QR via the `qrcode` package; `--browser` writes an SVG to
  `$XDG_RUNTIME_DIR` when set (tmpfs, cleared at logout) else the temp dir,
  chmod `0600`, and prints the "contains your MFA secret, delete after scanning"
  warning. A missing `qrcode` package degrades to printing the otpauth URI —
  the original treats uninstalling it as a supported opt-out.
- `format.ts`: `kW()`, `kWh()`, `formatDateTime()`, `formatPeriod()`,
  `printTable()`. `printTable` pads to the max cell width per column and joins
  with two spaces — match it exactly so output diffs cleanly against Python's.

**Acceptance.** Token cache file mode asserted as `0600` on both create and
overwrite. `--otp` proven single-use. Formatter tests pinned to a fixed `TZ`.

---

### Wave 2 — Composition *(3 agents, parallel)*

---

#### **B1 — Session lifecycle**

**Ports.** `EvnexAuth`'s session half: `start_authentication`,
`respond_to_challenge`, `get_access_token`, `force_refresh`, `_store_tokens`,
`_run_user_pool_op`, `_tokens_from_cognito`.
**Owns.** `src/auth/session.ts` + tests.
**Depends on.** A5, A6, A7.

**Details.** The three properties that must survive the port intact:

1. **Single-flight refresh.** `forceRefresh({ staleAccessToken })` returns the
   already-rotated tokens without a second network call when another task won
   the race. The `_ALWAYS_REFRESH` sentinel distinguishes "refresh
   unconditionally" from "refresh unless already rotated" — and the stale token
   may legitimately be `undefined`, so a nullish check is *not* a valid
   substitute for the sentinel.
2. **Persist-before-publish.** `storeTokens` awaits `onTokenUpdate` **before**
   assigning `this.tokens`. A token set can never be used for a request before
   the application has persisted it. Callback failures are logged and swallowed:
   the tokens are valid regardless, and a broken store must not take API access
   down with it.
3. **`runUserPoolOp` recovery.** On `NotAuthorizedException` — which the local
   expiry check cannot predict, because the server may have revoked the token —
   refresh once and retry exactly once. The refresh happens *outside* the locked
   section (the lock is not re-entrant), so the loop alternates lock-held
   attempts with unlocked refreshes rather than nesting them.

`EXPIRY_SKEW` is 30 seconds and refreshes proactively.

**Acceptance.** Tests mirroring `TestInteractiveAuthentication`,
`TestTokenLifecycle`, `TestTokenSetResumption`, `TestErrorSurfaces`. Add a
concurrency test: 20 simultaneous `getAccessToken()` calls against an expired
session trigger exactly **one** refresh. Add an ordering test proving
`onTokenUpdate` resolves before any caller observes the new token.

---

#### **B2 — Account operations**

**Ports.** `EvnexAuth`'s account half: `get_mfa_status`,
`begin_totp_enrollment`, `confirm_totp_enrollment`, `set_mfa_preference`,
`change_password`, `start_password_reset`, `confirm_password_reset`.
**Owns.** `src/auth/account.ts` + tests.
**Depends on.** A6, A7, B1 (`CognitoSession` interface only — code against the
F0 stub, do not wait).

**Details.**
- `setMfaPreference` infers `preferred` when exactly one method is enabled, and
  **throws** when both are enabled with no preference given. Both flags false
  disables MFA entirely.
- `changePassword` must capture token rotation: the underlying call can rotate
  tokens as a side effect, and the rotated set has to be published rather than
  silently dropped. In Python this rides the `after=` hook so publication happens
  under the same lock as the call; preserve that ordering.
- `startPasswordReset` returns the masked delivery destination (or `""` when the
  server reports none) and needs no session.

**Acceptance.** Tests mirroring `TestMfaManagement` and `TestPasswordManagement`.
Explicit coverage of the both-methods-enabled-without-preference throw, and of
the token rotation captured during `changePassword`.

---

#### **B3 — API client**

**Ports.** `evnex/api.py` — all 20 methods.
**Owns.** `src/api.ts` + tests.
**Depends on.** A1, A3, A4, A8.

**Method inventory** (every one is in scope, including the deprecated pair):

| TS method | HTTP | Path |
|---|---|---|
| `getUserDetail` | GET | `/v2/apps/user` |
| `getOrgChargePoints` | GET | `/v2/apps/organisations/{org}/charge-points` |
| `getOrgInsight` | GET | `/organisations/{org}/summary/insights?days&tz-offset` |
| `getOrgSummaryStatus` | GET | `/v2/apps/organisations/{org}/summary/status` |
| `getOrgLocations` | GET | `/v2/apps/organisations/{org}/locations` |
| `getOrgConnectorSummary` | GET | `/organisations/{org}/summary/status` |
| `getChargePointDetail` *(deprecated)* | GET | `/v2/apps/charge-points/{cp}` |
| `getChargePointDetailV3` | GET | `/charge-points/{cp}` |
| `getChargePointSolarConfig` | POST | `/charge-points/{cp}/commands/get-solar` |
| `getChargePointOverride` | POST | `/charge-points/{cp}/commands/get-override` (timeout 15s) |
| `setChargePointOverride` | POST | `/charge-points/{cp}/commands/set-override` (timeout 10s) |
| `getChargePointStatus` | POST | `/charge-points/{cp}/commands/get-status` |
| `getChargePointEnergyMeterReading` | POST | `/charge-points/{cp}/commands/get-energy-meter-reading` |
| `getChargePointTransactions` *(deprecated)* | GET | `/v2/apps/charge-points/{cp}/transactions` |
| `getChargePointSessions` | GET | `/charge-points/{cp}/sessions` |
| `stopChargePoint` | POST | `/v2/apps/organisations/{org}/charge-points/{cp}/commands/remote-stop-transaction` |
| `enableCharger` / `disableCharger` | — | thin wrappers over `setChargerAvailability` |
| `setChargerAvailability` | POST | `/v2/apps/organisations/{org}/charge-points/{cp}/commands/change-availability` |
| `unlockCharger` | POST | `/v2/apps/organisations/{org}/charge-points/{cp}/commands/unlock-connector` |
| `setChargerLoadProfile` | PUT | `/v2/apps/charge-points/{cp}/load-management` |
| `setChargePointSchedule` | PUT | `/v2/apps/charge-points/{cp}/charge-schedule` |

**Details.**
- `resolveOrgId(orgId?)`: explicit argument → configured `EVNEX_ORG_ID` →
  the org resolved by `getUserDetail`; otherwise throw `EvnexConfigurationError`
  rather than emitting a request with a literal `undefined` in the path.
- `getUserDetail` defaults `orgId` to the user's first organisation **only when
  it is currently unset** — a blank `EVNEX_ORG_ID` counts as unset, matching the
  original's falsy check, and an explicitly configured value is never overridden.
- Deprecation: the two deprecated methods emit a one-shot
  `process.emitWarning(msg, "DeprecationWarning")` and carry `@deprecated` TSDoc.
- Retry policy per method exactly as tabulated in §2.5.
- `EvnexOptions` takes `{ auth, fetch?, config? }` — `fetch` is the injection
  point replacing "optionally pass in an httpx client".

**Acceptance.** One test per method asserting method, path, query, body and
parsed return type against `msw`. Tests mirroring
`test_get_user_detail_preserves_configured_org`,
`..._defaults_org_when_unset`, `..._defaults_org_when_blank`,
`test_org_method_without_org_id_raises`,
`test_set_override_fails_fast_on_timeout`, `test_get_org_locations_returns_data_objects`,
`test_get_org_connector_summary`.

---

### Wave 3 — CLI *(4 agents, parallel)*

---

#### **C1 — CLI skeleton**

**Ports.** `evnex/cli/__init__.py`.
**Owns.** `src/cli/index.ts`, `src/cli/parser.ts` + tests.

**Details.**
- `commander` program named `evnex`, `--version` from `package.json`.
- Shared flag groups mirroring argparse's parent parsers: `cacheFlags`
  (`--token-cache`), `otpFlags` (`--otp`, `--otp-command`), `jsonFlag`
  (`--json`), `chargePointFlag` (`--charge-point ID`). Attach them per command
  *exactly* as the original does — commands that never sign in (`auth logout`)
  or need no session (`auth reset-password`) must **reject** the session flags
  rather than ignore them. Two Python tests assert this.
- A command group with no leaf subcommand prints that group's help and exits 0.
- Top-level error mapping: `EvnexAuthError` → stderr + exit 1;
  `EvnexHttpError`/`EvnexTimeoutError` → stderr + exit 1; `EvnexValidationError`
  → the "try upgrading evnex" message + exit 1; SIGINT → exit 130.

**Acceptance.** Tests mirroring `test_leaf_commands_dispatch_to_their_handler`,
`test_shared_flags_accepted_in_trailing_position`, `test_version_exits_zero`,
`test_no_args_prints_help_and_exits_zero`, `test_old_names_no_longer_parse`,
`test_reset_password_rejects_session_flags`, `test_logout_only_takes_token_cache`.

---

#### **C2 — Auth commands**

**Ports.** the `cmd_*` functions and `add_auth_commands` in `evnex/cli/_auth.py`.
**Owns.** `src/cli/commands/auth.ts` + tests.

**Commands.** `auth login`, `auth logout`, `auth status`, `auth change-password`,
`auth reset-password`, `auth mfa enable|disable|enroll|confirm`.

**Details.** `signedInAuth(args)` is the shared entry: load the cached tokens,
try `getAccessToken()`, and on `ReauthenticationRequiredError` fall back to an
interactive sign-in, looping over challenges until a `TokenSet` comes back.
Credentials come from `EVNEX_CLIENT_USERNAME` / `EVNEX_CLIENT_PASSWORD` or
prompts. `auth status` decodes the cached **id** token (unverified) for the
signed-in identity, preferring `email` then `cognito:username`.

**Acceptance.** Tests mirroring `TestLogout`, `TestLoadTokens`,
`TestPasswordMismatch`, `TestOtpCommand`,
`test_challenge_code_prompts_on_stderr`,
`test_confirm_no_prefer_sets_prefer_false`, `test_confirm_defaults_to_preferring`.

---

#### **C3 — Resource read commands**

**Ports.** `cmd_live_status`, `cmd_charge_points_list`, `cmd_charge_points_show`,
`cmd_sessions_list`, `cmd_locations_list`, `cmd_insights`, `cmd_schedule_show`.
**Owns.** `src/cli/commands/resources.ts` + tests.

**Details.**
- `openClient(args)` — sign in, build the `Evnex` client, and always release
  resources on exit (the `asynccontextmanager` analogue).
- `--json` emits a single JSON document on stdout via A3's `toJson()`;
  **all** diagnostics go to stderr. Several Python tests assert stdout purity.
- Sessions are explicitly sorted newest-first: the API documents no ordering, so
  sort rather than assume one. `--limit` defaults to 10 and rejects non-positive
  values. `insights --days` accepts only `7 | 14 | 30`, defaulting to 7.

**Acceptance.** Tests mirroring `test_status_shows_power_and_active_session`,
`test_status_json_is_the_only_thing_on_stdout`,
`test_status_renders_charge_point_without_meter`, `test_charge_points_list`,
`test_charge_points_show`, `test_sessions_list`,
`test_sessions_list_respects_limit`, `test_sessions_ordering_is_enforced`,
`test_insights`, `test_insights_defaults/rejects`, `test_locations_list`,
`test_locations_list_json_is_the_only_thing_on_stdout`,
`test_locations_list_handles_missing_address`, `test_schedule_show`,
`test_schedule_show_json`, `test_json_purity_on_listings`.

---

#### **C4 — Control commands and resolution**

**Ports.** `cmd_charge_now`, `cmd_charge_auto`, `cmd_charge_stop`,
`_match_charge_point`, `_resolve_one`.
**Owns.** `src/cli/commands/charge.ts`, `src/cli/resolve.ts` + tests.

**Details.**
- Resolution order: exact id wins; otherwise case-insensitive substring match on
  name **or** serial. Zero or multiple matches print the candidates and exit **2**.
  With no selector, a sole charge point is used; otherwise exit 2 listing the
  choices. The exit codes are part of the CLI contract.
- `charge stop` confirms interactively unless `--yes`, and translates
  `EvnexTimeoutError` into "No active charging session on X to stop." with exit 1
  — the API answers a stop with no active session as a 504, which surfaces as a
  read timeout.

**Acceptance.** Tests mirroring `test_resolve_*` (7 cases),
`test_charge_now_sends_override`, `test_charge_auto_sends_override`,
`test_charge_stop`, `test_charge_stop_no_active_session_exits_1`,
`test_charge_stop_declined_prompt_aborts`,
`test_charge_stop_accepted_prompt_sends_command`.

---

### Wave 4 — Verification and release *(4 agents, parallel)*

---

#### **D1 — Parity auditor**

**Owns.** `PARITY.md`.

Walk every public symbol in `python-evnex` and record its TS counterpart, status
(`✅ ported` / `🔄 adapted` / `❌ omitted`) and a note for anything not `✅`.
Read the Python source directly; do not trust this plan as the inventory —
finding what the plan missed is the job. Fail the wave gate on any undocumented
omission.

Known-and-expected rows: the `NotAuthorizedException` deprecated alias (omitted),
`asyncio.to_thread` wrappers (adapted away), `blockbuster` (not applicable),
`pydantic-settings` (adapted), and whatever A5/A6 report about JWKS verification
and device tracking.

---

#### **D2 — Test-parity auditor**

**Owns.** `test/PARITY.md` + any gap-filling tests it writes.

The Python suite has **65 tests** across 5 files. Produce a table mapping each to
its TS counterpart, write the missing ones, and report coverage. Target: ≥90%
line coverage on `src/`, 100% on `src/auth/srp.ts` and `src/http/retry.ts` —
the two modules where a subtle error is silent and expensive.

---

#### **D3 — Documentation**

**Owns.** `README.md` (final pass), `examples/**`, TSDoc completeness, `NOTICE`.

Port all five example scripts to TypeScript. Verify every README code sample
type-checks (extract-and-compile in CI). Confirm the acknowledgements section
credits Brian Thorne and `hardbyte/python-evnex` prominently — it is a stated
requirement of this port, not a footnote. Ensure `NOTICE` and the Apache-2.0
`LICENSE` correctly preserve upstream attribution.

---

#### **D4 — Release engineering**

**Owns.** `.github/workflows/release.yml`, `CHANGELOG.md`, `package.json`
publish metadata, `.npmignore`/`files`.

- CI matrix: Node 20, 22, 24 on `ubuntu-latest`; lint, typecheck, test, build.
- Publish on GitHub release with npm provenance (`--provenance`, `id-token: write`),
  mirroring the upstream PyPI workflow's trusted-publishing shape.
- `exports` map: `.` (library) and `./package.json`; `bin: { evnex: "./dist/cli/index.js" }`.
- Verify the built package installs and `npx evnex --version` runs from a clean
  tarball before the gate passes.
- Resolve the two open decisions in §0.

---

#### **INT — Integrator** *(standing, all waves)*

Merge completed agent branches into `claude/typescript-evnex-port-zpbiqu`, run
the wave gate, arbitrate any cross-file change request, and maintain the
`TODO(...)` ledger. Owns no source files.

---

## 6. Test-parity ledger

| Python test file | Tests | Owning agent(s) |
|---|---|---|
| `tests/test_auth.py` | 9 classes | A7 (`TestTokenSet`, `TestAuthChallenge`), B1 (`TestInteractiveAuthentication`, `TestTokenLifecycle`, `TestTokenSetResumption`, `TestErrorSurfaces`), A8 (`TestTransport`), B2 (`TestMfaManagement`, `TestPasswordManagement`) |
| `tests/test_cli.py` | 14 | C1, C2 |
| `tests/test_cli_resources.py` | 44 | C3, C4, B3 |
| `tests/test_schema.py` | 4 | A3, A4 |
| `tests/conftest.py` | fixtures | A9 |

---

## 7. Dependencies

**Runtime**

| Package | Replaces | Notes |
|---|---|---|
| `zod` ^4 | `pydantic` | |
| `@aws-sdk/client-cognito-identity-provider` ^3 | `boto3` | tree-shakeable; only the commands in §3.1 are imported |
| `commander` ^12 | `argparse` | CLI only |
| `qrcode` ^1.5 | `qrcode` | CLI only; **optional peer** — a missing install degrades gracefully, as upstream |
| `jose` ^5 | `pyjwt` | JWT decode + optional JWKS verification |

`httpx` → native `fetch`. `tenacity` → `src/http/retry.ts`. `pydantic-settings`
→ `src/config.ts`. `pycognito` → `src/auth/{srp,cognito}.ts`.

**Dev:** `typescript`, `vitest`, `@vitest/coverage-v8`, `msw`,
`aws-sdk-client-mock`, `eslint`, `typescript-eslint`, `prettier`, `tsup`,
`@types/node`.

---

## 8. Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **SRP implementation is subtly wrong** — the timestamp format, `PAD()`, or the HKDF info string. Fails only against live Cognito, and always as an opaque `NotAuthorizedException`. | Sign-in never works | Dedicated agent (A5) landing in Wave 1; known-answer vectors; a standalone timestamp test; 100% coverage requirement; a manual live smoke test before release |
| 2 | Cognito **device tracking** enabled on the pool would issue a `DEVICE_SRP_AUTH` challenge this port does not implement | Sign-in fails for affected accounts | Detect and raise a clear, named error rather than a generic failure; document in `PARITY.md` |
| 3 | `pycognito`'s **JWKS token verification** has no free equivalent | Behavioural difference vs. Python | Port with `jose` behind a `verifyTokens` flag; if dropped, document explicitly |
| 4 | **Retry semantics** silently mis-ported (full-jitter instead of uniform, or 5 retries instead of 5 attempts) | Thundering herd against the API | Distribution test in A8; §2.5 states the formula literally |
| 5 | **Schema strictness** — a `.strict()` Zod object turns a benign API field addition into a hard failure | Outage on an upstream change | §2.2 forbids `.strict()`; D1 audits |
| 6 | **CLI output drift** from the Python CLI breaks anyone parsing it | Silent breakage for scripted users | Shared fixtures; byte-comparison tests on `--json`; `printTable` spec pinned in A10 |
| 7 | **No live account** for end-to-end verification | Integration bugs reach release | All fixtures lifted verbatim from the Python tests; ship `0.1.0` as a pre-release and ask for community verification |
| 8 | **Agent file collision** despite disjoint ownership | Lost work at merge | INT merges continuously; a conflict is treated as a plan defect and escalated, not hand-resolved |

---

## 9. Definition of done

1. `npm run lint && npm run typecheck && npm test && npm run build` green on
   Node 20, 22 and 24.
2. Zero `TODO(` markers in `src/`.
3. `PARITY.md`: every Python public symbol `✅` or `🔄`, with a note on each `🔄`;
   every `❌` justified.
4. `test/PARITY.md`: all 65 Python tests mapped; ≥90% line coverage overall,
   100% on `src/auth/srp.ts` and `src/http/retry.ts`.
5. All five examples ported and type-checking.
6. `README.md` complete, every sample compiling, and the acknowledgement of
   Brian Thorne and `hardbyte/python-evnex` present and prominent.
7. `LICENSE` (Apache-2.0) and `NOTICE` preserve upstream attribution.
8. A clean-tarball install runs `npx evnex --version`.
9. Manual live smoke test of `evnex auth login` and `evnex status` against a real
   account — the only check that can actually prove the SRP implementation.

---

## 10. Appendix — module port map

| Python | Lines | TypeScript | Agent |
|---|---|---|---|
| `evnex/__init__.py` | 4 | `src/index.ts` | F0 |
| `evnex/config.py` | 8 | `src/config.ts` | A1 |
| `evnex/errors.py` | 54 | `src/errors.ts` | A1 |
| `evnex/status.py` | 28 | `src/status.ts` | A1 |
| `evnex/models.py` | 130 | `src/models.ts` | A2 |
| `evnex/api.py` | 585 | `src/api.ts`, `src/http/*` | B3, A8 |
| `evnex/auth.py` | 682 | `src/auth/*` | A5, A6, A7, B1, B2 |
| `evnex/schema/*.py` | 318 | `src/schema/*.ts` | A3 |
| `evnex/schema/v3/*.py` | 271 | `src/schema/v3/*.ts` | A4 |
| `evnex/cli/__init__.py` | 132 | `src/cli/{index,parser}.ts` | C1 |
| `evnex/cli/_auth.py` | 415 | `src/cli/commands/auth.ts`, `src/cli/{tokenCache,prompt,otp,qr}.ts` | C2, A10 |
| `evnex/cli/_resources.py` | 559 | `src/cli/commands/{resources,charge}.ts`, `src/cli/{format,resolve}.ts` | C3, C4, A10 |
| `tests/**` | 1,749 | `test/**` | all |
| `examples/**` | 5 files | `examples/**` | D3 |
