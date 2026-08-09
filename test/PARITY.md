# test/PARITY.md — D2 test-parity and coverage-honesty audit

Wave 4, D2. Scope per `foundational/PLAN.md` §5 D2: (1) map every upstream
Python test function to its TypeScript counterpart and port any that are
missing; (2) audit the 100% coverage gate for honesty — every `v8 ignore`
justified, every §6.3 blind-spot module mutation-tested, every negative-space
path (errors, timeouts, "still 401 after refresh", non-retryable exceptions)
confirmed actually asserted, not just executed.

Audit method: read every Python test function directly (not trusted from the
plan's summary), grepped/read every corresponding TS test file, and for the
§6.3 blind-spot modules made small semantic edits directly in `src/` (a
mutation), ran the suite, observed the result, and reverted before moving to
the next mutation. `git diff --stat src/` is clean at every checkpoint below
and at the end of this document.

---

## 1. Python test count — verified, not assumed

The plan states "115 test functions (150 cases with parametrisation)". Counted
directly against `tests/*.py` in the python-evnex checkout:

| File | `def test_*` / `async def test_*` | Parametrised cases (extra beyond 1) | Total cases |
|---|---:|---:|---:|
| `test_auth.py` | 50 | 0 | 50 |
| `test_cli.py` | 19 | +15 (12-tuple `test_leaf_commands_dispatch_to_their_handler` + 4-tuple `test_old_names_no_longer_parse` + 3-tuple `test_reset_password_rejects_session_flags`, each counted as `cases − 1`) | 35 |
| `test_cli_resources.py` | 43 | +21 (18-tuple `test_resource_leaf_dispatch` + 3-tuple `test_json_purity_on_listings`) | 62 |
| `test_schema.py` | 3 | 0 | 3 |
| **Total** | **115** | | **150** |

Both figures in the plan are exactly right. **115 test functions, 150 cases.**

TS counterpart count at audit start: **849 tests, 49 files**, all passing,
100% line/branch/function/statement coverage per file. Every one of the 115
Python test functions below has a TS counterpart that already existed
(implemented across Waves 1–3, before D2 started); D2 wrote **one** genuinely
missing gap-fill test (§2.3 below) and found **one** real `src/` bug that has
no test and cannot be fixed here (§5).

---

## 2. Parity table

Legend: **✅** ported with a clear 1:1 (or near-1:1) TS counterpart · **🔄**
adapted (same intent, different shape/consolidation, explained) · **❌ N/A**
deliberately not ported, per PLAN.md, with the omission recorded · **✍️ D2
wrote this** — did not exist before this audit.

### 2.1 `tests/test_auth.py` (50 functions)

Owning agents per PLAN §6.2: A7 (`TestTokenSet`, `TestAuthChallenge`), B1
(`TestInteractiveAuthentication`, `TestTokenLifecycle`,
`TestTokenSetResumption`, `TestErrorSurfaces`), A8 (`TestTransport`), B2
(`TestMfaManagement`, `TestPasswordManagement`).

| Python test | TS counterpart | Status |
|---|---|---|
| `TestTokenSet.test_round_trips_through_dict` | `test/auth/tokens.test.ts` › "round-trips through to_dict/from_dict-equivalent JSON" | ✅ |
| `TestTokenSet.test_expiry_derived_from_jwt_when_missing` | `test/auth/tokens.test.ts` › "derives expiresAt from the access token's exp claim when missing" | ✅ |
| `TestTokenSet.test_repr_redacts_tokens` | `test/auth/tokens.test.ts` › "redacts token values from toString() and util.inspect()" | ✅ |
| `TestAuthChallenge.test_round_trips_through_dict` | `test/auth/challenge.test.ts` › "round-trips through to_dict/from_dict-equivalent JSON" | ✅ |
| `TestInteractiveAuthentication.test_password_only_success` | `test/auth/session.test.ts` › "resolves a TokenSet on immediate success…" | ✅ |
| `TestInteractiveAuthentication.test_mfa_challenge_returned` | `test/auth/session.test.ts` › "returns an AuthChallenge when Cognito issues one…" | ✅ |
| `TestInteractiveAuthentication.test_challenge_response_issues_tokens` | `test/auth/session.test.ts` › "issues tokens for a SOFTWARE_TOKEN_MFA challenge…" | ✅ |
| `TestInteractiveAuthentication.test_wrong_code_raises_invalid_response` | `test/auth/session.test.ts` › "maps CodeMismatchException to InvalidChallengeResponseError" | ✅ |
| `TestInteractiveAuthentication.test_expired_session_raises_challenge_expired` | `test/auth/session.test.ts` › "maps ExpiredCodeException…" / "maps NotAuthorizedException (a lapsed challenge session) to ChallengeExpiredError" | ✅ |
| `TestInteractiveAuthentication.test_unsupported_challenge_type` | `test/auth/session.test.ts` › "rejects an unsupported challenge type with EvnexAuthError naming it" | ✅ |
| `TestInteractiveAuthentication.test_invalid_credentials` | `test/auth/session.test.ts` › "maps any CognitoError during sign-in to InvalidCredentialsError" | ✅ |
| `TestInteractiveAuthentication.test_deprecated_not_authorized_exception_alias` | — | ❌ N/A — PLAN.md §2.4 explicitly excludes porting the deprecated module-level `NotAuthorizedException` `__getattr__` alias (removed upstream in 0.8.0; no JS module-`__getattr__` analogue). Recorded in `PARITY.md` root row 50. |
| `TestTokenLifecycle.test_resume_needs_no_credentials` | `test/auth/session.test.ts` › "construction" › "starts resumed when tokens are given" | ✅ |
| `TestTokenLifecycle.test_no_session_raises_reauthentication_required` | `test/auth/session.test.ts` › "throws ReauthenticationRequiredError when there is no session at all" | ✅ |
| `TestTokenLifecycle.test_expired_token_refreshed_proactively` | `test/auth/session.test.ts` › "refreshes proactively when the access token is already expired…" | ✅ |
| `TestTokenLifecycle.test_force_refresh_single_flight` | `test/auth/session.test.ts` › "is single-flight: two concurrent calls racing on the same stale token…" | ✅ |
| `TestTokenLifecycle.test_refresh_without_refresh_token` | `test/auth/session.test.ts` › "throws ReauthenticationRequiredError when there is no refresh token" | ✅ |
| `TestTokenLifecycle.test_callback_failure_does_not_break_auth` | `test/auth/session.test.ts` › "callback failure is swallowed and logged; the tokens are still published and usable" | ✅ |
| `TestTransport.test_request_carries_access_token` | `test/http/authFlow.test.ts` › "injects Authorization as the bare access token…" | ✅ |
| `TestTransport.test_401_refreshes_and_resends_once` | `test/http/authFlow.test.ts` › "refreshes and resends exactly once on a 401, then succeeds" | ✅ |
| `TestTransport.test_persistent_401_not_retried_by_tenacity` | `test/http/authFlow.test.ts` › "still 401 after refresh: resends exactly once, and the caller sees the persistent 401" | ✅ — mutation-killed, see §4 |
| `TestTransport.test_no_tokens_fails_before_any_request` | `test/http/authFlow.test.ts` construction path / `test/auth/session.test.ts` "throws ReauthenticationRequiredError when there is no session at all" | ✅ |
| `TestTransport.test_concurrent_401s_refresh_once` | `test/http/authFlow.test.ts` — concurrent-401 case (single-flight through `forceRefresh`) | ✅ |
| `TestTokenSetResumption.test_refresh_token_only_token_set` | `test/auth/session.test.ts` › "refresh-token-only resumption" describe block | ✅ |
| `TestTokenSetResumption.test_refresh_only_resume_makes_no_wasted_request` | `test/auth/session.test.ts` › "getAccessToken() refreshes once for a session constructed with only a refresh token" | ✅ |
| `TestTokenSetResumption.test_concurrent_refresh_only_startup_single_flight` | `test/auth/session.test.ts` › "20 simultaneous getAccessToken() calls against a refresh-only… session trigger exactly one refresh" | ✅ |
| `TestTokenSetResumption.test_tokens_published_only_after_persistence` | `test/auth/session.test.ts` › "persist-before-publish ordering" describe block | ✅ |
| `TestTokenSetResumption.test_retry_exhaustion_reraises_underlying_error` | `test/http/retry.test.ts` › "reraises the exact underlying error instance, never a wrapper" | ✅ |
| `TestTokenSetResumption.test_override_persistent_401_not_retried` | `test/http/authFlow.test.ts` + `test/http/transport.test.ts` "raises ReauthenticationRequiredError before parsing on a persistent 401" | ✅ |
| `TestErrorSurfaces.test_force_change_password_maps_to_typed_error` | `test/auth/cognito.test.ts` › "throws PasswordChangeRequiredError directly on a NEW_PASSWORD_REQUIRED challenge" | ✅ — mutation-killed, see §4 |
| `TestErrorSurfaces.test_token_verification_failure_on_refresh` | `test/auth/session.test.ts` › "forceRefresh: a verification failure (malformed renewed token) maps to ReauthenticationRequiredError" | ✅ |
| `TestErrorSurfaces.test_naive_expires_at_is_normalised_to_utc` | `test/auth/tokens.test.ts` › "normalises a naive (timezone-less) stored timestamp to UTC" + `test/auth/session.test.ts` › "naive/UTC-normalised expires_at in the past still triggers a proactive refresh without raising" | ✅ (split across the two files that own each half) |
| `TestErrorSurfaces.test_command_http_error_not_retried` | `test/api.test.ts` › "setChargePointOverride: does not retry EvnexHttpError" | ✅ |
| `TestErrorSurfaces.test_challenge_repr_redacts_username` | — | **❌ GAP — real bug found, see §5.1.** No TS counterpart exists, and there is no redaction to test: `src/auth/challenge.ts`'s `AuthChallenge` class has no `toString()`/`[util.inspect.custom]` override, unlike `TokenSet` (which A7 correctly built one for). `util.inspect(challenge)` — what `console.log` uses — prints the raw `username` today. Confirmed empirically (§5.1). Not fixed: `src/` is out of scope for D2. |
| `TestMfaManagement.test_mfa_status` | `test/auth/account.test.ts` › "AccountOperations.getMfaStatus" › "reports enabled methods and the preferred one" | ✅ |
| `TestMfaManagement.test_totp_enrollment_flow` | `test/auth/account.test.ts` › "returns the shared secret and confirms with a trimmed code" | ✅ |
| `TestMfaManagement.test_confirm_with_wrong_code` | `test/auth/account.test.ts` › "maps CodeMismatchException to InvalidChallengeResponseError" (TOTP confirm) | ✅ |
| `TestMfaManagement.test_disable_mfa` | `test/auth/account.test.ts` › "AccountOperations.setMfaPreference" › "disables MFA with both flags false…" | ✅ |
| `TestMfaManagement.test_single_method_is_preferred_automatically` | `test/auth/account.test.ts` › "infers SOFTWARE_TOKEN as preferred when only totp is enabled" / "infers SMS as preferred…" | ✅ |
| `TestMfaManagement.test_both_methods_without_preferred_raises_valueerror` | `test/auth/account.test.ts` › "throws when both methods are enabled with no preferred given" | ✅ |
| `TestMfaManagement.test_revoked_access_token_refreshes_and_retries_once` | 🔄 `test/auth/session.test.ts` › `runUserPoolOp` › "refreshes exactly once and retries after a NotAuthorizedException, then succeeds with the new access token" | 🔄 consolidated — `getMfaStatus` is implemented as a thin wrapper over the shared `runUserPoolOp` primitive (B2's design), so the generic primitive test covers the same retry-once-on-revocation behaviour; a literal duplicate at the MFA call site would test the wrapper, not new logic. |
| `TestMfaManagement.test_persistent_revocation_propagates_after_one_retry` | 🔄 `test/auth/session.test.ts` › `runUserPoolOp` › "propagates a second NotAuthorizedException without a further refresh" | 🔄 same consolidation as above |
| `TestPasswordManagement.test_change_password` | `test/auth/account.test.ts` › "AccountOperations.changePassword" › "changes the password using the current access token" | ✅ |
| `TestPasswordManagement.test_change_password_wrong_current` | `test/auth/account.test.ts` › "maps NotAuthorizedException to InvalidCredentialsError" | ✅ |
| `TestPasswordManagement.test_change_password_invalid_new` | `test/auth/account.test.ts` › "maps any other Cognito error to EvnexAuthError" (changePassword block) | ✅ |
| `TestPasswordManagement.test_start_password_reset_returns_destination` | `test/auth/account.test.ts` › "AccountOperations.startPasswordReset" › "returns the masked delivery destination and needs no session" | ✅ |
| `TestPasswordManagement.test_confirm_password_reset` | `test/auth/account.test.ts` › "AccountOperations.confirmPasswordReset" › "confirms the reset with a trimmed code" | ✅ |
| `TestPasswordManagement.test_confirm_password_reset_wrong_code` | `test/auth/account.test.ts` › "maps CodeMismatchException to InvalidChallengeResponseError" (reset block) | ✅ |
| `TestPasswordManagement.test_confirm_password_reset_expired_code` | `test/auth/account.test.ts` › "maps ExpiredCodeException to ChallengeExpiredError" (reset block) | ✅ |
| `TestPasswordManagement.test_confirm_password_reset_invalid_new` | `test/auth/account.test.ts` › "maps any other Cognito error to EvnexAuthError" (reset block) | ✅ |

**49/50 have a direct/adapted counterpart; 1 genuine gap found (§5.1), not
fixable from `test/`.**

### 2.2 `tests/test_cli.py` (19 functions, 35 cases)

Owning agents: C1 (parser mechanics), C2 (auth command handlers).

| Python test | TS counterpart | Status |
|---|---|---|
| `test_leaf_commands_dispatch_to_their_handler` (12 cases) | `test/cli/auth.test.ts` "createAuthCommand" block (declares login/logout/status/change-password/reset-password/mfa) + `test/cli/parser.test.ts` "dispatch: resolution" (generic dispatch-to-handler mechanics) | ✅ — dispatch mechanics tested generically in `parser.test.ts`, each leaf command's own wiring tested in its owning command file (`auth.test.ts`, `resources.test.ts`, `charge.test.ts`) rather than one parametrised sweep; equivalent coverage, different shape (per-command tests also assert the handler's *behaviour*, not just that it's the one dispatched-to). |
| `test_shared_flags_accepted_in_trailing_position` | `test/cli/parser.test.ts` › "accepts shared flags in trailing position, after a positional" | ✅ |
| `test_otp_command_option_parses` | `test/cli/parser.test.ts` (flag parsing) + `test/cli/otp.test.ts` "--otp-command" block | ✅ |
| `test_confirm_no_prefer_sets_prefer_false` | `test/cli/parser.test.ts` › "declares --no-prefer as a plain boolean the handler inverts itself" + `test/cli/auth.test.ts` "auth mfa confirm" › "--no-prefer confirms without touching the MFA preference" | ✅ |
| `test_confirm_defaults_to_preferring` | `test/cli/auth.test.ts` "auth mfa confirm" › "defaults to preferring: confirms and sets TOTP as the preferred method" | ✅ |
| `test_version_exits_zero` | `test/cli/index.test.ts` › "--version prints a version and exits 0" + `test/cli/parser.test.ts` "dispatch: --version" | ✅ |
| `test_no_args_prints_help_and_exits_zero` | `test/cli/index.test.ts` › "prints the root's help and exits 0 when no subcommand is given" | ✅ |
| `test_old_names_no_longer_parse` (4 cases) | `test/cli/parser.test.ts` › "old flat command names no longer parse now that commands are nested" | ✅ |
| `test_reset_password_rejects_session_flags` (3 cases) | `test/cli/parser.test.ts` › "reset-password rejects the session flags entirely (none declared)" + `test/cli/auth.test.ts` same title | ✅ |
| `test_logout_only_takes_token_cache` | `test/cli/parser.test.ts` › "logout only takes --token-cache, matching Python's TestLogout" + `test/cli/auth.test.ts` same title | ✅ |
| `TestLogout.test_removes_present_cache` | `test/cli/auth.test.ts` "auth logout" › "removes a present cache and reports it" | ✅ |
| `TestLogout.test_missing_cache_reports_nothing_to_do` | `test/cli/auth.test.ts` "auth logout" › "reports nothing to do when the cache is missing" | ✅ |
| `TestLoadTokens.test_corrupt_cache_warns_and_returns_none` | `test/cli/tokenCache.test.ts` "loadTokens" › "warns and returns undefined for malformed JSON" | ✅ |
| `TestLoadTokens.test_missing_cache_returns_none` | `test/cli/tokenCache.test.ts` "loadTokens" › "returns undefined, silently, when the file does not exist" | ✅ |
| `TestPasswordMismatch.test_change_password_mismatch_exits_1` | `test/cli/auth.test.ts` "auth change-password" › "exits 1 without changing the password when confirmation does not match" | ✅ |
| `TestPasswordMismatch.test_reset_password_mismatch_exits_1` | `test/cli/auth.test.ts` "auth reset-password" › "exits 1 without resetting when confirmation does not match" | ✅ |
| `TestOtpCommand.test_failure_exits_1_and_reports` | `test/cli/otp.test.ts` "--otp-command" › "exits 1 and relays stderr on a non-zero exit" | ✅ |
| `TestOtpCommand.test_empty_output_exits_1` | `test/cli/otp.test.ts` "--otp-command" › "exits 1 when the command succeeds but produces no code" | ✅ |
| `TestOtpCommand.test_success_returns_stripped_code` | `test/cli/otp.test.ts` "--otp" / "--otp-command" happy paths | ✅ |

**19/19 covered.**

### 2.3 `tests/test_cli_resources.py` (43 functions, 62 cases)

Owning agents: C3 (resource read commands), C4 (control commands +
resolution), B3 (retry policy exercised through the CLI in a couple of
cases).

| Python test | TS counterpart | Status |
|---|---|---|
| `test_fixtures_validate_against_models` | `test/support/fixtures.test.ts` "fixtures validate against their schemas" (whole describe block, every fixture) | ✅ — broader than upstream: every fixture validated, not a sample |
| `test_resource_leaf_dispatch` (18 cases) | `test/cli/resources.test.ts` + `test/cli/charge.test.ts`, per-command behavioural tests (dispatch wiring proven implicitly by every command executing end-to-end through `run()`) | ✅ — same reasoning as `test_leaf_commands_dispatch_to_their_handler` above |
| `test_shared_flags_accepted_in_trailing_position` | `test/cli/parser.test.ts` (shared with test_cli.py's identically-named test — the flag-parsing mechanism is common code) | ✅ |
| `test_sessions_limit_defaults_to_ten` | **✍️ D2 wrote this** — `test/cli/resources.test.ts` "sessions list" › "defaults to at most 10 sessions when --limit is omitted (test_sessions_limit_defaults_to_ten)" | ✍️ **Gap found and filled** — see §2.3.1 |
| `test_insights_days_defaults_to_seven` | `test/cli/resources.test.ts` "insights" › "defaults --days to 7 (test_insights_defaults)" | ✅ |
| `test_insights_rejects_unsupported_days` | `test/cli/resources.test.ts` "insights" › "rejects an unsupported --days value with exit 2 (test_insights_rejects)" | ✅ |
| `test_resolve_single_charge_point_by_default` | `test/cli/resolve.test.ts` "resolveOne" › "uses the sole charge point when there is exactly one…" | ✅ |
| `test_resolve_ambiguous_default_exits_2` | `test/cli/resolve.test.ts` "resolveOne" › "exits 2 and lists the choices when ambiguous with no selector" | ✅ |
| `test_resolve_prefix_match_by_name` | `test/cli/resolve.test.ts` "matchChargePoint" › "matches case-insensitively by serial substring" (name/serial share the same matcher) | ✅ |
| `test_resolve_match_by_serial` | `test/cli/resolve.test.ts` "matchChargePoint" › serial-substring test | ✅ |
| `test_resolve_exact_id_wins` | `test/cli/resolve.test.ts` › "an exact id match wins even though it would also substring-match another field" | ✅ |
| `test_resolve_ambiguous_selector_exits_2` | `test/cli/resolve.test.ts` › "exits 2 with 'be more specific' when the selector matches several charge points" | ✅ |
| `test_resolve_unknown_selector_exits_2` | `test/cli/resolve.test.ts` › "exits 2 with 'No charge point matches' when the selector matches nothing" | ✅ |
| `test_status_shows_power_and_active_session` | `test/cli/resources.test.ts` "status" › "shows power and the active session (test_status_shows_power_and_active_session)" | ✅ |
| `test_status_json_is_the_only_thing_on_stdout` | `test/cli/resources.test.ts` "status" › "emits --json as the only thing on stdout (test_status_json_is_the_only_thing_on_stdout)" | ✅ |
| `test_charge_points_list` | `test/cli/resources.test.ts` "charge-points list" › "lists charge points (test_charge_points_list)" | ✅ |
| `test_charge_points_show` | `test/cli/resources.test.ts` "charge-points show" › "shows the detail of the sole charge point (test_charge_points_show)" | ✅ |
| `test_sessions_list` | `test/cli/resources.test.ts` "sessions list" › "lists recent sessions (test_sessions_list)" | ✅ |
| `test_sessions_list_respects_limit` | `test/cli/resources.test.ts` "sessions list" › "respects --limit (test_sessions_list_respects_limit)" | ✅ |
| `test_insights` | `test/cli/resources.test.ts` "insights" › "shows daily energy, cost, and session counts (test_insights)" | ✅ |
| `test_get_org_locations_returns_data_objects` | `test/api.test.ts` › "getOrgLocations — GET…, returns the data objects directly" | ✅ |
| `test_get_org_connector_summary` | `test/api.test.ts` › "getOrgConnectorSummary — GET /organisations/{org}/summary/status" | ✅ |
| `test_org_method_without_org_id_raises` | `test/api.test.ts` › "test_org_method_without_org_id_raises — fails fast, with no request sent" | ✅ (strengthened: asserts zero fetch calls, not just an exception) |
| `test_get_user_detail_preserves_configured_org` | `test/api.test.ts` › "test_get_user_detail_preserves_configured_org — a configured org id survives sign-in" | ✅ |
| `test_get_user_detail_defaults_org_when_unset` | `test/api.test.ts` › "test_get_user_detail_defaults_org_when_unset — defaults to the user's first org" | ✅ |
| `test_get_user_detail_defaults_org_when_blank` | `test/api.test.ts` › "test_get_user_detail_defaults_org_when_blank — a present-but-empty org id counts as unset" | ✅ |
| `test_challenge_code_prompts_on_stderr` | `test/cli/otp.test.ts` "prompt fallback" › "prompts on stderr naming the challenge and reads the code from stdin" | ✅ |
| `test_set_override_fails_fast_on_timeout` | `test/api.test.ts` › "setChargePointOverride: does not retry EvnexTimeoutError (test_set_override_fails_fast_on_timeout)" | ✅ — mutation-killed, see §4 |
| `test_locations_list` | `test/cli/resources.test.ts` "locations list" › "lists locations (test_locations_list)" | ✅ |
| `test_locations_list_json_is_the_only_thing_on_stdout` | `test/cli/resources.test.ts` "locations list" › matching title | ✅ |
| `test_locations_list_handles_missing_address` | `test/cli/resources.test.ts` "locations list" › matching title | ✅ |
| `test_charge_now_sends_override` | `test/cli/charge.test.ts` "charge now" › "sends chargeNow: true and prints confirmation" | ✅ |
| `test_charge_auto_sends_override` | `test/cli/charge.test.ts` "charge auto" › "sends chargeNow: false and prints confirmation" | ✅ |
| `test_charge_stop` | `test/cli/charge.test.ts` "charge stop" › "--yes skips the prompt and stops charging" | ✅ |
| `test_charge_stop_no_active_session_exits_1` | `test/cli/charge.test.ts` "charge stop" › "translates a timeout (no active session) into exit 1" | ✅ |
| `test_schedule_show` | `test/cli/resources.test.ts` "schedule show" › "shows the schedule (test_schedule_show)" | ✅ |
| `test_schedule_show_json` | `test/cli/resources.test.ts` "schedule show" › "emits the schedule as JSON (test_schedule_show_json)" | ✅ |
| `test_charge_stop_declined_prompt_aborts` | `test/cli/charge.test.ts` "charge stop" › "a declined confirmation aborts without sending the stop command" | ✅ |
| `test_charge_stop_accepted_prompt_sends_command` | `test/cli/charge.test.ts` "charge stop" › "an accepted confirmation sends the stop command" | ✅ |
| `test_json_purity_on_listings` (3 cases) | `test/cli/resources.test.ts` "JSON purity on listings (test_json_purity_on_listings)" | ✅ |
| `test_sessions_ordering_is_enforced` | `test/cli/resources.test.ts` "sessions list" › "enforces newest-first ordering regardless of API order (test_sessions_ordering_is_enforced)" | ✅ |
| `test_status_renders_charge_point_without_meter` | `test/cli/resources.test.ts` "status" › "renders a charge point with no meter (test_status_renders_charge_point_without_meter)" | ✅ |
| `test_sessions_limit_must_be_positive` | `test/cli/resources.test.ts` "sessions list" › "rejects a non-positive --limit with exit 2" | ✅ |

**42/43 pre-existing; 1 gap found and filled (§2.3.1).**

#### 2.3.1 Gap found: `test_sessions_limit_defaults_to_ten`

Python's version is a parser-only assertion (`args.limit == 10`). The TS
suite has plenty of `--limit N` behavioural tests but, before this audit,
**no test anywhere asserted that omitting `--limit` actually caps rendered
output at 10** — neither at the parser level (the generic
`"applies a flag's default value…"` test in `parser.test.ts` uses a
synthetic flag, not the real `sessions list` command) nor end-to-end (the
`SESSIONS_PAYLOAD` fixture only has 2 entries, too few to distinguish
"default 10" from "no limit at all"). Added a test in
`test/cli/resources.test.ts` that feeds 12 sessions and asserts exactly 10
render (newest-first), closing the gap end-to-end rather than just at the
parser. Passes against the current `src/`.

### 2.4 `tests/test_schema.py` (3 functions)

| Python test | TS counterpart | Status |
|---|---|---|
| `test_user_without_name_validates` | `test/schema/user.test.ts` "test_user_without_name_validates" + `test/support/fixtures.test.ts` same name | ✅ |
| `test_connector_meter_exposes_supply_active_power` | `test/support/fixtures.test.ts` "connector meter with a power sensor installed (tests/test_schema.py)" | ✅ |
| `test_connector_meter_without_power_sensor` | `test/support/fixtures.test.ts` "connector meter without a power sensor (tests/test_schema.py)" | ✅ |

**3/3 covered, doubly so for the first.**

---

## 3. `v8 ignore` adjudication — all 12, one by one

Found via `grep -rn "v8 ignore" src/` — exactly 12 lines across the 5 files
named in the brief, matching. For each: what it excludes, the stated reason,
and D2's verdict.

| # | File:line | Excludes | Stated reason | Verdict |
|---|---|---|---|---|
| 1–2 | `src/models.ts:117,127` | `catch {}` block in `parseModel`'s E2 branch | "unreachable: string methods (split, charAt, slice) never throw" | **Justified.** The only operations inside the `try` are `String.prototype.split/charAt/slice`, none of which throw per spec for any input, including out-of-range indices (they return `""`). Confirmed by reading the full branch: no JSON parsing, no external calls, nothing else in the block. The `try/catch` itself is defensive paranoia with no failure mode to guard — arguably removable, but that's a `src/` simplification, not a coverage-honesty problem. Form: well-formed `start`/`stop` pair, correctly bracketing exactly the `catch` block. |
| 3–4 | `src/models.ts:189,199` | Same pattern, X-series branch | Same | **Justified**, same reasoning. |
| 5–6 | `src/models.ts:255,265` | Same pattern, E7-series branch | Same | **Justified**, same reasoning. |
| 7 | `src/auth/cognito.ts:205` | start of `toCognitoError` | "`err` is always an Error in practice" | **Justified**, and probed, not asserted: A6's Wave-1 note documents empirically that `@smithy/core/retry`'s `asSdkError` normalises every non-Error throw before it reaches `client.send()`'s caller, so the `else` branch (`String(err)` / `"UnknownError"`) is unreachable through any real SDK call path. D2 additionally confirmed the *reachable* half is genuinely exercised (not just excluded-and-forgotten): `test/auth/cognito.test.ts` calls `toCognitoError` indirectly via `startAuthentication`/`respondToChallenge`/etc. with real thrown `Error`s and asserts on `.name`/`.message`/`.cause`. |
| 8 | `src/auth/cognito.ts:212` | stop of the same function | Same | **Justified**, paired with #7. One nuance worth recording: the ignore covers the *entire function*, including the reachable `if (err instanceof Error)` branch, not just the unreachable `else`. The comment explains why: this coverage provider ignores by line range, not by branch, so there is no way to exclude only the unreachable half without also either (a) restructuring the function to put the unreachable line alone on its own line (already true — see below) or (b) accepting the over-broad exclusion. Since the reachable branch is independently proven exercised by the test suite (previous row), the over-broad exclusion costs nothing in practice. |
| 9–10 | `src/cli/index.ts:61,66` | `if (isDirectlyExecuted) { await main(); }` | "process entrypoint guard, exercised only when this file is run directly as the `evnex` binary, not when imported by tests" | **Justified.** This is exactly the PLAN.md §6.1 example of a legitimate exclusion ("`webbrowser`/`process.exit` boundaries where the assertion belongs to the harness"). `test/cli/index.test.ts` imports and calls `main()` directly, exercising every line of `main`'s body; only the top-level "am I the entrypoint" branch is excluded, and that branch is genuinely a different execution mode (`node dist/cli/index.js` vs. `import { main }`) that a unit test cannot enter without actually spawning the binary as a subprocess — which would test process-spawning machinery, not this code. Form: well-formed `start`/`stop` pair. |
| 11 | `src/cli/format.ts:105` | `?? 0` fallback in `printTable`'s cell-render line | "provably unreachable, see above" | **Justified**, and independently proven: `widths[index]` is seeded for every index `0..headers.length-1` before any row is rendered, and extended for every index any row occupies during the same scan that later reads it back — so by construction every `index` read in the render loop was written in the scan loop immediately above. Confirmed by re-reading `printTable`'s full body (`src/cli/format.ts:92-109`); the `?? 0` exists solely to satisfy `noUncheckedIndexedAccess`, not because the fallback can fire. Form: correctly a **single-line** `/* v8 ignore next -- ... */` directly above its one target line — the well-formed case for `next`. |
| 12 | `src/cli/qr.ts:42-45` | branch coverage of `err.code ?? err.cause?.code` in `isModuleNotFoundError` | "the `err.code` side and the `.cause` presence check are only reachable via a real, unmocked import() failure" | **Justified in substance, malformed in form — flagged as a defect.** See §3.1 below for the full analysis: mutation-testing confirms the `err.code` truthy path really is untestable given `vi.mock`'s error-wrapping behaviour, so the *reason* is sound. But the directive itself is written as a **4-line block comment** using the single-line `next` form, which (per `v8-to-istanbul`'s line-by-line parser, traced in `node_modules/@vitest/coverage-v8/dist/provider.js`) causes `next`'s one-line ignore window to land on line 43 (a comment continuation line, itself containing no code) rather than line 46 (the actual target). By coincidence this doesn't currently hide anything **additional** — no branch record is emitted for this specific `??` at all under the current TS target/transform, so nothing is silently under-counted — but it is fragile: a future refactor that causes v8 to start recording a branch there would have this directive silently fail to suppress it, and the 100% gate would not catch a real regression (it would just fail loudly, which is actually the safe outcome — but the intent of the comment, "I have reasoned about this exclusion", would no longer match what's excluded). **Recommend**: rewrite as `/* v8 ignore next 5 -- ... */` (explicit count) or convert to a `start`/`stop` pair bracketing lines 42-46, either of which is immune to this class of mis-parse. This is a `src/` edit D2 cannot make; flagged for the integrator. |

**Verdict summary: 11/12 justified outright; 1/12 (`qr.ts:42`) justified in
substance but malformed in form — a real defect for the integrator to fix
(the fix is mechanical: widen the ignore span), not a coverage-honesty
failure today.**

### 3.1 `qr.ts`'s directive — the full trace

`isModuleNotFoundError` does:

```ts
const code = err.code ?? err.cause?.code;
return code === "ERR_MODULE_NOT_FOUND";
```

Every test that exercises this function goes through `vi.mock("qrcode", ...)`
throwing an `Error`. Vitest's mock-factory-throw path (proven separately by
`test/cli/qr.importError.test.ts`, which asserts
`(caught as Error).cause).toMatchObject({ message: "boom" })`) always wraps
the thrown value under `.cause` before it reaches `loadQrcode`'s `catch`.
That means in every test, `err.code` (the outer, wrapping error) is always
`undefined`, and only `err.cause?.code` (the inner, mocked error) ever
carries `"ERR_MODULE_NOT_FOUND"`. A real, unmocked `import()` failure for a
genuinely missing package sets `.code` directly on the thrown error with no
`.cause` — a shape the test environment cannot produce for a package
(`qrcode`) that **is** installed in this repo, short of actually uninstalling
it.

D2 confirmed this two ways:

1. **Read the `v8-to-istanbul` source** bundled in
   `node_modules/@vitest/coverage-v8/dist/provider.js` (`_parseIgnore`,
   `_buildLines`) to understand exactly how a multi-line `next` comment is
   parsed — line by line, with the ignore window (`ignoreCount`) set by
   whichever physical line contains the `/* v8 ignore next` token and
   consumed by the very next physical line, comment or not. Traced by hand:
   token on line 42 consumes line 43 (comment prose), leaving lines 44-46
   unignored.
2. **Mutation-tested directly**: temporarily changed
   `err.code ?? err.cause?.code` to just `err.cause?.code` (dropping the
   `err.code` branch this ignore claims is untestable) and re-ran
   `test/cli/qr.test.ts test/cli/qr.missingPackage.test.ts
   test/cli/qr.importError.test.ts` — **all 14 tests still passed**,
   confirming `err.code`'s truthy path is genuinely never exercised, exactly
   as claimed. Separately, swapping operand order
   (`err.cause?.code ?? err.code`) also left all tests passing — an
   *equivalent mutant*, expected and uninteresting, since with `err.code`
   always `undefined` the two orderings are observationally identical to
   every existing test. Reverted both; `git diff --stat src/` clean
   immediately after each.

---

## 4. Mutation spot-checks — §6.3 blind-spot modules

Each mutation was made directly in the named `src/` file, the affected test
file(s) run, the result recorded, and the file reverted via the original
copy kept in the scratch directory before moving on.  `git diff --stat src/`
was empty at the start and is empty now (confirmed again in §6).

| # | Module (§6.3) | Mutation | Command | Result | Verdict |
|---|---|---|---|---|---|
| 1 | `src/http/retry.ts` | `MAX_ATTEMPTS = 5` → `6` | `test/http/retry.test.ts` | 2 tests failed (`toBe(5)` / `toHaveBeenCalledTimes(5)`) | **Killed** |
| 2 | `src/http/retry.ts` | `computeDelayMs`'s window: `1000 * 2 ** attempt` → `1000 * 2 ** (attempt - 1)` (the classic tenacity off-by-one the plan calls out by name) | `test/http/retry.test.ts` | 4 tests failed (window/scaling/default-random assertions) | **Killed** |
| 3 | `src/http/retry.ts` | `attempt >= MAX_ATTEMPTS` → `attempt > MAX_ATTEMPTS` | `test/http/retry.test.ts` | 2 tests failed (6 calls instead of 5) | **Killed** |
| 4 | `src/api.ts` | `getOrgChargePoints`'s `nonRetryable: [EvnexHttpError]` → `[]` | `test/api.test.ts` | The dedicated "does not retry EvnexHttpError" test **timed out** (started actually retrying with real delays) | **Killed** |
| 5 | `src/api.ts` | `setChargePointOverride`'s `nonRetryable: [EvnexHttpError, EvnexTimeoutError]` → `[EvnexHttpError]` (drops the timeout exclusion — the one PLAN.md calls out as operationally expensive to get wrong, since a retried `set_override` resubmits a command to real hardware) | `test/api.test.ts` | The `test_set_override_fails_fast_on_timeout`-named test **timed out** | **Killed** |
| 6 | `src/http/transport.ts` | `ensureSuccess`'s `response.status === 401` → `=== 402` | `test/http/`, `test/api.test.ts`, `test/auth/` | 3 tests failed across `authFlow.test.ts` and `transport.test.ts`, including the exact "still 401 after refresh" test | **Killed** |
| 7 | `src/models.ts` | `POWER_MAP["7"]`: `"7 kW"` → `"77 kW"` | `test/models.test.ts` | 4 tests failed | **Killed** |
| 8 | `src/models.ts` | E7 branch's hardcoded `power: "7"` → `"7 kW"` (the upstream-asymmetry line the plan specifically flags) | `test/models.test.ts` | 5 tests failed, including the dedicated "power is always '7' for E7" assertion | **Killed** |
| 9 | `src/cli/tokenCache.ts` | `createTokenSaver`'s `handle.chmod(0o600)` → `0o644` | `test/cli/tokenCache.test.ts` | 2 tests failed (mode assertions, including the security-relevant overwrite case) | **Killed** |
| 10 | `src/cli/commands/auth.ts` | `signedInAuth`'s `if (!(error instanceof ReauthenticationRequiredError)) throw error;` → dropped the `!` (inverts which branch re-throws vs. falls back to interactive sign-in) | `test/cli/auth.test.ts` | 4 tests failed/timed out | **Killed** |
| 11 | `src/schema/chargePoints.ts` | §10.1 regression field: `timezone: z.string().nullish()` → `z.string()` (re-introduces the exact upstream bug) | `test/schema/chargePoints.test.ts` | 2 tests failed with a `ZodError` on the absent/null cases | **Killed** |
| 12 | `src/auth/cognito.ts` | `challengeName === "NEW_PASSWORD_REQUIRED"` → `"NEW_PASSWORD_REQUIRED_X"` | `test/auth/cognito.test.ts` | 1 test failed | **Killed** |
| 13 | `src/cli/qr.ts` | `err.code ?? err.cause?.code` → `err.cause?.code` (drops the untested branch entirely) | `test/cli/qr*.test.ts` | **Survived** — see §3.1 | **Equivalent mutant, confirms the `v8 ignore #12` justification rather than undermining it; not a hidden gap.** |

**12 of 13 mutations were killed outright by the existing suite. The one
survivor is the `qr.ts` case already accounted for in the `v8 ignore`
adjudication (§3), not a new finding — it demonstrates the same untestable
branch from the opposite direction (an equivalent mutant under every
producible test input) rather than exposing an assertion-free test.**

No coverage-shaped-but-assertion-free test was found in any of the modules
probed. Every mutation that changed *observable* behaviour under the
existing test harness was caught, often by more than one test.

---

## 5. Bugs found in `src/` (reported, not fixed — out of scope for D2)

### 5.1 `AuthChallenge` does not redact `username` from `util.inspect()` / `console.log()`

**File:** `src/auth/challenge.ts`. **Severity:** parity + mild
security-hygiene regression (the class carries a real username/email in
plaintext through any accidental `console.log(challenge)`).

Python's `AuthChallenge` is a frozen dataclass with `username` declared
`field(repr=False)`, so `repr(challenge)` never includes it — verified by
`tests/test_auth.py::TestErrorSurfaces::test_challenge_repr_redacts_username`.
`TokenSet` got the equivalent TS treatment (A7, Wave 1): it defines both
`toString()` and `[util.inspect.custom]` to redact its secrets, confirmed by
`test/auth/tokens.test.ts` › "redacts token values from toString() and
util.inspect()". **`AuthChallenge` did not get the same treatment** — it has
no `toString()` override and no `[util.inspect.custom]`, so Node's default
object inspection prints every field, including `username`.

Reproduced directly:

```
$ npx tsx probe-redact.ts
util.inspect(): AuthChallenge {
  name: 'SOFTWARE_TOKEN_MFA',
  session: 's',
  username: 'user@example.com',
  parameters: {}
}
contains email (inspect)? true
```

(`console.log(challenge)` uses `util.inspect` under the hood, so this is the
exact leak the Python test guards against.) D1's `PARITY.md` does not
mention this — grepped for "redact"/"repr" and found only the `TokenSet`
row. This is a genuine, previously unreported gap.

**Not fixed**: fixing it means adding a `[util.inspect.custom]`/`toString()`
override to `src/auth/challenge.ts`, which is out of D2's write scope (rule
2). No test was added for it either, since a test asserting the desired
(redacted) behaviour would fail against the current `src/` and D2 must leave
the suite green. **Flagged for the integrator**: port `TokenSet`'s redaction
pattern to `AuthChallenge`'s `username` field, then add the mirrored test in
`test/auth/challenge.test.ts` (the Python test is a two-line pattern: build
a challenge with a username, assert it's absent from the string
representation).

### 5.2 `qr.ts`'s malformed `v8 ignore next` directive

See §3, row 12, and §3.1. Not a bug in behaviour, but a defect in the
coverage-exclusion comment's *form* that happens not to be actively hiding
anything today. Mechanical fix, flagged for the integrator, not applied here
(the fix is in `src/`).

### 5.3 Previously-known findings, re-confirmed, not new

Two issues already on record from Wave 1/2 (B3, A3) were re-confirmed during
this audit rather than being new findings:

- **`unlockCharger`'s org-id resolution deviation** (B3): Python's
  `unlock_charger` alone among org-scoped methods interpolates `self.org_id`
  directly instead of calling `_resolve_org_id`, so an unset org id silently
  emits the literal string `"None"` into the request path. The TS port
  deliberately does not reproduce this — `unlockCharger` calls
  `resolveOrgId()` and fails fast with `EvnexConfigurationError` like every
  sibling method, tested by `test/api.test.ts` › "unlockCharger — fails fast
  (no request) when the client has no resolved org". Recorded in root
  `PARITY.md`; re-verified here by reading `src/api.ts`'s `unlockCharger`
  directly — the deviation is real and the test genuinely exercises it (not
  merely re-asserted from the finding).
- **`EvnexChargePointDetail` (v2) has no live fixture** (A3, B3): re-confirmed
  by grep — no occurrence of a v2 detail payload with `configuration`,
  `electricityCost`, `loadSchedule`, or non-optional `connectors` populated
  anywhere in `tests/test_cli_resources.py`, `tests/test_auth.py`,
  `tests/test_schema.py`, or `test/support/fixtures.ts`. **Which of our
  tests would fail to catch a wrong shape here**: none — there is no test
  that round-trips real-shaped data through this schema at all beyond
  `test/index.test.ts`'s barrel-export existence check (per A3's note) and
  `test/api.test.ts`'s "getChargePointDetail (deprecated v2)" happy path,
  which supplies its own hand-built fixture rather than a captured live
  response; if that hand-built fixture's shape for `configuration` /
  `electricityCost` / `loadSchedule` is wrong relative to the live API (the
  exact failure mode that produced the confirmed §10.1 bug), nothing in
  either test suite would notice. This is an offline-unfixable gap per the
  brief — D5's job to close with a live capture.

