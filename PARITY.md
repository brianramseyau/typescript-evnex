# PARITY.md

Symbol-by-symbol port audit: one row per public (and load-bearing private,
where a later wave's brief names it explicitly) symbol in `python-evnex`
@ 0.7.0. Populated by **F0** as a skeleton — every row started `⬜ not
started`. **D1** (Wave 4) walked `evnex/**.py` directly (not the skeleton, not
the plan) against every corresponding `src/**.ts` file, corrected the
skeleton's status/notes, added rows it missed, and ruled on the three open
adjudications from the Wave 4 brief.

Status legend: ✅ ported · 🔄 adapted (deliberate behavioural difference,
noted) · ❌ omitted (justified). No `⬜` rows remain.

Parity target: **python-evnex 0.7.0**. This package's own version starts at
`0.1.0` rather than mirroring `0.7.0`, to avoid implying a shared release
history (PLAN.md §0, open decision 1).

**Audit method.** Every row below was checked by reading the named Python
source file and the named TypeScript file side by side — not by trusting the
skeleton's claim or a prior agent's self-report. Field-by-field requiredness
was checked for every schema in `evnex/schema/**.py` against its Zod
counterpart; the one place they disagree is §`evnex/schema/v3/generic.py`
below (`included`), and it is new — no earlier wave's findings mention it.

---

## `evnex/__init__.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| module-level `NullHandler` logging setup | — (no analogue) | ❌ omitted (justified) | Node has no stdlib logging framework for a library to stay silent within; there is nothing to attach a null handler to. The port does not install its own logging by default — the only unprompted diagnostic output anywhere is `console.error` in `CognitoSession.publishTokens` when a caller's `onTokenUpdate` throws (`src/auth/session.ts`), which is a deliberate, narrow, operator-visible fallback (Python logs the equivalent via `logger.exception`), not a general logging facility that needs silencing. |

## `evnex/config.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `EvnexConfig` | `src/config.ts` `EvnexConfig` | 🔄 adapted | `pydantic-settings` `BaseSettings` → plain `process.env` resolver + explicit override object (PLAN.md §5 A1). Field names, defaults, and env-var names (`EVNEX_BASE_URL`, `EVNEX_COGNITO_USER_POOL_ID`, `EVNEX_COGNITO_CLIENT_ID`, `EVNEX_ORG_ID`) all match verbatim. Confirmed: an empty-string env var is treated as unset in both (Python via `pydantic-settings`' env parsing quirks avoided by the port matching it explicitly; TS via an explicit `.length > 0` check). |

## `evnex/errors.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `EvnexAuthError` | `src/errors.ts` `EvnexAuthError` | ✅ ported | |
| `InvalidCredentialsError` | `src/errors.ts` `InvalidCredentialsError` | ✅ ported | |
| `ReauthenticationRequiredError` | `src/errors.ts` `ReauthenticationRequiredError` | ✅ ported | |
| `ChallengeExpiredError` | `src/errors.ts` `ChallengeExpiredError` | ✅ ported | |
| `PasswordChangeRequiredError` | `src/errors.ts` `PasswordChangeRequiredError` | ✅ ported | |
| `InvalidChallengeResponseError` | `src/errors.ts` `InvalidChallengeResponseError` | ✅ ported | |
| `EvnexConfigurationError` | `src/errors.ts` `EvnexConfigurationError` | ✅ ported | |
| `NotAuthorizedException` (deprecated `__getattr__` alias) | — | ❌ omitted (justified) | Confirmed in `evnex/errors.py`: a module-level `__getattr__` that warns `DeprecationWarning` and returns `EvnexAuthError`. Scheduled for removal in python-evnex 0.8.0; JS has no module-`__getattr__` analogue and nothing would be gained by faking one for a symbol upstream is deleting. |
| (n/a — TS-only) | `EvnexError` (new root of the hierarchy) | 🔄 adapted (addition) | No direct Python analogue: python-evnex's `EvnexAuthError`/`EvnexConfigurationError` each extend `ValueError` separately (confirmed: `class EvnexAuthError(ValueError)`, `class EvnexConfigurationError(ValueError)`, no shared base); this port introduces a shared `EvnexError` root (PLAN.md §2.4). `EvnexHttpError`/`EvnexTimeoutError` (`src/http/errors.ts`) also extend it. |
| (n/a — TS-only) | `EvnexValidationError` (`src/errors.ts`) | 🔄 adapted (addition) | Wraps `z.ZodError` on `cause`; analogue of letting `pydantic.ValidationError` propagate unwrapped in Python. Thrown at every `Schema.safeParse` boundary in `src/api.ts`. |

## `evnex/status.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `DeviceStatus` | `src/status.ts` `DeviceStatus` | ✅ ported | `StrEnum` → `z.enum` + exported `DeviceStatusValues` const object (PLAN.md §2.2). All 10 members verified identical. |
| `ConnectorOcppStatus` | `src/status.ts` `ConnectorOcppStatus` | ✅ ported | All 10 mapped strings verified byte-identical, including `"Charging has been paused by the charge point"` and `"The vehicle is not currently requesting energy"`. |

## `evnex/models.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `EvnexModelInfo` | `src/models.ts` `EvnexModelInfo` | ✅ ported | Field names camelCased (`cable_length` → `cableLength`, `power_sensor` → `powerSensor`); all default to `"N/A"` in the E2 branch, matching the dataclass defaults. |
| `parse_model` | `src/models.ts` `parseModel` | ✅ ported | ⚠ 0% covered upstream (PLAN.md §6.3) — A2's tests are the first verification this logic has ever had. Verified line-for-line against all three branches (E2, X, E7) plus the fallback; the TS version adds explicit length guards (`spec.length < 3`, etc.) that Python leaves to `IndexError`/`ValueError` propagating out of the `try` — a defensive rewrite of the same control flow, not a behavioural difference (both branches return the same `"Unknown"` result on malformed input). |
| `CONNECTOR_MAP`, `NAME_MAP_E2`, `CABLE_MAP_E2`, `COLOUR_MAP`, `POWER_MAP`, `PS_MAP`, `CONFIG_MAP` | internal `const` lookup tables in `models.ts` | ✅ ported | Not exported, matching Python's module-private convention (never imported elsewhere in `evnex`). All values verified identical. |
| E7 branch's `power: "7"` (not `"7 kW"`) | same field in `parseModel`'s E7 branch | 🔄 adapted | Upstream asymmetry (E7 sets `power="7"` where the X-series branch would produce `"7 kW"` via `POWER_MAP`), preserved deliberately (PLAN.md §5 A2) — confirmed still present and commented in both `models.py` and `models.ts`. |

## `evnex/api.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `Evnex` (class) | `src/api.ts` `Evnex` | ✅ ported | |
| `Evnex.__init__` | `Evnex` constructor / `EvnexOptions` | ✅ ported | `httpx_client` param → `fetch` injection point (`EvnexOptions.fetch`, threaded through `Transport`). |
| `get_user_detail` | `getUserDetail` | ✅ ported | Org-id-default logic (never overrides an explicitly configured/resolved org id; blank counts as unset) verified identical. |
| `get_org_charge_points` | `getOrgChargePoints` | ✅ ported | `EvnexHttpError` extra non-retryable, matches `@api_retry(HTTPStatusError)`. |
| `get_org_insight` | `getOrgInsight` | ✅ ported | Multi-param → options object (`{ days, orgId?, tzOffset? }`, default `tzOffset = 12`), per README convention. |
| `get_org_summary_status` | `getOrgSummaryStatus` | ✅ ported | |
| `get_org_locations` | `getOrgLocations` | ✅ ported | `EvnexHttpError` extra non-retryable, matches `@api_retry(HTTPStatusError)`. |
| `get_org_connector_summary` | `getOrgConnectorSummary` | ✅ ported | |
| `get_charge_point_detail` | `getChargePointDetail` | ✅ ported | `@deprecated`; Python's `warnings.warn(DeprecationWarning)` (module-level dedup) → `process.emitWarning` gated by a per-instance flag — the closest faithful analogue for a JS object (PLAN.md notes this is intentional, not a miss). |
| `get_charge_point_detail_v3` | `getChargePointDetailV3` | ✅ ported | `TypeError` extra non-retryable, matches `@api_retry(TypeError)`. |
| `get_charge_point_solar_config` | `getChargePointSolarConfig` | ✅ ported | `EvnexTimeoutError` extra non-retryable, matches `@api_retry(ReadTimeout)`. |
| `get_charge_point_override` | `getChargePointOverride` | ✅ ported | `timeout=15` → `timeoutMs: 15_000`, verified. |
| `set_charge_point_override` | `setChargePointOverride` | ✅ ported | `EvnexHttpError`+`EvnexTimeoutError` extra non-retryable, `timeout=10`→`10_000`, both matching `@api_retry(HTTPStatusError, ReadTimeout)`. |
| `get_charge_point_status` | `getChargePointStatus` | ✅ ported | |
| `get_charge_point_energy_meter_reading` | `getChargePointEnergyMeterReading` | ✅ ported | |
| `get_charge_point_transactions` | `getChargePointTransactions` | ✅ ported | `@deprecated`, same emitWarning-with-flag pattern as `getChargePointDetail`. |
| `get_charge_point_sessions` | `getChargePointSessions` | ✅ ported | No `/v2/apps` prefix and JSON:API envelope, confirmed genuinely different from `getOrgChargePoints` (PLAN.md §10.2), not a transcription slip. |
| `stop_charge_point` | `stopChargePoint` | ✅ ported | |
| `enable_charger` | `enableCharger` | ✅ ported | Thin wrapper calling `setChargerAvailability({..., available: true})`, matches. |
| `disable_charger` | `disableCharger` | ✅ ported | Thin wrapper, `available: false`. |
| `set_charger_availability` | `setChargerAvailability` | ✅ ported | No retry decorator in Python — none in the port either. Confirmed `org_id` is a **required** parameter in both (Python: `org_id: str`, no default; TS: `ChargerAvailabilityTarget.orgId: string`, no `?`) — this method never calls `_resolve_org_id`/`resolveOrgId` in either language, unlike every other org-scoped method. |
| `unlock_charger` | `unlockCharger` | 🔄 adapted | **Confirmed genuine upstream bug**, verbatim: `evnex/api.py` line 501 interpolates `self.org_id` directly (`f"/v2/apps/organisations/{self.org_id}/..."`) instead of calling `self._resolve_org_id(None)` the way every sibling org-scoped method does. If `org_id` was never resolved, this silently sends the literal string `"None"` in the URL path rather than raising. The port deliberately deviates: `unlockCharger` calls `this.resolveOrgId()` (no argument) and throws `EvnexConfigurationError` if no org id is available — the same fail-fast behaviour as `stopChargePoint`/`setChargerAvailability`. Dedicated test (`test/api.test.ts`) proves it throws rather than emitting the literal string. Worth reporting upstream (`hardbyte/python-evnex`) as a bug; the fix there is the one-line change to call `_resolve_org_id`. |
| `set_charger_load_profile` | `setChargerLoadProfile` | ✅ ported | No retry decorator in Python — none in the port either. Segment re-validation (`pydantic.parse_obj_as(list[EvnexChargeProfileSegment], ...)` → `EvnexChargeProfileSegment.parse(segment)` per item) matches. |
| `set_charge_point_schedule` | `setChargePointSchedule` | 🔄 adapted | No retry decorator in Python — none in the port either. `# "timezone": timezone` stays commented out in Python (confirmed, line 580); the port's request body likewise omits both `units` and `timezone`, with an inline comment pointing at §10.1 rather than silently reproducing the omission with no explanation. |
| `_request` | `src/http/transport.ts` `Transport.send` | ✅ ported | |
| `_check_api_response` | `src/http/transport.ts` `checkApiResponse` | ✅ ported | Confirmed: an invalid-JSON body propagates its raw parse error unwrapped in both — Python lets `pydantic_core.from_json`'s error re-raise from a bare `except Exception: ... raise`; TS's `JSON.parse` throws its `SyntaxError` with no wrapping. Untested upstream (PLAN.md §6.3). |
| `_ensure_success` | `src/http/transport.ts` `ensureSuccess` | ✅ ported | 401 → `ReauthenticationRequiredError` (the auth flow already refreshed-and-resent once) verified identical message intent. |
| `_resolve_org_id` | `Evnex`'s private `resolveOrgId` | ✅ ported | |
| `api_retry` / `NON_RETRYABLE_EXCEPTIONS` | `src/http/retry.ts` `withRetry` / `STANDING_NON_RETRYABLE` | ✅ ported | Uniform-jitter, 5-attempt policy verified against PLAN.md §2.5's spec, including the `n = 1…4` (not `2…5`) indexing. `reraise=True` → underlying error rethrown unwrapped on exhaustion. |
| (n/a — TS-only) | `EvnexHttpError.correlationId` | 🔄 adapted (addition) | Pure addition — python-evnex's `_ensure_success`/`_check_api_response` never read `x-correlation-id` at all. `ensureSuccess` (`src/http/transport.ts`) reads it and attaches it to `EvnexHttpError`; the raw response body is deliberately kept off `.message` (only on `.cause`), per PLAN.md §10.6. |
| `EVNEX_VERSION` (`importlib.metadata.version`) | `Evnex.version` (via `Transport.version` / `resolvePackageVersion`) | ✅ ported | Both fall back to the literal string `"unknown"` when the package metadata can't be resolved (`PackageNotFoundError` / a `try`/`catch` around reading `package.json`). |

## `evnex/auth.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `TokenSet` | `src/auth/tokens.ts` `TokenSet` | ✅ ported | Frozen dataclass → `Object.freeze`d class with `readonly` fields. |
| `TokenSet.to_dict` / `from_dict` | `TokenSet.toJSON` / `TokenSet.fromJSON` | ✅ ported | Key names (`access_token`, `id_token`, `refresh_token`, `expires_at`) preserved verbatim so cache files interchange with the Python CLI. `fromJSON` appends `"Z"` to a zone-less stored timestamp before parsing — Python's `datetime.fromisoformat()` treats a zone-less string as naive-then-UTC (`__post_init__`'s `tzinfo is None` branch); JS's `Date` constructor instead treats a zone-less date-time string as **local** time, a real cross-machine cache bug if not corrected. This divergent-parsing-to-reach-the-same-result is 🔄-worthy in spirit but the *externally observable* behaviour (what a stored naive timestamp means) matches, so recorded here rather than as its own row. |
| `AuthChallenge` | `src/auth/challenge.ts` `AuthChallenge` | ✅ ported | Python marks both `session` and `username` `field(repr=False)`. TS has no dataclass `repr`, so the equivalent is a `toString()` plus an `inspect.custom` hook — both needed, because `console.log` reaches for `util.inspect` and ignores `toString()` unless the hook is wired. Originally ported without either, so a stray debug line printed a live Cognito session credential and the user's email; found by D2 (no TS counterpart existed for `test_challenge_repr_redacts_username`, because there was nothing to test) and fixed. `toJSON()` deliberately still emits both — serialising a challenge to answer it in another process is this class's purpose, and is a different act from logging one. |
| `TotpEnrollment` | `src/auth/mfa.ts` `TotpEnrollment` | ✅ ported | |
| `TotpEnrollment.provisioning_uri` | `TotpEnrollment.provisioningUri` | ✅ ported | Custom `pythonQuote` percent-encoder matching Python's `urllib.parse.quote(safe="/")` exactly (`encodeURIComponent` differs on `!*'()` and `/`); confirmed against the module's own worked examples. |
| `MfaStatus` | `src/auth/mfa.ts` `MfaStatus` | ✅ ported | |
| `_decode_expiry` | `src/auth/jwt.ts` `decodeExpiry` | ✅ ported | Manual base64url decode, no `jose`; returns `undefined` (Python: `None`) on every malformed-input case tested (`jwt.DecodeError, KeyError, TypeError, ValueError` in Python vs. a catch-all in TS around the same decode+lookup). |
| `EvnexAuth` (class) | `src/auth/index.ts` `EvnexAuth` (facade) + `src/auth/session.ts` `CognitoSession` + `src/auth/account.ts` `AccountOperations` | ✅ ported | Split across F0 (facade, pure delegation), B1 (session half), B2 (account half). Confirmed the facade is a real implementation, not a stub — every method delegates 1:1. |
| `EvnexAuth.start_authentication` | `CognitoSession.startAuthentication` / `EvnexAuth.startAuthentication` | ✅ ported | |
| `EvnexAuth.respond_to_challenge` | `CognitoSession.respondToChallenge` / `EvnexAuth.respondToChallenge` | ✅ ported | |
| `EvnexAuth.get_access_token` | `CognitoSession.getAccessToken` / `EvnexAuth.getAccessToken` | ✅ ported | |
| `EvnexAuth.force_refresh` / `_ALWAYS_REFRESH` | `CognitoSession.forceRefresh` (overloaded: no-arg vs. `{ staleAccessToken }`) | ✅ ported | Sentinel becomes an overload distinguishing "no argument at all" (`options === undefined`) from `{ staleAccessToken: undefined }`; confirmed by dedicated tests that the two behave differently. |
| `EvnexAuth._run_user_pool_op` | `CognitoSession.runUserPoolOp` | ✅ ported | Exposed (not private) so `account.ts` can share it — confirmed `account.ts` depends only on a narrow structural `AccountSession` interface, not the concrete class. |
| `EvnexAuth.get_mfa_status` | `AccountOperations.getMfaStatus` / `EvnexAuth.getMfaStatus` | ✅ ported | |
| `EvnexAuth.begin_totp_enrollment` | `AccountOperations.beginTotpEnrollment` / `EvnexAuth.beginTotpEnrollment` | ✅ ported | |
| `EvnexAuth.confirm_totp_enrollment` | `AccountOperations.confirmTotpEnrollment` / `EvnexAuth.confirmTotpEnrollment` | ✅ ported | `device_name` positional (`= ""` default) → `{ deviceName }` options object (`options.deviceName ?? ""`), per README convention. |
| `EvnexAuth.set_mfa_preference` | `AccountOperations.setMfaPreference` / `EvnexAuth.setMfaPreference` | ✅ ported | Preference-inference logic (`preferred is None and (totp ^ sms)`) and the both-true-no-preference `ValueError` both verified line-for-line, including that the TS error is a **plain `Error`**, not part of the `Evnex*Error` hierarchy — matching Python raising a bare `ValueError` here rather than `EvnexAuthError`. |
| `EvnexAuth.change_password` | `AccountOperations.changePassword` / `EvnexAuth.changePassword` | 🔄 adapted | See "Adjudication 1" below — ruled **not a defect**, but the rotation-capture mechanism genuinely differs from Python's, so recorded as adapted rather than a plain ✅. |
| `EvnexAuth.start_password_reset` | `AccountOperations.startPasswordReset` / `EvnexAuth.startPasswordReset` | ✅ ported | |
| `EvnexAuth.confirm_password_reset` | `AccountOperations.confirmPasswordReset` / `EvnexAuth.confirmPasswordReset` | ✅ ported | |
| `EvnexAuth._ensure_cognito` | `src/auth/cognito.ts` `createCognitoAdapter` | ✅ ported | Lazy-on-first-use in Python (worker thread, since boto3 client construction blocks) → built eagerly in `EvnexAuth`'s constructor in TS (no blocking-I/O concern in Node to defer around). Confirmed: `src/auth/index.ts`'s constructor calls `createCognitoAdapter` unconditionally, not lazily. |
| `EvnexAuth._tokens_from_cognito` | `CognitoSession.tokensFromCognito` (private) | ✅ ported | Refresh-token carry-forward (`refreshToken ?? this.currentTokens?.refreshToken`) verified, with a dedicated test using a fake adapter that omits `refreshToken` on renewal. |
| `EvnexAuth._store_tokens` | `CognitoSession.publishTokens` (public) | ✅ ported | Persist-before-publish ordering verified with a gated `onTokenUpdate` that observes the *old* token set mid-persist. Made **public** (Python's is private, `_store_tokens`) specifically so `account.ts`'s `changePassword` could, in principle, call it from a `runUserPoolOp` `after` hook — see Adjudication 1: in the shipped code, nothing outside `session.ts` itself actually calls it, so this is public surface with no current external caller. Not a defect, but worth noting for anyone auditing the public API surface. |
| `EvnexHttpxAuth` | `src/http/authFlow.ts` `withAuthFlow` | ✅ ported | Bare-token `Authorization` header (no `Bearer`), single 401 refresh+resend, verified (PLAN.md §10.5). |
| `_error_message` | folded into `CognitoError.message` (`src/auth/cognito.ts`) | ✅ ported | Python extracts `err.response["Error"]["Message"]`; the SDK v3 equivalent already surfaces this as `Error.message`, so `toCognitoError` just forwards it — no separate helper function needed. |
| `_map_challenge_error` | `mapChallengeError` (`src/auth/session.ts`, module-private) | ✅ ported | All three branches (`CodeMismatchException`, `ExpiredCodeException`/`NotAuthorizedException`, fallback) verified identical. |
| `CHALLENGE_SOFTWARE_TOKEN_MFA`, `CHALLENGE_SMS_MFA` | same-named constants in `session.ts` | ✅ ported | |
| `EXPIRY_SKEW` (30s) | `EXPIRY_SKEW_MS = 30_000` in `session.ts` | ✅ ported | |
| `TokenUpdateCallback` | `src/auth/session.ts` `TokenUpdateCallback` | ✅ ported | |
| SRP handshake (via `pycognito`) | `src/auth/srp.ts` `createSrpClient` | ✅ ported | Hand-written per RFC 5054 + Cognito variations (PLAN.md §3.3). A5's differential oracle (4 pinned input sets against a stubbed Cognito wire protocol, capturing the actual `ChallengeResponses` body) passed; confirmed `N`/`g`/`k`, `PAD`, `u`/`x`/`S`, HKDF params, and the non-zero-padded C-locale timestamp format all match pycognito's `aws_srp.py`. |
| Cognito operation surface (via `pycognito`) | `src/auth/cognito.ts` `CognitoAdapter` | ✅ ported | 11 operations (`authenticate`, `respondToSoftwareTokenMfaChallenge`, `respondToSmsMfaChallenge`, `renewAccessToken`, `getUser`, `associateSoftwareToken`, `verifySoftwareToken`, `setUserMfaPreference`, `changePassword`, `forgotPassword`, `confirmForgotPassword`), matching PLAN.md §3.1's table 1:1. No `@aws-sdk/*` type leaks past `cognito.ts` (verified by A6's `expectTypeOf` structural-equality tests, per its own report; spot-checked the interface here and no SDK import appears outside this file). |
| `pycognito`'s JWKS token verification | `src/auth/jwt.ts` `verifyJwt` / `fetchJwks`, wired via `CognitoSessionOptions.verifyTokens` | ✅ ported | **Landed, not a gap.** `verifyJwt` (native `node:crypto`, `createPublicKey({format:"jwk"})` + RSA-SHA256 verify) is called from `CognitoSession.verifyIssuedTokens` on every freshly issued or refreshed token pair, defaulting to `true`. Confirmed reachable end-to-end: `EvnexAuthOptions.verifyTokens` (`src/auth/index.ts`) → `CognitoSessionOptions.verifyTokens` (`src/auth/session.ts`) — B1's own report flagged this wiring as an "INT MUST FIX" gap against `EvnexAuthOptions`/`EvnexConfig`; verified here that the facade wiring is now present, so the gap is closed. (It is *not* additionally wired into `EvnexConfig`/the env-var resolver — there is no `EVNEX_VERIFY_TOKENS` env var — but Python has no equivalent knob at all, so there is nothing to parallel there; the constructor option is sufficient to satisfy PLAN.md §3.4's requirement that it be reachable.) |
| Cognito `DEVICE_SRP_AUTH` challenge (device tracking) | `src/auth/cognito.ts`'s `toAuthResult` | ❌ omitted (justified) | Confirmed not implemented: `toAuthResult` detects the `DEVICE_SRP_AUTH` challenge name explicitly and throws a plain `EvnexAuthError` naming the limitation, rather than returning an opaque challenge object the caller has no way to answer (PLAN.md §3.4, §8 risk 2). |
| `asyncio.Lock` | `src/auth/mutex.ts` `Mutex` | ✅ ported | FIFO promise-chain lock with `runExclusive(fn)`; non-reentrant, matching `asyncio.Lock`'s deadlock-on-re-entry behaviour. |
| `asyncio.to_thread` wrappers throughout this module | — | ❌ omitted (justified) | No blocking-I/O-off-the-event-loop problem in Node; every wrapper collapses to a direct `await` (PLAN.md §2.3). Confirmed: every `asyncio.to_thread(closure)` call site in `auth.py` has a direct, un-thread-wrapped counterpart in `session.ts`/`account.ts`/`cognito.ts`. |

### Adjudication 1 — `publishTokens` / `changePassword` atomicity (ruled: not a defect)

**Question.** B1 exposed a lock-free `CognitoSession.publishTokens` so B2's
`changePassword` could capture token rotation under the same lock Python
uses (via `after=`). B2 did not use it, using a pre-check (`forceRefresh`
before `runUserPoolOp`) instead. Does this leave a real gap?

**Evidence.** Read `pycognito`'s actual source
(`pycognito_pkg/extracted/pycognito/__init__.py`):

```python
def change_password(self, previous_password, proposed_password):
    self.check_token()          # renew=True by default
    response = self.client.change_password(...)
    ...

def check_token(self, renew=True):
    ...
    if now > datetime.fromtimestamp(dec_access_token["exp"]):
        expired = True
        if renew:
            self.renew_access_token()
    ...
```

So Python's atomicity is real but incidental: `pycognito.Cognito.change_password`
calls `check_token(renew=True)` as its *first* line, which silently renews the
access token in place, mutating the shared `Cognito` object, if it has
(exactly) expired. `evnex/auth.py`'s `_change` closure then compares
`cognito.access_token` before/after the call to detect that mutation and
returns a `TokenSet` for `_run_user_pool_op`'s `after=_publish` hook to store —
all inside one lock acquisition, because the whole thing runs as one
`asyncio.to_thread` call under `self._lock`.

**Ruling.** A6's `CognitoAdapter.changePassword` has no such implicit,
in-place renewal — it is a stateless async function that calls
`ChangePasswordCommand` and nothing else. There is no hidden mutation for an
`after` hook to observe. B2's pre-check (read `session.tokens`, and if the
access token's own `expiresAt` is already `<=` now, call
`session.forceRefresh({staleAccessToken})` *before* starting
`runUserPoolOp`) reproduces the *effect* of `check_token(renew=True)` — a
locally-expired token gets renewed before the password-change call — using
two separate lock acquisitions instead of Python's one. Traced through the
consequences of that gap and found it non-observable:

- `forceRefresh`'s single-flight design (`staleAccessToken` comparison) means
  a second concurrent `changePassword` call that also decides to refresh will
  not double-refresh; it gets back the already-rotated tokens.
- `runUserPoolOp` always re-reads `this.getAccessToken()` at its own start
  (this is true for *every* account operation, not something B2 added), so
  the token actually used for the `ChangePasswordCommand` call is whatever is
  current at that moment, not a token captured before the pre-check ran. The
  rotated tokens are never "lost" — they are published by `forceRefresh`
  itself (which calls `publishTokens` internally) before `runUserPoolOp` ever
  starts.
- The only difference is *when within the sequence* a proactive renewal is
  published, not *whether* it is published, and not what access token
  ultimately reaches the Cognito API call.

**Conclusion: B2's pre-check is the correct port, not a shortfall.** The
integrator's provisional assessment is confirmed. `publishTokens` remains on
`CognitoSession` as public API surface with no current external caller
(harmless — it is the natural generalisation of what `forceRefresh` already
does internally) but nothing needs to change in `src/auth/account.ts`. No
defect recorded against this adjudication.

### Adjudication 2 — duplicated `openClient` (ruled: real divergence, not a correctness bug; leave for a simplify pass)

Confirmed: Python's `evnex/cli/_resources.py` defines exactly one
`open_client` async context manager, used by every command in that file
including `cmd_charge_now`/`cmd_charge_auto`/`cmd_charge_stop`. The plan
assigns the TS `openClient` to `src/cli/commands/resources.ts` (C3). C4 wrote
a second, structurally identical private copy in `src/cli/commands/charge.ts`
(compare the two: both are `signedInAuth(args)` → `new Evnex({ auth })` →
`{ client, close }`), because `resources.ts` was still in flight when C4's
work started and C4 declined to take a load-bearing dependency on an
unfinished sibling file.

This is real, harmless duplication (~10 lines), not a functional bug —
both copies behave identically and are each fully covered by their own
file's tests. It is a legitimate simplify-pass candidate (export `openClient`
from `resources.ts` and have `charge.ts` import it, or lift both into a
shared module) but is explicitly **not fixed here** per the D1 brief's
scope (`PARITY.md`-only ownership). Recorded below in "Defects found but not
fixed" for the integrator to dispatch.

### Adjudication 3 — `reset-password` prompt stream (ruled: deliberate, correct divergence — and broader than the brief described)

The Wave 4 brief states the divergence is specific to `reset-password`'s
code prompt. Reading `evnex/cli/_auth.py` and `evnex/cli/_resources.py` in
full surfaces that the same inconsistency exists in **four** places in
Python, not one — every place that calls bare `input(prompt_string)` (which
writes `prompt_string` to **stdout**) instead of the
`print(..., file=sys.stderr, flush=True)` + argument-less `input()` pattern
used everywhere else in the CLI:

| Location | Python | Writes prompt to |
|---|---|---|
| `cmd_reset_password` (`_auth.py`) | `code = input("Enter the reset code: ")` | stdout |
| `cmd_mfa_enable` (`_auth.py`) | `code = input("Enter a code from the new device: ")` | stdout |
| `cmd_mfa_disable` (`_auth.py`) | `answer = input("Disable MFA on this account? [y/N] ")` | stdout |
| `cmd_charge_stop` (`_resources.py`) | `answer = input(f"Stop the active charging session on {name}? [y/N] ")` | stdout |

All four are inconsistent with the module's own stated convention (the
`_auth.py` docstring: prompts go to stderr "so a `--json` command's stdout
stays valid JSON") and with every other prompt in the same files (which use
`print(..., file=sys.stderr)` immediately followed by a bare, prompt-less
`input()`).

The TS port unifies all four onto **stderr**, via `promptLine`/`promptConfirm`
(`src/cli/prompt.ts`), which write unconditionally to `process.stderr`:
`reset-password`'s code prompt and `mfa enable`'s device-code prompt both use
`promptLine`; `mfa disable`'s and `charge stop`'s confirmations both use
`promptConfirm`. This is recorded as `🔄 adapted` at each of the four
corresponding rows above/below, not just the one the brief named — the
reasoning is identical in all four cases: consistency with the rest of the
CLI's own documented stdout/stderr discipline, and protecting the stdout
purity every `--json` test in this suite depends on.

## `evnex/schema/charge_points.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `ChargingLogic` | `src/schema/chargePoints.ts` `ChargingLogic` | ✅ ported | All 5 members verified. |
| `ChargingCurrentControl` | `src/schema/chargePoints.ts` `ChargingCurrentControl` | ✅ ported | All 8 members verified. |
| `E2LEDState` | `src/schema/chargePoints.ts` `E2LEDState` | ✅ ported | All 11 members verified. |
| `AntiSleepState` | `src/schema/chargePoints.ts` `AntiSleepState` | ✅ ported | All 4 members verified. |
| `ChargePointStatus` | `src/schema/chargePoints.ts` `ChargePointStatus` | ✅ ported | All 5 fields required in both. |
| `EvnexChargePointConnectorMeter` | `src/schema/chargePoints.ts` `EvnexChargePointConnectorMeter` | ✅ ported | `register` (wire) → `rawRegister` via `.transform()` (PLAN.md §2.1). All 5 fields required in both. |
| `Coordinates` | `src/schema/chargePoints.ts` `Coordinates` | ✅ ported | |
| `EvnexAddress` | `src/schema/chargePoints.ts` `EvnexAddress` | ✅ ported | `address1`/`country` required, `address2`/`address3`/`city`/`postCode`/`state` optional — verified field-for-field. |
| `EvnexLocation` (v2) | `src/schema/chargePoints.ts` `EvnexLocation` (re-exported as `EvnexChargePointLocation` from `src/index.ts`) | ✅ ported | Name collides with `evnex/schema/v3/locations.py`'s `EvnexLocation` — F0 aliased the barrel export, v3 keeping the unqualified name (it is what the current, non-deprecated methods return). `address`/`coordinates` optional, everything else required — verified. |
| `EvnexChargePointConnector` | `src/schema/chargePoints.ts` `EvnexChargePointConnector` | ✅ ported | Only `meter` optional; all 10 other fields required — verified. |
| `EvnexChargePointDetails` | `src/schema/chargePoints.ts` `EvnexChargePointDetails` | ✅ ported | Only `iccid` optional. |
| `EvnexChargePointSolarConfig` | `src/schema/chargePoints.ts` `EvnexChargePointSolarConfig` | ✅ ported | All 4 fields required in both. |
| `EvnexChargePointOverrideConfig` | `src/schema/chargePoints.ts` `EvnexChargePointOverrideConfig` | ✅ ported | `bool \| Literal["NotSupported"]` → `z.union([z.boolean(), z.literal("NotSupported")])`, required in both. |
| `EvnexChargePointStatus` | `src/schema/chargePoints.ts` `EvnexChargePointStatus` | ✅ ported | Only `chargePointStatus` optional. |
| `EvnexChargePointStatusResponse` | `src/schema/chargePoints.ts` `EvnexChargePointStatusResponse` | ✅ ported | |
| `EvnexChargePointEnergyMeterReading` | `src/schema/chargePoints.ts` `EvnexChargePointEnergyMeterReading` | ✅ ported | All 3 fields required in both — no optionality anywhere, unlike the v3 connector meter's `supplyActivePower`. |
| `EvnexChargePointEnergyMeterReadingResponse` | `src/schema/chargePoints.ts` `EvnexChargePointEnergyMeterReadingResponse` | ✅ ported | |
| `EvnexChargePointBase` | `src/schema/chargePoints.ts` `EvnexChargePointBase` | ✅ ported | All 9 fields required in both. |
| `EvnexChargePoint` | `src/schema/chargePoints.ts` `EvnexChargePoint` | ✅ ported | Only `connectors`/`lastHeard` optional; `maxCurrent`/`tokenRequired`/`needsRegistrationInformation` required — verified. |
| `EvnexGetChargePointsItem` | `src/schema/chargePoints.ts` `EvnexGetChargePointsItem` | ✅ ported | |
| `EvnexGetChargePointsResponse` | `src/schema/chargePoints.ts` `EvnexGetChargePointsResponse` | ✅ ported | |
| `EvnexElectricityCostSegment` | `src/schema/chargePoints.ts` `EvnexElectricityCostSegment` | ✅ ported | |
| `EvnexChargeProfileSegment` | `src/schema/chargePoints.ts` `EvnexChargeProfileSegment` | ✅ ported | |
| `EvnexElectricityCost` (v2) | `src/schema/chargePoints.ts` `EvnexElectricityCost` (re-exported as `EvnexElectricityCostBrief`) | ✅ ported | Name collides with `evnex/schema/v3/cost.py`'s `EvnexElectricityCost` — F0 aliased the barrel export. Only `duration` optional. |
| `EvnexChargePointConfiguration` | `src/schema/chargePoints.ts` `EvnexChargePointConfiguration` | ✅ ported | Both fields required in both — this is the model with **no live fixture corroboration** (see the risk note under `EvnexChargePointDetail` below); the port has not "tightened" or "loosened" it relative to Python, it is simply unverified against a real response either way. |
| `EvnexChargePointLoadSchedule` | `src/schema/chargePoints.ts` `EvnexChargePointLoadSchedule` | 🔄 adapted | **`timezone` is `.nullish()` in the port, `str` (required, no default) in Python** — confirmed by direct read of `evnex/schema/charge_points.py` line 198: `timezone: str`. This is the §10.1 upstream bug: the live API omits `timezone` from every load-schedule response, so unmodified Python raises `ValidationError` on `get_charge_point_detail`, `set_charger_load_profile`, and `set_charge_point_schedule` — all three real, working endpoints, broken upstream. The port's divergence is deliberate and is the fix, not a bug to "restore." Confirmed corroborating evidence in `api.py`: `set_charge_point_schedule` builds its request body with `# "timezone": timezone` commented out. |
| `EvnexChargePointDetail` (v2) | `src/schema/chargePoints.ts` `EvnexChargePointDetail` | ✅ ported | **⚠ No live fixture in either project** (confirmed absent from `tests/test_cli_resources.py`, `tests/test_auth.py`, `tests/test_schema.py` upstream, and from `test/support/fixtures.ts` here — grepped directly, only one non-fixture reference exists in `test/index.test.ts`, a barrel-export existence check). `configuration`, `electricityCost`, `loadSchedule`, and `connectors` (a plain, non-optional `list[EvnexChargePointConnector]`, unlike `EvnexChargePoint`'s optional `connectors`) are all required with no default in Python, and the port preserves that requiredness exactly, field for field — it has not silently loosened anything to compensate for the missing fixture. Same profile as the confirmed §10.1 bug; this endpoint is deprecated upstream in favour of v3 so may simply never be exercised against a live response again, but if it still works at all, a schema mismatch here would surface exactly like §10.1 did. **D5 should capture this endpoint live if reachable at all.** |
| `EvnexGetChargePointDetailResponse` | `src/schema/chargePoints.ts` `EvnexGetChargePointDetailResponse` | ✅ ported | |
| `EvnexChargePointTransaction` | `src/schema/chargePoints.ts` `EvnexChargePointTransaction` | ✅ ported | `endDate`/`reason`/`carbonOffset`/`electricityCost` optional, `startDate` required — verified field-for-field, including that `startDate` (unlike `endDate`) has no default in Python either. |
| `EvnexChargePointTransactions` | `src/schema/chargePoints.ts` `EvnexChargePointTransactions` | ✅ ported | |
| `EvnexGetChargePointTransactionsResponse` | `src/schema/chargePoints.ts` `EvnexGetChargePointTransactionsResponse` | ✅ ported | |

## `evnex/schema/commands.py`, `cost.py`, `org.py`, `user.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `EvnexCommandResponse` (v2) | `src/schema/commands.ts` `EvnexCommandResponse` | ✅ ported | Both fields required in both. |
| `EvnexCost` | `src/schema/cost.ts` `EvnexCost` | ✅ ported | Both fields optional in both. |
| `EvnexOrgBrief` | `src/schema/org.ts` `EvnexOrgBrief` | ✅ ported | `tierDetails: Any = None` → `z.unknown().nullish()`; `namespacePrefix` optional; all 7 other fields required — verified. |
| `EvnexOrgInsightEntry` | `src/schema/org.ts` `EvnexOrgInsightEntry` | ✅ ported | Only `carbonUsage` optional; `cost` (nested `EvnexCost`) itself required — verified. |
| `EvnexInsightAttributeWrapper` | `src/schema/org.ts` `EvnexInsightAttributeWrapper` | ✅ ported | |
| `EvnexOrgSummaryStatus` | `src/schema/org.ts` `EvnexOrgSummaryStatus` | ✅ ported | All 7 fields required in both. |
| `EvnexGetOrgInsights` | `src/schema/org.ts` `EvnexGetOrgInsights` | ✅ ported | |
| `EvnexGetOrgSummaryStatusResponse` | `src/schema/org.ts` `EvnexGetOrgSummaryStatusResponse` | ✅ ported | |
| `EvnexUserDetail` | `src/schema/user.ts` `EvnexUserDetail` | ✅ ported | `id: UUID` → `z.uuid()` (kept as `string`, per PLAN.md §2.2); `name` optional (API omits it for accounts with none set — regression-tested); `type: Literal["User","Installer"] = "User"` → `z.enum([...]).default("User")`. |
| `EvnexGetUserResponse` | `src/schema/user.ts` `EvnexGetUserResponse` | ✅ ported | |

## `evnex/schema/v3/*.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `EvnexV3Include` | `src/schema/v3/generic.ts` `EvnexV3Include` | ✅ ported | `attributes: dict` → `z.record(z.string(), z.unknown())`, both effectively open maps. |
| `EvnexV3Data[T]` | `src/schema/v3/generic.ts` (inlined into `evnexV3ApiResponse`'s `data` field) | ✅ ported | `relationships` required (no default) in both. |
| `EvnexV3APIResponse[T]` | `src/schema/v3/generic.ts` `evnexV3ApiResponse` (factory) + `EvnexV3APIResponse<T>` (type) | 🔄 adapted | `Generic[T]` → factory function, per PLAN.md §5 A4. **Requiredness finding (new — not previously documented by any agent):** Python's `included: list[EvnexV3Include] \| None` has **no `= None` default**. Under Pydantic v2 semantics (unlike v1), an `Optional[X]`-typed field with no explicit default is **required** — the key must be present in the payload, though its value may be `null`. Confirmed by grepping the whole `evnex/` tree for the `X | None` (no `=`) pattern in model bodies: this is the *only* field in any schema file with this shape. The port's `included: z.array(EvnexV3Include).nullish()` is **optional and nullable** — it accepts the key being entirely absent, which Python would reject with a `ValidationError`. This makes the TS schema strictly *more lenient* than Python here, not less — the opposite direction from the §10.1 bug. Not observed to cause a practical problem (every real v3 response the test fixtures and live-verified findings in PLAN.md §10 describe does include an `included` key, if only as `null` or `[]`), and the extra leniency is arguably safer given the API's history of undocumented shape drift (PLAN.md §2.2's rationale for never using `.strict()`), but it was not a *deliberate, documented* choice by A4 the way §10.1's `timezone` was — it appears to be an oversight of the v1-vs-v2 "Optional implies default" rule change, not a decision. Recorded in "Defects found but not fixed" below. |
| `EvnexRelationship` | `src/schema/v3/relationships.ts` `EvnexRelationship` | ✅ ported | Both fields required in both. |
| `EvnexRelationshipWrapper` | `src/schema/v3/relationships.ts` `EvnexRelationshipWrapper` | ✅ ported | `data: EvnexRelationship \| None = None` → `.nullish()` (has an explicit default in Python, so genuinely optional — unlike `included` above). |
| `EvnexRelationships` | `src/schema/v3/relationships.ts` `EvnexRelationships` | ✅ ported | All 3 fields optional (`= None`) in both. |
| `EvnexElectricityTariff` | `src/schema/v3/cost.ts` `EvnexElectricityTariff` | ✅ ported | All 3 fields required in both. |
| `EvnexElectricityCost` (v3) | `src/schema/v3/cost.ts` `EvnexElectricityCost` (re-exported as `EvnexElectricityCostV3`) | ✅ ported | Only `cost` optional; `currency`/`tariffs`/`tariffType` required — verified (a genuinely different requiredness profile from the v2 `EvnexElectricityCost`, which is correct: they are different endpoints' shapes). |
| `EvnexElectricityCostTotal` | `src/schema/v3/cost.ts` `EvnexElectricityCostTotal` | ✅ ported | `distribution: Any = None` → `z.unknown().nullish()`. |
| `EvnexEnergyTransaction` | `src/schema/v3/chargePoints.ts` `EvnexEnergyTransaction` | ✅ ported | Only `meterStart`/`startDate` required; `meterStop`/`endDate`/`reason` optional — verified. `meterStop`'s absence-means-still-charging semantics (PLAN.md §10.3) preserved exactly. |
| `EvnexEnergyUsage` | `src/schema/v3/chargePoints.ts` `EvnexEnergyUsage` | ✅ ported | |
| `EvnexChargeSchedulePeriod` | `src/schema/v3/chargePoints.ts` `EvnexChargeSchedulePeriod` | ✅ ported | |
| `EvnexChargeSchedule` | `src/schema/v3/chargePoints.ts` `EvnexChargeSchedule` | ✅ ported | |
| `EvnexChargeProfile` | `src/schema/v3/chargePoints.ts` `EvnexChargeProfile` | ✅ ported | `chargeSchedule` optional in both. |
| `EvnexChargePointFeature` | `src/schema/v3/chargePoints.ts` `EvnexChargePointFeature` | ✅ ported | |
| `EvnexChargePointFeatures` | `src/schema/v3/chargePoints.ts` `EvnexChargePointFeatures` | ✅ ported | All 3 fields required in both. |
| `EvnexChargePointConnectorMeter` (v3) | `src/schema/v3/chargePoints.ts` `EvnexChargePointConnectorMeter` (re-exported as `EvnexChargePointConnectorMeterV3`) | ✅ ported | `register` → `rawRegister`. `supplyActivePower` optional in both — presence-vs-zero meaningfully distinct (PLAN.md §5 A4, §10.3), preserved by keeping it `.nullish()` rather than defaulting to `0`. |
| `EvnexChargePointConnector` (v3) | `src/schema/v3/chargePoints.ts` `EvnexChargePointConnector` (re-exported as `EvnexChargePointConnectorV3`) | ✅ ported | Only `meter` optional; `maxVoltage`/`maxAmperage` (absent from the v2 connector) both required — verified. |
| `EvnexChargePointConnectionConfiguration` | `src/schema/v3/chargePoints.ts` `EvnexChargePointConnectionConfiguration` | ✅ ported | All 4 fields required in both. |
| `EvnexChargePointDetail` (v3) | `src/schema/v3/chargePoints.ts` `EvnexChargePointDetail` (re-exported as `EvnexChargePointDetailV3`) | ✅ ported | `timeZone` is authoritative here (required, no default) and absent from the list endpoint (PLAN.md §10.2) — confirmed required in both. `connectionConfiguration`/`features`/`iccid`/`isSolarEnabled` optional, everything else required — verified field-for-field against all 20 fields. |
| `EvnexChargePointSessionAttributes` | `src/schema/v3/chargePoints.ts` `EvnexChargePointSessionAttributes` | ✅ ported | **Every one of the 17 fields is optional in Python** (`= None` on all of them, including `startDate`/`sessionStatus`, per PLAN.md §10.3's explicit warning against "tightening" them) — confirmed the port matches exactly: every field is `.nullish()`, none tightened to required. |
| `EvnexChargePointSession` | `src/schema/v3/chargePoints.ts` `EvnexChargePointSession` | ✅ ported | `attributes`/`id`/`type` required, `relationships` optional — verified. |
| `EvnexGetChargePointSessionsResponse` | `src/schema/v3/chargePoints.ts` `EvnexGetChargePointSessionsResponse` | ✅ ported | |
| (n/a — TS-only) | `sessionEnergyWh` | 🔄 adapted (addition) | Pure addition: meter-delta energy helper (PLAN.md §10.3). Correctly tests for `meterStop`/transaction *presence* (`=== undefined`), never truthiness, and returns `null` (not `0`, not throwing) while a session is still active — verified against the function body. |
| (n/a — TS-only) | `OBSERVED_SESSION_STATUSES` | 🔄 adapted (addition) | Pure addition: documents the 6 observed `sessionStatus` values (PLAN.md §10.4) as a `const` tuple; the parsed field type stays `string` (never narrowed/tightened), matching the "an unobserved value must not throw" requirement. |
| `EvnexLocationAddress` | `src/schema/v3/locations.ts` `EvnexLocationAddress` | ✅ ported | All 6 fields optional in both (note: unlike the v2 `EvnexAddress`, even `address1`/`country` are optional here — a genuinely different, looser v3 shape, correctly preserved as such). |
| `EvnexLocationCoordinates` | `src/schema/v3/locations.ts` `EvnexLocationCoordinates` | ✅ ported | Both fields optional **and typed as `str`**, not `float` — confirmed the port keeps `z.string().nullish()` for `latitude`/`longitude` rather than "correcting" them to numbers, matching Python's (odd but real) `str \| None` typing. |
| `EvnexLocationIcpDetails` | `src/schema/v3/locations.ts` `EvnexLocationIcpDetails` | ✅ ported | |
| `EvnexLocationAttributes` | `src/schema/v3/locations.ts` `EvnexLocationAttributes` | ✅ ported | Only `name` required; all 8 other fields optional — verified. |
| `EvnexLocationChargePointRef` | `src/schema/v3/locations.ts` `EvnexLocationChargePointRef` | ✅ ported | |
| `EvnexLocationChargePoints` | `src/schema/v3/locations.ts` `EvnexLocationChargePoints` | ✅ ported | `Field(default_factory=list)` → `.default([])`. |
| `EvnexLocationRelationships` | `src/schema/v3/locations.ts` `EvnexLocationRelationships` | ✅ ported | `Field(default_factory=EvnexLocationChargePoints)` → `.default({ data: [] })`. |
| `EvnexLocation` (v3) | `src/schema/v3/locations.ts` `EvnexLocation` | ✅ ported | Kept unaliased at the `src/index.ts` barrel — see the v2 `EvnexLocation` collision note above. `relationships` defaults, `attributes` required, `id`/`type` required — verified. |
| `EvnexGetLocationsResponse` | `src/schema/v3/locations.ts` `EvnexGetLocationsResponse` | ✅ ported | |
| `EvnexOrgConnectorSummaryAttributes` | `src/schema/v3/org.ts` `EvnexOrgConnectorSummaryAttributes` | ✅ ported | |
| `EvnexOrgConnectorSummaryData` | `src/schema/v3/org.ts` `EvnexOrgConnectorSummaryData` | ✅ ported | |
| `EvnexGetOrgConnectorSummaryResponse` | `src/schema/v3/org.ts` `EvnexGetOrgConnectorSummaryResponse` | ✅ ported | |
| `EvnexCommandResponse` (v3) | `src/schema/v3/commands.ts` `EvnexCommandResponse` (re-exported as `EvnexCommandResponseV3`) | ✅ ported | See the v2 collision note above. |
| (n/a — TS-only, shared) | `src/schema/json.ts` `toJson` | ✅ ported | Analogue of `model_dump(mode="json")`, shared across every CLI `--json` path (PLAN.md §2.6). `Date` → ISO string with the whole-second `.000Z` suffix stripped (matching pydantic's rendering of a zero-microsecond datetime); `undefined` object keys dropped, `undefined` array elements kept (asymmetry pinned by A3's own tests); `null` preserved. |

## `evnex/cli/__init__.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `build_parser` | `src/cli/parser.ts` `buildParser` | ✅ ported | argparse tree → in-house `Command` tree + `parseArgs`-based router (PLAN.md §0, §5 C1). `--version` root-only, `-h`/`--help` at every level, `strict: true` rejecting unknown options — all verified against argparse's equivalent behaviour. |
| `main` | `src/cli/index.ts` `main` | ✅ ported | Confirmed all four Python `except` clauses have a TS counterpart with matching message text and exit code: `EvnexAuthError` → `"Authentication error: {msg}"` / exit 1; `httpx.HTTPError` (covers both `HTTPStatusError` and `ReadTimeout`, since `ReadTimeout` is-a `HTTPError` in httpx's hierarchy) → `EvnexHttpError`/`EvnexTimeoutError` → `"API request failed: {msg}"` / exit 1; `pydantic.ValidationError` → `EvnexValidationError` → the fixed "try upgrading evnex" message / exit 1; `KeyboardInterrupt` → `SIGINT` handler → exit 130. Anything else propagates uncaught in both — Python's `main` only narrows those four `except` clauses. |

## `evnex/cli/_auth.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `DEFAULT_CACHE` / `_default_cache` | `src/cli/tokenCache.ts` `defaultTokenCachePath` | ✅ ported | ⚠ `cli/_auth.py` is 52% covered upstream (PLAN.md §6.3). `$XDG_CACHE_HOME/evnex/tokens.json` (falling back to `~/.cache`), overridable via `EVNEX_TOKEN_CACHE` — verified identical precedence. |
| `_save_tokens_factory` | `src/cli/tokenCache.ts` `createTokenSaver` | ✅ ported | 0600 permission pinning verified: both explicitly `chmod`/`fchmod` after open, because a plain write leaves a pre-existing file's mode untouched — untested upstream, original test coverage here (PLAN.md §6.3). |
| `_load_tokens` | `src/cli/tokenCache.ts` `loadTokens` | 🔄 adapted | Python only catches `(ValueError, KeyError)` around the read+parse (a permission-denied read propagates uncaught); the port folds *every* "could not use this cache file" outcome — including read errors beyond ENOENT/EISDIR — into the same stderr-warn-and-ignore path, on the reasoning that a token cache is always disposable. Deliberate broadening, documented inline in `tokenCache.ts`'s own module docstring. |
| `_challenge_code` | `src/cli/otp.ts` `resolveChallengeCode` | ✅ ported | `--otp` single-use (cleared after read), `--otp-command` shells out via `node:child_process` `exec` (the `asyncio.create_subprocess_shell` analogue), trims stdout, relays stderr only on failure — verified against all four Python branches (`args.otp`, `args.otp_command` success/failure/empty-output, bare prompt). |
| `signed_in_auth` | `src/cli/commands/auth.ts` `signedInAuth` | ✅ ported | Cache load → `getAccessToken()` → on `ReauthenticationRequiredError` fall back to interactive sign-in, looping challenges via `resolveChallengeCode` until a `TokenSet` returns — verified line-for-line. |
| `show_qr` | `src/cli/qr.ts` `showQr` | ✅ ported | Optional peer `qrcode`; missing install degrades to a stderr note and printing nothing further (Python: `except ImportError`, TS: a dynamic `import()` rejection check for `ERR_MODULE_NOT_FOUND`). `$XDG_RUNTIME_DIR` preference, 0600 SVG, "contains your MFA secret" warning all verified. One unverified minor divergence: Python's `qr.print_ascii(tty=sys.stdout.isatty())` conditions the terminal-QR rendering mode on whether stdout is a TTY; the TS port always calls `qrcode.toString(uri, { type: "terminal", small: true })` regardless of `process.stdout.isTTY`. Both write to stdout either way; whether the *rendered glyphs* differ when piped is not verified either direction — flagged under "Uncertain" below, not claimed as a bug. |
| `_enrollment_account` | `enrollmentAccountName` (internal to `src/cli/commands/auth.ts`) | ✅ ported | `EVNEX_CLIENT_USERNAME` env var, falling back to `"evnex-account"`. |
| `_print_enrollment` | `printEnrollment` (internal to `src/cli/commands/auth.ts`) | ✅ ported | |
| `cmd_login` | `createAuthCommand`'s `login` handler (`runLogin`) | ✅ ported | |
| `cmd_logout` | `createAuthCommand`'s `logout` handler (`runLogout`) / `src/cli/tokenCache.ts` `removeTokenCache` | ✅ ported | |
| `cmd_status` | `createAuthCommand`'s `status` handler (`runStatus`) | ✅ ported | Unverified-JWT-claim decode of the id token (`email` / `cognito:username` / `"unknown"` fallback chain) verified identical. |
| `cmd_change_password` | `createAuthCommand`'s `change-password` handler (`runChangePassword`) | ✅ ported | Mismatched-confirmation abort message and exit code (1) verified identical. |
| `cmd_reset_password` | `createAuthCommand`'s `reset-password` handler (`runResetPassword`) | 🔄 adapted | See "Adjudication 3" above — the reset-code prompt is stderr in the port, stdout (via bare `input(prompt)`) in Python; deliberate, and one of four such occurrences, not the only one. |
| `cmd_mfa_enable` | `createAuthCommand`'s `mfa enable` handler (`runMfaEnable`) | 🔄 adapted | Same stdout→stderr prompt-stream unification as `reset-password` — see Adjudication 3 (`input("Enter a code from the new device: ")` is Python's second stdout-prompt occurrence). |
| `cmd_mfa_disable` | `createAuthCommand`'s `mfa disable` handler (`runMfaDisable`) | 🔄 adapted | Same stdout→stderr prompt-stream unification — see Adjudication 3 (`input("Disable MFA on this account? [y/N] ")` is Python's third occurrence). |
| `cmd_mfa_enroll` | `createAuthCommand`'s `mfa enroll` handler (`runMfaEnroll`) | ✅ ported | No interactive prompt of its own (prints instructions only), so no stream divergence here. |
| `cmd_mfa_confirm` | `createAuthCommand`'s `mfa confirm` handler (`runMfaConfirm`) | ✅ ported | `--no-prefer` → plain boolean flag `no-prefer`, inverted in the handler (`parseArgs` has no negated-flag/`store_false` support, PLAN.md §5 C1) — verified `prefer = !boolFlag(args, "noPrefer")` matches `dest="prefer", action="store_false"`. |
| `add_auth_commands` | `src/cli/commands/auth.ts` `createAuthCommand` | ✅ ported | Flag-group attachment per subcommand (`cache_flags`/`otp_flags` present/absent) verified against every one of the 10 Python subparsers; `reset-password` has neither group in either language. |

## `evnex/cli/_resources.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `_positive_int` | `limitFlag`'s `validate` hook (`src/cli/commands/resources.ts`) | ✅ ported | |
| `_abort` | `abort` (`src/cli/resolve.ts`, module-private) — also inlined at other exit-2/exit-1 sites | ✅ ported | stderr + `process.exit(code)`, matching `print(..., file=sys.stderr); sys.exit(code)`. |
| `open_client` | `src/cli/commands/resources.ts` `openClient` **and** a second, private copy in `src/cli/commands/charge.ts` | 🔄 adapted | Python has exactly one `open_client`. See "Adjudication 2" above — duplicated in the port, not fixed here, recorded below for the integrator. `asynccontextmanager` → explicit `{ client, close }` pair; caller `try`/`finally`s — the shape of the port matches Python's cleanup guarantee in both copies, only the *file* count differs. |
| `_list_charge_points` | `listChargePoints` (module-private, duplicated the same way as `openClient` — once in `resources.ts`, once in `charge.ts`) | ✅ ported | `getUserDetail()` then `getOrgChargePoints()`, matching. |
| `_match_charge_point` | `src/cli/resolve.ts` `matchChargePoint` | ✅ ported | Exact-id-first, then case-insensitive substring match against name **or** serial, zero/multiple-match → exit 2 with candidates listed — verified line-for-line. One unverified minor divergence: Python's `str.casefold()` is a more aggressive Unicode case-fold than TS's `String.prototype.toLowerCase()` (e.g. German `ß`↔`ss`); for the ASCII charge-point names/serials this API is expected to return, the two are equivalent, but this was not exhaustively verified for arbitrary Unicode input — flagged under "Uncertain" below. |
| `_resolve_one` | `src/cli/resolve.ts` `resolveOne` | ✅ ported | Selector given → delegate to `matchChargePoint`; else sole charge point if exactly one; else exit 2 listing all — verified. |
| `_kw` | `src/cli/format.ts` `kW` | ✅ ported | `None`/`undefined` → `"-"`, else `"{:.2f} kW"` / `.toFixed(2) + " kW"` — verified. |
| `_kwh` | `src/cli/format.ts` `kWh` | ✅ ported | Same shape as `_kw`. |
| `_fmt_dt` | `src/cli/format.ts` `formatDateTime` | ✅ ported | Must use `Intl.DateTimeFormat.formatToParts()` + `hourCycle: "h23"` (PLAN.md §10.8), not `.format()` (locale-ordered, 12-hour default) or `.toISOString().slice(...)` (reads the UTC day) — confirmed `formatDateTime` uses `formatToParts` with an explicit `hourCycle: "h23"` and a manually-computed `±HH:MM` offset via `getTimezoneOffset()`, matching Python's `value.astimezone().replace(microsecond=0).isoformat()` host-zone formatting. |
| `_fmt_period` | `src/cli/format.ts` `formatPeriod` | ✅ ported | `int(seconds) // 60` (truncate-then-floor-divide) → `Math.floor(Math.trunc(seconds) / 60)` — verified equivalent for both positive and (theoretically) negative inputs. |
| `_print_table` | `src/cli/format.ts` `printTable` | ✅ ported | Column-width padding + two-space join verified identical. |
| `_latest_session` | `latestSession` (module-private, `resources.ts`) | ✅ ported | |
| `_newest_first` | `newestFirst` (module-private, `resources.ts`) | ✅ ported | Sessions sorted newest-first (API documents no ordering); a session with no `startDate` sorts last in both (`datetime.min` sentinel in Python, `Number.NEGATIVE_INFINITY` in TS). |
| `cmd_live_status` | `createResourceCommands`'s `status` handler (`cmdLiveStatus`) | ✅ ported | Active-session summary line (only shown when `endDate` is absent), connector power lines (only when `meter` present, grid power only when `supplyActivePower` present) all verified against the Python conditionals. |
| `cmd_charge_points_list` | `createResourceCommands`'s `charge-points list` handler (`cmdChargePointsList`) | ✅ ported | |
| `cmd_charge_points_show` | `createResourceCommands`'s `charge-points show` handler (`cmdChargePointsShow`) | ✅ ported | |
| `cmd_sessions_list` | `createResourceCommands`'s `sessions list` handler (`cmdSessionsList`) | ✅ ported | `--limit` default 10, positive-integer validated. |
| `cmd_locations_list` | `createResourceCommands`'s `locations list` handler (`cmdLocationsList`) | ✅ ported | |
| `cmd_insights` | `createResourceCommands`'s `insights` handler (`cmdInsights`) | ✅ ported | `--days` choices `{7,14,30}` default 7; date column formats in **UTC**, deliberately not the host zone (Python's `entry.startDate.strftime("%Y-%m-%d")` never calls `.astimezone()`) — the port's `formatUtcDate` matches by slicing `toISOString()` rather than reusing `formatDateTime`. Cost fallback `entry.cost.currency or ''` (falsy) vs. the port's `?? ""` (nullish) is a distinction without a difference given the schema only ever yields `null`/`undefined`/non-empty string for `currency`. |
| `cmd_charge_now` | `src/cli/commands/charge.ts` `createChargeCommand`'s `now` handler (`chargeNowCommand`) | ✅ ported | |
| `cmd_charge_auto` | `createChargeCommand`'s `auto` handler (`chargeAutoCommand`) | ✅ ported | |
| `cmd_charge_stop` | `createChargeCommand`'s `stop` handler (`chargeStopCommand`) | 🔄 adapted | `EvnexTimeoutError` → "No active charging session on X to stop." + exit 1, verified (catches specifically `EvnexTimeoutError`, rethrows anything else — a dedicated non-timeout test proves the catch is not over-broad). **Also** the confirmation prompt stream — see "Adjudication 3": Python's `input(f"Stop the active charging session on {name}? [y/N] ")` writes to stdout; the port's `promptConfirm` writes to stderr, the fourth of the four unified occurrences. |
| `cmd_schedule_show` | `createResourceCommands`'s `schedule show` handler (`cmdScheduleShow`) | ✅ ported | `None`/absent schedule → JSON `null` in both (`json.dumps(None)` / `writeJson(schedule ?? null)`); human output "No charge schedule configured for X" verified. `period.limit:g` (Python's general-format float, e.g. `32` not `32.0`) vs. the port's plain `${period.limit}` (`String(number)`, e.g. also `32`) is identical output over the realistic amp-limit domain this API returns (whole or simple decimal numbers); not verified against `%g`'s scientific-notation threshold at extreme magnitudes, which this domain never reaches. |
| `add_resource_commands` | `src/cli/commands/resources.ts` `createResourceCommands` + `src/cli/commands/charge.ts` `createChargeCommand` | 🔄 adapted | All 6 top-level command groups and their flag-group attachments verified present and correctly scoped (`status` gets `cp_flag`+`json_flag`+sign-in; `charge-points`/`sessions`/`locations`/`schedule` are groups with a `list`/`show` leaf; `insights` and `charge {now,auto,stop}` verified). **Cosmetic-only divergence:** Python's top-level command order (from `build_parser`'s `add_auth_commands` then `add_resource_commands`) is `auth, status, charge-points, sessions, locations, insights, charge, schedule`; the port's `defaultTopLevelCommands()` (`src/cli/parser.ts`) produces `auth, status, charge-points, sessions, locations, insights, schedule, charge` — `charge` is appended last rather than interleaved before `schedule`. This only affects the order commands are listed in top-level `--help` output, not routing or any tested behaviour; deliberate, to avoid `parser.ts` hardcoding `resources.ts`'s array layout (see the circular-import note in `parser.ts`). |
| `cp_flag`'s help text ("...of its name or serial of its name or serial") | `chargePointFlag` (`src/cli/parser.ts`) | 🔄 adapted | Confirmed upstream typo: `evnex/cli/_resources.py` line 421, the shared `--charge-point` flag's help text repeats itself verbatim. Corrected in the port to "charge point id, or a part of its name or serial", with an inline comment recording the deviation. |
| `charge-points show`'s positional help text (same typo, second occurrence) | the `id` positional on the `charge-points show` command (`src/cli/commands/resources.ts`) | 🔄 adapted | Confirmed the **same** typo appears a second, independent time at line 460 (`cp_show.add_argument("charge_point", ...)`), not shared code with `cp_flag`'s copy — both instances corrected in the port. Both should be folded into one upstream bug report. |

## `tests/**`

Test-by-test mapping is **D2**'s `test/PARITY.md`, not this file (PLAN.md §6.2).

---

## Defects found but not fixed

Per the D1 brief, this audit does not modify any file outside `PARITY.md`.
Everything below is a real, verified finding left for the integrator to
dispatch.

1. **`src/schema/v3/generic.ts` — `EvnexV3APIResponse.included` is more
   lenient than Python.** Python's `included: list[EvnexV3Include] | None`
   has no default, so under Pydantic v2 semantics it is a *required* key
   (nullable, but must be present). The port's `z.array(EvnexV3Include).nullish()`
   also accepts the key being entirely *absent*. Not observed to cause a
   real-world problem, and arguably a safer direction to err in given the
   API's history of shape drift — but it does not appear to have been a
   deliberate decision (no comment, no PARITY row, no agent report
   mentions it), unlike the structurally similar §10.1 `timezone` field.
   Low priority: either add a one-line comment recording it as an
   intentional extra-tolerance choice, or tighten it to `.nullable()`
   (present-but-maybe-null, matching Python exactly) if a reviewer prefers
   exact requiredness parity. D5's live sweep should include at least one
   v3 response's `included` key in whatever it captures, to settle whether
   the real API ever omits it.

2. **`src/cli/commands/charge.ts` duplicates `src/cli/commands/resources.ts`'s
   `openClient`/`listChargePoints`.** Python has one `open_client`. Harmless
   (both copies are correct and independently tested) but a real duplication
   — see Adjudication 2 above. Candidate for a simplify pass: export
   `openClient`/`listChargePoints` from `resources.ts` and import them in
   `charge.ts`, or lift both into a small shared module neither file owns
   exclusively.

3. **`src/cli/qr.ts`'s `showQr` does not condition terminal-QR rendering
   on TTY-ness.** Python's `qr.print_ascii(tty=sys.stdout.isatty())` selects
   a rendering mode based on whether stdout is a terminal; the port always
   renders the same way regardless of `process.stdout.isTTY`. Not verified
   whether this produces observably different output when `evnex auth mfa
   enable`'s output is piped rather than viewed in a terminal — flagged as
   uncertain, not confirmed as a behavioural difference. Low priority given
   this is a one-shot interactive-enrollment code path.

None of the above rise to "wave gate failure" severity — no undocumented
omission was found (every `❌ omitted` row above has a justification), and
the one genuinely new requiredness gap (#1) makes the port *more* forgiving
of the live API than Python, not less, which is the safer direction to be
wrong in for a schema whose exact upstream contract this audit could not
independently re-verify against a live account.
