# PARITY.md

Symbol-by-symbol port audit: one row per public (and load-bearing private,
where a later wave's brief names it explicitly) symbol in `python-evnex`
@ 0.7.0. Populated by **F0** as a skeleton — every row starts `⬜ not started`.
**D1** (Wave 4) walks `evnex/**.py` directly against this table, corrects any
symbol F0 missed, and fills in real status/notes as each port lands.

Status legend: ✅ ported · 🔄 adapted (deliberate behavioural difference,
noted) · ❌ omitted (justified) · ⬜ not started.

Parity target: **python-evnex 0.7.0**. This package's own version starts at
`0.1.0` rather than mirroring `0.7.0`, to avoid implying a shared release
history (PLAN.md §0, open decision 1).

---

## `evnex/__init__.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| module-level `NullHandler` logging setup | — (no analogue; Node has no stdlib logging module) | ⬜ not started | Library convention differs; consider whether `src/index.ts` needs an equivalent no-op |

## `evnex/config.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `EvnexConfig` | `src/config.ts` `EvnexConfig` | ⬜ not started | `pydantic-settings` `BaseSettings` → plain `process.env` resolver + explicit override object (PLAN.md §5 A1) |

## `evnex/errors.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `EvnexAuthError` | `src/errors.ts` `EvnexAuthError` | ⬜ not started | |
| `InvalidCredentialsError` | `src/errors.ts` `InvalidCredentialsError` | ⬜ not started | |
| `ReauthenticationRequiredError` | `src/errors.ts` `ReauthenticationRequiredError` | ⬜ not started | |
| `ChallengeExpiredError` | `src/errors.ts` `ChallengeExpiredError` | ⬜ not started | |
| `PasswordChangeRequiredError` | `src/errors.ts` `PasswordChangeRequiredError` | ⬜ not started | |
| `InvalidChallengeResponseError` | `src/errors.ts` `InvalidChallengeResponseError` | ⬜ not started | |
| `EvnexConfigurationError` | `src/errors.ts` `EvnexConfigurationError` | ⬜ not started | |
| `NotAuthorizedException` (deprecated `__getattr__` alias) | — | ⬜ not started | **Deliberately omitted** — scheduled for removal in python-evnex 0.8.0, no idiomatic TS form (PLAN.md §2.4). Expected `❌ omitted (justified)`. |
| (n/a — TS-only) | `EvnexError` (new root of the hierarchy) | ⬜ not started | No direct Python analogue: python-evnex's `EvnexAuthError`/`EvnexConfigurationError` each extend `ValueError` separately; this port introduces a shared `EvnexError` root (PLAN.md §2.4). |
| (n/a — TS-only) | `EvnexValidationError` (`src/errors.ts`) | ⬜ not started | Wraps `z.ZodError`; analogue of letting `pydantic.ValidationError` propagate. |

## `evnex/status.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `DeviceStatus` | `src/status.ts` `DeviceStatus` | ⬜ not started | `StrEnum` → `z.enum` + `DeviceStatusValues` const object (PLAN.md §2.2) |
| `ConnectorOcppStatus` | `src/status.ts` `ConnectorOcppStatus` | ⬜ not started | |

## `evnex/models.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `EvnexModelInfo` | `src/models.ts` `EvnexModelInfo` | ⬜ not started | |
| `parse_model` | `src/models.ts` `parseModel` | ⬜ not started | ⚠ 0% covered upstream (PLAN.md §6.3) — A2's tests are the first verification this logic has ever had |
| `CONNECTOR_MAP`, `NAME_MAP_E2`, `CABLE_MAP_E2`, `COLOUR_MAP`, `POWER_MAP`, `PS_MAP`, `CONFIG_MAP` | internal to `parseModel` | ⬜ not started | Lookup tables; not necessarily re-exported |
| E7 branch's `power: "7"` (not `"7 kW"`) | | ⬜ not started | Upstream asymmetry, preserved deliberately (PLAN.md §5 A2) — expected `🔄 adapted` noting it is carried forward, not fixed |

## `evnex/api.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `Evnex` (class) | `src/api.ts` `Evnex` | ⬜ not started | |
| `Evnex.__init__` | `Evnex` constructor / `EvnexOptions` | ⬜ not started | `httpx_client` param → `fetch` injection point |
| `get_user_detail` | `getUserDetail` | ⬜ not started | |
| `get_org_charge_points` | `getOrgChargePoints` | ⬜ not started | |
| `get_org_insight` | `getOrgInsight` | ⬜ not started | Multi-param → options object (`{ days, orgId?, tzOffset? }`), per README |
| `get_org_summary_status` | `getOrgSummaryStatus` | ⬜ not started | |
| `get_org_locations` | `getOrgLocations` | ⬜ not started | |
| `get_org_connector_summary` | `getOrgConnectorSummary` | ⬜ not started | |
| `get_charge_point_detail` | `getChargePointDetail` | ⬜ not started | `@deprecated` |
| `get_charge_point_detail_v3` | `getChargePointDetailV3` | ⬜ not started | |
| `get_charge_point_solar_config` | `getChargePointSolarConfig` | ⬜ not started | |
| `get_charge_point_override` | `getChargePointOverride` | ⬜ not started | |
| `set_charge_point_override` | `setChargePointOverride` | ⬜ not started | |
| `get_charge_point_status` | `getChargePointStatus` | ⬜ not started | |
| `get_charge_point_energy_meter_reading` | `getChargePointEnergyMeterReading` | ⬜ not started | |
| `get_charge_point_transactions` | `getChargePointTransactions` | ⬜ not started | `@deprecated` |
| `get_charge_point_sessions` | `getChargePointSessions` | ⬜ not started | |
| `stop_charge_point` | `stopChargePoint` | ⬜ not started | |
| `enable_charger` | `enableCharger` | ⬜ not started | |
| `disable_charger` | `disableCharger` | ⬜ not started | |
| `set_charger_availability` | `setChargerAvailability` | ⬜ not started | No retry decorator in Python — none in the port either |
| `unlock_charger` | `unlockCharger` | ⬜ not started | No retry decorator in Python — none in the port either |
| `set_charger_load_profile` | `setChargerLoadProfile` | ⬜ not started | No retry decorator in Python — none in the port either |
| `set_charge_point_schedule` | `setChargePointSchedule` | ⬜ not started | No retry decorator in Python — none in the port either; `# "timezone": timezone` stays commented out (§10.1) |
| `_request` | `src/http/transport.ts` `Transport.send` | ⬜ not started | |
| `_check_api_response` | `src/http/transport.ts` `checkApiResponse` | ⬜ not started | |
| `_ensure_success` | `src/http/transport.ts` `ensureSuccess` | ⬜ not started | |
| `_resolve_org_id` | `Evnex`'s private `resolveOrgId` | ⬜ not started | |
| `api_retry` / `NON_RETRYABLE_EXCEPTIONS` | `src/http/retry.ts` `withRetry` | ⬜ not started | Uniform-jitter, 5-attempt policy (PLAN.md §2.5) |
| (n/a — TS-only) | `EvnexHttpError.correlationId` | ⬜ not started | Pure addition — python-evnex discards `x-correlation-id` (PLAN.md §10.6). Expected `🔄 adapted` / enhancement note. |
| `EVNEX_VERSION` (`importlib.metadata.version`) | `Evnex.version` | ⬜ not started | |

## `evnex/auth.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `TokenSet` | `src/auth/tokens.ts` `TokenSet` | ⬜ not started | |
| `TokenSet.to_dict` / `from_dict` | `TokenSet.toJSON` / `TokenSet.fromJSON` | ⬜ not started | Key names (`access_token`, `id_token`, `refresh_token`, `expires_at`) preserved so cache files interchange with the Python CLI |
| `AuthChallenge` | `src/auth/challenge.ts` `AuthChallenge` | ⬜ not started | |
| `TotpEnrollment` | `src/auth/mfa.ts` `TotpEnrollment` | ⬜ not started | |
| `TotpEnrollment.provisioning_uri` | `TotpEnrollment.provisioningUri` | ⬜ not started | Must percent-encode exactly as Python's `quote()` |
| `MfaStatus` | `src/auth/mfa.ts` `MfaStatus` | ⬜ not started | |
| `_decode_expiry` | `src/auth/jwt.ts` `decodeExpiry` | ⬜ not started | No `jose`; manual base64url decode |
| `EvnexAuth` (class) | `src/auth/index.ts` `EvnexAuth` (facade) + `src/auth/session.ts` `CognitoSession` + `src/auth/account.ts` `AccountOperations` | 🔄 adapted | Split across F0 (facade), B1 (session half), B2 (account half) — see PLAN.md §5. Facade is real; session/account are Wave 2 |
| `EvnexAuth.start_authentication` | `CognitoSession.startAuthentication` / `EvnexAuth.startAuthentication` | ⬜ not started | |
| `EvnexAuth.respond_to_challenge` | `CognitoSession.respondToChallenge` / `EvnexAuth.respondToChallenge` | ⬜ not started | |
| `EvnexAuth.get_access_token` | `CognitoSession.getAccessToken` / `EvnexAuth.getAccessToken` | ⬜ not started | |
| `EvnexAuth.force_refresh` / `_ALWAYS_REFRESH` | `CognitoSession.forceRefresh` (overloaded: no-arg vs. `{ staleAccessToken }`) | ⬜ not started | Sentinel becomes an overload distinguishing "no argument" from "`staleAccessToken: undefined`" — see `src/auth/session.ts` TSDoc |
| `EvnexAuth._run_user_pool_op` | `CognitoSession.runUserPoolOp` | ⬜ not started | Exposed (not private) so `account.ts` can share it |
| `EvnexAuth.get_mfa_status` | `AccountOperations.getMfaStatus` / `EvnexAuth.getMfaStatus` | ⬜ not started | |
| `EvnexAuth.begin_totp_enrollment` | `AccountOperations.beginTotpEnrollment` / `EvnexAuth.beginTotpEnrollment` | ⬜ not started | |
| `EvnexAuth.confirm_totp_enrollment` | `AccountOperations.confirmTotpEnrollment` / `EvnexAuth.confirmTotpEnrollment` | ⬜ not started | `device_name` positional → `{ deviceName }` options object, per README |
| `EvnexAuth.set_mfa_preference` | `AccountOperations.setMfaPreference` / `EvnexAuth.setMfaPreference` | ⬜ not started | |
| `EvnexAuth.change_password` | `AccountOperations.changePassword` / `EvnexAuth.changePassword` | ⬜ not started | |
| `EvnexAuth.start_password_reset` | `AccountOperations.startPasswordReset` / `EvnexAuth.startPasswordReset` | ⬜ not started | |
| `EvnexAuth.confirm_password_reset` | `AccountOperations.confirmPasswordReset` / `EvnexAuth.confirmPasswordReset` | ⬜ not started | |
| `EvnexAuth._ensure_cognito` | `src/auth/cognito.ts` `createCognitoAdapter` | ⬜ not started | Lazy boto3 client construction → adapter built eagerly in `EvnexAuth`'s constructor (no blocking I/O concern in Node) |
| `EvnexAuth._tokens_from_cognito` | internal to `CognitoSession` | ⬜ not started | Refresh-token carry-forward behaviour (PLAN.md §5 A9 fixture note) must be preserved |
| `EvnexAuth._store_tokens` | internal to `CognitoSession` | ⬜ not started | Persist-before-publish ordering is load-bearing (PLAN.md §2.3, §5 B1) |
| `EvnexHttpxAuth` | `src/http/authFlow.ts` `withAuthFlow` | ⬜ not started | Bare-token `Authorization` header, single 401 refresh+resend (PLAN.md §10.5) |
| `_error_message` | internal to `src/auth/cognito.ts` | ⬜ not started | |
| `_map_challenge_error` | internal to `src/auth/cognito.ts` / call-site mapping in `session.ts` | ⬜ not started | Same Cognito error name maps to different `Evnex*Error`s by call site (PLAN.md §3.2) — preserve deliberately |
| `CHALLENGE_SOFTWARE_TOKEN_MFA`, `CHALLENGE_SMS_MFA` | internal constants | ⬜ not started | |
| `EXPIRY_SKEW` (30s) | internal constant in `session.ts` | ⬜ not started | |
| `TokenUpdateCallback` | `src/auth/session.ts` `TokenUpdateCallback` | ⬜ not started | |
| SRP handshake (via `pycognito`) | `src/auth/srp.ts` `createSrpClient` | ⬜ not started | Hand-written per RFC 5054 + Cognito variations (PLAN.md §3.3) |
| Cognito operation surface (via `pycognito`) | `src/auth/cognito.ts` `CognitoAdapter` | ⬜ not started | 11 operations, no SDK types leaked (PLAN.md §3.1) |
| `pycognito`'s JWKS token verification | `src/auth/jwt.ts` `verifyJwt` / `fetchJwks` | ⬜ not started | Behind a `verifyTokens` config flag (PLAN.md §3.4, §8 risk 3) — **flag for D1**: confirm whether this lands or is recorded as a deliberate gap |
| Cognito `DEVICE_SRP_AUTH` challenge (device tracking) | — | ⬜ not started | Not implemented; must raise a clear, named error (PLAN.md §3.4, §8 risk 2) — expected `❌ omitted (justified)` |
| `asyncio.Lock` | `src/auth/mutex.ts` `Mutex` | ⬜ not started | |
| `asyncio.to_thread` wrappers throughout this module | — | ❌ omitted (justified) | No blocking-I/O-off-the-event-loop problem in Node; every wrapper collapses to a direct `await` (PLAN.md §2.3) |

## `evnex/schema/charge_points.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `ChargingLogic` | `src/schema/chargePoints.ts` `ChargingLogic` | ⬜ not started | |
| `ChargingCurrentControl` | `src/schema/chargePoints.ts` `ChargingCurrentControl` | ⬜ not started | |
| `E2LEDState` | `src/schema/chargePoints.ts` `E2LEDState` | ⬜ not started | |
| `AntiSleepState` | `src/schema/chargePoints.ts` `AntiSleepState` | ⬜ not started | |
| `ChargePointStatus` | `src/schema/chargePoints.ts` `ChargePointStatus` | ⬜ not started | |
| `EvnexChargePointConnectorMeter` | `src/schema/chargePoints.ts` `EvnexChargePointConnectorMeter` | ⬜ not started | `register` (wire) → `rawRegister`, via `.transform()` (PLAN.md §2.1) |
| `Coordinates` | `src/schema/chargePoints.ts` `Coordinates` | ⬜ not started | |
| `EvnexAddress` | `src/schema/chargePoints.ts` `EvnexAddress` | ⬜ not started | |
| `EvnexLocation` | `src/schema/chargePoints.ts` `EvnexLocation` (re-exported as `EvnexChargePointLocation` from the `src/index.ts` barrel) | ⬜ not started | Name collides with `evnex/schema/v3/locations.py`'s `EvnexLocation` — F0 aliased the barrel export; flagged as an invented naming decision, see F0's report |
| `EvnexChargePointConnector` | `src/schema/chargePoints.ts` `EvnexChargePointConnector` | ⬜ not started | |
| `EvnexChargePointDetails` | `src/schema/chargePoints.ts` `EvnexChargePointDetails` | ⬜ not started | |
| `EvnexChargePointSolarConfig` | `src/schema/chargePoints.ts` `EvnexChargePointSolarConfig` | ⬜ not started | |
| `EvnexChargePointOverrideConfig` | `src/schema/chargePoints.ts` `EvnexChargePointOverrideConfig` | ⬜ not started | |
| `EvnexChargePointStatus` | `src/schema/chargePoints.ts` `EvnexChargePointStatus` | ⬜ not started | |
| `EvnexChargePointStatusResponse` | `src/schema/chargePoints.ts` `EvnexChargePointStatusResponse` | ⬜ not started | |
| `EvnexChargePointEnergyMeterReading` | `src/schema/chargePoints.ts` `EvnexChargePointEnergyMeterReading` | ⬜ not started | |
| `EvnexChargePointEnergyMeterReadingResponse` | `src/schema/chargePoints.ts` `EvnexChargePointEnergyMeterReadingResponse` | ⬜ not started | |
| `EvnexChargePointBase` | `src/schema/chargePoints.ts` `EvnexChargePointBase` | ⬜ not started | |
| `EvnexChargePoint` | `src/schema/chargePoints.ts` `EvnexChargePoint` | ⬜ not started | |
| `EvnexGetChargePointsItem` | `src/schema/chargePoints.ts` `EvnexGetChargePointsItem` | ⬜ not started | |
| `EvnexGetChargePointsResponse` | `src/schema/chargePoints.ts` `EvnexGetChargePointsResponse` | ⬜ not started | |
| `EvnexElectricityCostSegment` | `src/schema/chargePoints.ts` `EvnexElectricityCostSegment` | ⬜ not started | |
| `EvnexChargeProfileSegment` | `src/schema/chargePoints.ts` `EvnexChargeProfileSegment` | ⬜ not started | |
| `EvnexElectricityCost` (v2) | `src/schema/chargePoints.ts` `EvnexElectricityCost` (re-exported as `EvnexElectricityCostBrief`) | ⬜ not started | Name collides with `evnex/schema/v3/cost.py`'s `EvnexElectricityCost` — F0 aliased the barrel export |
| `EvnexChargePointConfiguration` | `src/schema/chargePoints.ts` `EvnexChargePointConfiguration` | ⬜ not started | |
| `EvnexChargePointLoadSchedule` | `src/schema/chargePoints.ts` `EvnexChargePointLoadSchedule` | ⬜ not started | **`timezone` is `.nullish()`, not required — deliberate divergence, see PLAN.md §10.1.** Expected `🔄 adapted`. |
| `EvnexChargePointDetail` (v2) | `src/schema/chargePoints.ts` `EvnexChargePointDetail` | ⬜ not started | |
| `EvnexGetChargePointDetailResponse` | `src/schema/chargePoints.ts` `EvnexGetChargePointDetailResponse` | ⬜ not started | |
| `EvnexChargePointTransaction` | `src/schema/chargePoints.ts` `EvnexChargePointTransaction` | ⬜ not started | |
| `EvnexChargePointTransactions` | `src/schema/chargePoints.ts` `EvnexChargePointTransactions` | ⬜ not started | |
| `EvnexGetChargePointTransactionsResponse` | `src/schema/chargePoints.ts` `EvnexGetChargePointTransactionsResponse` | ⬜ not started | |

## `evnex/schema/commands.py`, `cost.py`, `org.py`, `user.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `EvnexCommandResponse` (v2) | `src/schema/commands.ts` `EvnexCommandResponse` | ⬜ not started | |
| `EvnexCost` | `src/schema/cost.ts` `EvnexCost` | ⬜ not started | |
| `EvnexOrgBrief` | `src/schema/org.ts` `EvnexOrgBrief` | ⬜ not started | |
| `EvnexOrgInsightEntry` | `src/schema/org.ts` `EvnexOrgInsightEntry` | ⬜ not started | |
| `EvnexInsightAttributeWrapper` | `src/schema/org.ts` `EvnexInsightAttributeWrapper` | ⬜ not started | |
| `EvnexOrgSummaryStatus` | `src/schema/org.ts` `EvnexOrgSummaryStatus` | ⬜ not started | |
| `EvnexGetOrgInsights` | `src/schema/org.ts` `EvnexGetOrgInsights` | ⬜ not started | |
| `EvnexGetOrgSummaryStatusResponse` | `src/schema/org.ts` `EvnexGetOrgSummaryStatusResponse` | ⬜ not started | |
| `EvnexUserDetail` | `src/schema/user.ts` `EvnexUserDetail` | ⬜ not started | User payload with no `name` must validate |
| `EvnexGetUserResponse` | `src/schema/user.ts` `EvnexGetUserResponse` | ⬜ not started | |

## `evnex/schema/v3/*.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `EvnexV3Include` | `src/schema/v3/generic.ts` `EvnexV3Include` | ⬜ not started | |
| `EvnexV3Data[T]` | `src/schema/v3/generic.ts` (inlined into `evnexV3ApiResponse`'s `data` field) | ⬜ not started | |
| `EvnexV3APIResponse[T]` | `src/schema/v3/generic.ts` `evnexV3ApiResponse` (factory) + `EvnexV3APIResponse<T>` (type) | ⬜ not started | `Generic[T]` → factory function, per PLAN.md §5 A4's verbatim signature |
| `EvnexRelationship` | `src/schema/v3/relationships.ts` `EvnexRelationship` | ⬜ not started | |
| `EvnexRelationshipWrapper` | `src/schema/v3/relationships.ts` `EvnexRelationshipWrapper` | ⬜ not started | |
| `EvnexRelationships` | `src/schema/v3/relationships.ts` `EvnexRelationships` | ⬜ not started | |
| `EvnexElectricityTariff` | `src/schema/v3/cost.ts` `EvnexElectricityTariff` | ⬜ not started | |
| `EvnexElectricityCost` (v3) | `src/schema/v3/cost.ts` `EvnexElectricityCost` (re-exported as `EvnexElectricityCostV3`) | ⬜ not started | See v2 collision note above |
| `EvnexElectricityCostTotal` | `src/schema/v3/cost.ts` `EvnexElectricityCostTotal` | ⬜ not started | |
| `EvnexEnergyTransaction` | `src/schema/v3/chargePoints.ts` `EvnexEnergyTransaction` | ⬜ not started | |
| `EvnexEnergyUsage` | `src/schema/v3/chargePoints.ts` `EvnexEnergyUsage` | ⬜ not started | |
| `EvnexChargeSchedulePeriod` | `src/schema/v3/chargePoints.ts` `EvnexChargeSchedulePeriod` | ⬜ not started | |
| `EvnexChargeSchedule` | `src/schema/v3/chargePoints.ts` `EvnexChargeSchedule` | ⬜ not started | |
| `EvnexChargeProfile` | `src/schema/v3/chargePoints.ts` `EvnexChargeProfile` | ⬜ not started | |
| `EvnexChargePointFeature` | `src/schema/v3/chargePoints.ts` `EvnexChargePointFeature` | ⬜ not started | |
| `EvnexChargePointFeatures` | `src/schema/v3/chargePoints.ts` `EvnexChargePointFeatures` | ⬜ not started | |
| `EvnexChargePointConnectorMeter` (v3) | `src/schema/v3/chargePoints.ts` `EvnexChargePointConnectorMeter` (re-exported as `EvnexChargePointConnectorMeterV3`) | ⬜ not started | `register` → `rawRegister`; `supplyActivePower` absence vs. zero is meaningful (PLAN.md §5 A4) |
| `EvnexChargePointConnector` (v3) | `src/schema/v3/chargePoints.ts` `EvnexChargePointConnector` (re-exported as `EvnexChargePointConnectorV3`) | ⬜ not started | |
| `EvnexChargePointConnectionConfiguration` | `src/schema/v3/chargePoints.ts` `EvnexChargePointConnectionConfiguration` | ⬜ not started | |
| `EvnexChargePointDetail` (v3) | `src/schema/v3/chargePoints.ts` `EvnexChargePointDetail` (re-exported as `EvnexChargePointDetailV3`) | ⬜ not started | `timeZone` is authoritative here and absent from the list endpoint (PLAN.md §10.2) |
| `EvnexChargePointSessionAttributes` | `src/schema/v3/chargePoints.ts` `EvnexChargePointSessionAttributes` | ⬜ not started | |
| `EvnexChargePointSession` | `src/schema/v3/chargePoints.ts` `EvnexChargePointSession` | ⬜ not started | |
| `EvnexGetChargePointSessionsResponse` | `src/schema/v3/chargePoints.ts` `EvnexGetChargePointSessionsResponse` | ⬜ not started | |
| (n/a — TS-only) | `sessionEnergyWh` | ⬜ not started | Pure addition: meter-delta energy helper (PLAN.md §10.3) — expected enhancement note |
| (n/a — TS-only) | `OBSERVED_SESSION_STATUSES` | ⬜ not started | Pure addition: documents observed `sessionStatus` values (PLAN.md §10.4) |
| `EvnexLocationAddress` | `src/schema/v3/locations.ts` `EvnexLocationAddress` | ⬜ not started | |
| `EvnexLocationCoordinates` | `src/schema/v3/locations.ts` `EvnexLocationCoordinates` | ⬜ not started | |
| `EvnexLocationIcpDetails` | `src/schema/v3/locations.ts` `EvnexLocationIcpDetails` | ⬜ not started | |
| `EvnexLocationAttributes` | `src/schema/v3/locations.ts` `EvnexLocationAttributes` | ⬜ not started | |
| `EvnexLocationChargePointRef` | `src/schema/v3/locations.ts` `EvnexLocationChargePointRef` | ⬜ not started | |
| `EvnexLocationChargePoints` | `src/schema/v3/locations.ts` `EvnexLocationChargePoints` | ⬜ not started | |
| `EvnexLocationRelationships` | `src/schema/v3/locations.ts` `EvnexLocationRelationships` | ⬜ not started | |
| `EvnexLocation` (v3) | `src/schema/v3/locations.ts` `EvnexLocation` | ⬜ not started | Kept unaliased at the `src/index.ts` barrel — see v2 collision note above |
| `EvnexGetLocationsResponse` | `src/schema/v3/locations.ts` `EvnexGetLocationsResponse` | ⬜ not started | |
| `EvnexOrgConnectorSummaryAttributes` | `src/schema/v3/org.ts` `EvnexOrgConnectorSummaryAttributes` | ⬜ not started | |
| `EvnexOrgConnectorSummaryData` | `src/schema/v3/org.ts` `EvnexOrgConnectorSummaryData` | ⬜ not started | |
| `EvnexGetOrgConnectorSummaryResponse` | `src/schema/v3/org.ts` `EvnexGetOrgConnectorSummaryResponse` | ⬜ not started | |
| `EvnexCommandResponse` (v3) | `src/schema/v3/commands.ts` `EvnexCommandResponse` (re-exported as `EvnexCommandResponseV3`) | ⬜ not started | See v2 collision note above |
| (n/a — TS-only, shared) | `src/schema/json.ts` `toJson` | ⬜ not started | Analogue of `model_dump(mode="json")`, shared across every CLI `--json` path (PLAN.md §2.6) |

## `evnex/cli/__init__.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `build_parser` | `src/cli/parser.ts` `buildParser` | ⬜ not started | argparse tree → in-house `Command` tree + `parseArgs` router (PLAN.md §0, §5 C1) |
| `main` | `src/cli/index.ts` `main` | ⬜ not started | Top-level error mapping and exit codes per PLAN.md §5 C1 |

## `evnex/cli/_auth.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `DEFAULT_CACHE` / `_default_cache` | `src/cli/tokenCache.ts` `defaultTokenCachePath` | ⬜ not started | ⚠ `cli/_auth.py` is 52% covered upstream (PLAN.md §6.3) |
| `_save_tokens_factory` | `src/cli/tokenCache.ts` `createTokenSaver` | ⬜ not started | 0600 permission pinning is security-relevant and untested upstream — original work here |
| `_load_tokens` | `src/cli/tokenCache.ts` `loadTokens` | ⬜ not started | |
| `_challenge_code` | `src/cli/otp.ts` `resolveChallengeCode` | ⬜ not started | `--otp` single-use, `--otp-command` shells out |
| `signed_in_auth` | `src/cli/commands/auth.ts` `signedInAuth` | ⬜ not started | |
| `show_qr` | `src/cli/qr.ts` `showQr` | ⬜ not started | Optional peer `qrcode`; missing install degrades to printing the URI |
| `_enrollment_account` | internal to `src/cli/commands/auth.ts` | ⬜ not started | |
| `_print_enrollment` | internal to `src/cli/commands/auth.ts` | ⬜ not started | |
| `cmd_login` | `createAuthCommand`'s `login` handler | ⬜ not started | |
| `cmd_logout` | `createAuthCommand`'s `logout` handler / `src/cli/tokenCache.ts` `removeTokenCache` | ⬜ not started | |
| `cmd_status` | `createAuthCommand`'s `status` handler | ⬜ not started | |
| `cmd_change_password` | `createAuthCommand`'s `change-password` handler | ⬜ not started | |
| `cmd_reset_password` | `createAuthCommand`'s `reset-password` handler | ⬜ not started | |
| `cmd_mfa_enable` | `createAuthCommand`'s `mfa enable` handler | ⬜ not started | |
| `cmd_mfa_disable` | `createAuthCommand`'s `mfa disable` handler | ⬜ not started | |
| `cmd_mfa_enroll` | `createAuthCommand`'s `mfa enroll` handler | ⬜ not started | |
| `cmd_mfa_confirm` | `createAuthCommand`'s `mfa confirm` handler | ⬜ not started | `--no-prefer` → plain boolean flag, inverted in the handler (`parseArgs` has no negated-flag support, PLAN.md §5 C1) |
| `add_auth_commands` | `src/cli/commands/auth.ts` `createAuthCommand` | ⬜ not started | |

## `evnex/cli/_resources.py`

| Python symbol | TypeScript counterpart | Status | Notes |
|---|---|---|---|
| `_positive_int` | validated inline against `FlagSpec`/`PositionalSpec` metadata in `parser.ts`'s router | ⬜ not started | |
| `_abort` | inline `process.exit(2)` / stderr print, in `resolve.ts` / command handlers | ⬜ not started | |
| `open_client` | `src/cli/commands/resources.ts` `openClient` | ⬜ not started | `asynccontextmanager` → explicit `{ client, close }` pair; caller `try`/`finally`s |
| `_list_charge_points` | internal to `resources.ts` | ⬜ not started | |
| `_match_charge_point` | `src/cli/resolve.ts` `matchChargePoint` | ⬜ not started | |
| `_resolve_one` | `src/cli/resolve.ts` `resolveOne` | ⬜ not started | |
| `_kw` | `src/cli/format.ts` `kW` | ⬜ not started | |
| `_kwh` | `src/cli/format.ts` `kWh` | ⬜ not started | |
| `_fmt_dt` | `src/cli/format.ts` `formatDateTime` | ⬜ not started | Must use `Intl.DateTimeFormat.formatToParts()` + `hourCycle: "h23"` (PLAN.md §10.8) |
| `_fmt_period` | `src/cli/format.ts` `formatPeriod` | ⬜ not started | |
| `_print_table` | `src/cli/format.ts` `printTable` | ⬜ not started | |
| `_latest_session` | internal to `resources.ts` | ⬜ not started | |
| `_newest_first` | internal to `resources.ts` | ⬜ not started | Sessions sorted newest-first; API documents no ordering |
| `cmd_live_status` | `createResourceCommands`'s `status` handler | ⬜ not started | |
| `cmd_charge_points_list` | `createResourceCommands`'s `charge-points list` handler | ⬜ not started | |
| `cmd_charge_points_show` | `createResourceCommands`'s `charge-points show` handler | ⬜ not started | |
| `cmd_sessions_list` | `createResourceCommands`'s `sessions list` handler | ⬜ not started | |
| `cmd_locations_list` | `createResourceCommands`'s `locations list` handler | ⬜ not started | |
| `cmd_insights` | `createResourceCommands`'s `insights` handler | ⬜ not started | |
| `cmd_charge_now` | `src/cli/commands/charge.ts` `createChargeCommand`'s `now` handler | ⬜ not started | |
| `cmd_charge_auto` | `createChargeCommand`'s `auto` handler | ⬜ not started | |
| `cmd_charge_stop` | `createChargeCommand`'s `stop` handler | ⬜ not started | `EvnexTimeoutError` → "No active charging session..." message, exit 1 |
| `cmd_schedule_show` | `createResourceCommands`'s `schedule show` handler | ⬜ not started | |
| `add_resource_commands` | `src/cli/commands/resources.ts` `createResourceCommands` + `src/cli/commands/charge.ts` `createChargeCommand` | ⬜ not started | |

## `tests/**`

Test-by-test mapping is **D2**'s `test/PARITY.md`, not this file (PLAN.md §6.2).

---

## Known-and-expected non-`✅` rows (PLAN.md §9.3 / D1 brief)

- `NotAuthorizedException` deprecated alias — omitted.
- `asyncio.to_thread` wrappers throughout `auth.py` and the CLI — adapted away.
- `blockbuster` test fixture — not applicable (no port; it only polices `to_thread` usage).
- `pydantic-settings` — adapted (`EvnexConfig` becomes a plain resolver).
- Cognito JWKS token verification — pending A7/D1 confirmation of whether it lands or is recorded as a deliberate gap.
- Cognito `DEVICE_SRP_AUTH` (device tracking) — omitted, with a named error at the detection site.