---

## 6. Negative-space confirmation

Explicit confirmation, per the brief's checklist, that these paths are
**asserted**, not merely executed:

| Path | TS test | Confirmed by |
|---|---|---|
| "Still 401 after refresh" | `test/http/authFlow.test.ts` › "still 401 after refresh: resends exactly once, and the caller sees the persistent 401"; `test/http/transport.test.ts` › "raises ReauthenticationRequiredError before parsing on a persistent 401" | Mutation #6 (§4) — flipping the status comparison broke both |
| Timeout → `EvnexTimeoutError`, not raw `AbortError` | `test/http/transport.test.ts` › "translates a timeout abort into EvnexTimeoutError, not a raw AbortError" + "also translates a generic AbortError" | Read directly; asserts `instanceof EvnexTimeoutError`, not just "doesn't throw" |
| Invalid-JSON body propagates unwrapped | `test/http/transport.test.ts` › "propagates a raw parse error on an invalid-JSON body (untested upstream, §6.3)" | Read directly; asserts the raw `SyntaxError` surfaces, matching Python's unwrapped `from_json` propagation |
| Standing non-retryable set never retried | `test/http/retry.test.ts` — parametrised loop over `EvnexValidationError`, `EvnexAuthError`, `EvnexConfigurationError`, `InvalidCredentialsError` (a subclass, proving `instanceof`, not name-equality, is used) | Each asserts `toHaveBeenCalledTimes(1)` and zero recorded delays |
| Every §2.5 per-method non-retryable addition | `test/api.test.ts` "retry policy — extra non-retryable additions" describe block: `getOrgChargePoints`, `getOrgLocations` (×`EvnexHttpError`); `getChargePointDetailV3` (×`TypeError`); `getChargePointSolarConfig`/`getChargePointOverride`/`getChargePointStatus`/`getChargePointEnergyMeterReading` (×`EvnexTimeoutError`, table-driven); `setChargePointOverride`/`stopChargePoint` (×`EvnexHttpError` **and** `EvnexTimeoutError`, both tested individually) | Mutations #4, #5 (§4) directly against two of these; the rest read and confirmed to follow the identical call-count-assertion pattern |
| The four no-retry-decorator methods stay un-retried | `test/api.test.ts` "retry policy — no retry decorator in Python, none added here": `setChargerAvailability`, `unlockCharger`, `setChargerLoadProfile`, `setChargePointSchedule`, table-driven, each asserting exactly 1 call on a transient `EvnexHttpError` | Read directly; this is the *absence* of a retry wrapper being positively pinned, not just untested |
| §10.1 regression (`timezone` no-default bug) | `test/schema/chargePoints.test.ts` "EvnexChargePointLoadSchedule.timezone (PLAN.md §10.1 regression)" — absent / present / explicit-null cases | Mutation #11 (§4) — reverting the fix broke 2 of the 3 cases immediately |
| Command-surface retry policy call-count assertions | Every "does not retry X" / "still retries Y to the 5-attempt cap" test in `test/api.test.ts` asserts `stub.callsFor(...)` length, not just the rejected error type | Spot-read across ~15 such tests; all follow the pattern |

No coverage-shaped-but-assertion-free test was found among these. Every
negative-space path named in the brief has a TS test that asserts the
specific outcome (error type, call count, or exact string), not merely that
"something was thrown."

---

## 7. Final gate

Run after the one gap-fill test (§2.3.1) was added and immediately before
writing this report, with `src/` unmodified from its state at the start of
the audit:

```
$ npx tsc --noEmit
(clean, no output)

$ npm run lint
(clean, no output)

$ npm test        # vitest run --coverage
 Test Files  49 passed (49)
      Tests  850 passed (850)
   Coverage:  100% stmts / 100% branch / 100% funcs / 100% lines, every file

$ git diff --stat src/
(empty — src/ is unmodified)

$ git diff --stat test/
 test/PARITY.md          | (new file, this document)
 test/cli/resources.test.ts | +29 (§2.3.1 gap-fill test)
```

**849 → 850 tests** (the one gap-fill test from §2.3.1). File count
unchanged at 49 (the new test lives in an existing file); `test/PARITY.md`
itself is documentation, not a test file, so it doesn't add to the count.
100% coverage held throughout — every mutation in §4 was reverted before the
next was applied, and this final run confirms the tree is clean and green.

---

## 8. What D2 could not determine

- **Whether `qr.ts`'s malformed `v8 ignore` (§3, row 12) is hiding anything
  on a different Node version or V8 build.** The "no branch is emitted for
  this `??` at all" observation was made against this repo's exact toolchain
  (Node/V8/vitest/esbuild versions pinned in `package-lock.json`); it is
  plausible a different V8 version instruments nullish-coalescing
  differently and would emit a branch here, in which case the malformed
  directive's mis-targeting would start mattering. Recommend the mechanical
  fix (§3, row 12) regardless, since it costs nothing and removes the
  dependency on this coincidence.
- **Whether `AuthChallenge`'s redaction gap (§5.1) is exploitable in
  practice** beyond an accidental `console.log` — i.e. whether any code path
  in this codebase or a downstream consumer actually logs a challenge
  object. Grepped this repo's `src/` and found no such call site (challenges
  are only ever pattern-matched/destructured, never logged directly), but
  D2 did not audit downstream consumers, which are out of scope.
- **Live-API corroboration for `EvnexChargePointDetail` (v2)** — restated
  from §5.3, this needs a live capture (D5's job), not more test-writing;
  D2 confirmed the absence but cannot close it from this vantage point.
