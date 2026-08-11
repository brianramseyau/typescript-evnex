# typescript-evnex

TypeScript client for the [Evnex](https://www.evnex.com/) EV charger Cloud API.

A faithful port of [`hardbyte/python-evnex`](https://github.com/hardbyte/python-evnex).

> **Status: code-complete, audited, and validated against a live account.**
> A symbol-for-symbol port of `python-evnex` 0.7.0 (tracked in
> [`PARITY.md`](PARITY.md)), with 100% line and branch coverage enforced per
> file, plus a live-account validation pass (2026-08-11) covering
> interactive sign-in, the full CLI, and a schema sweep of every reachable
> endpoint cross-checked against an independent consumer app — see
> [`docs/downstream-validation.md`](docs/downstream-validation.md). See
> [`foundational/PLAN.md`](foundational/PLAN.md) for the porting plan and
> the definition of done.

Author not affiliated with Evnex.

---

## Acknowledgements

This project exists because of **[Brian Thorne](https://github.com/hardbyte)**
and the work he put into [`python-evnex`](https://github.com/hardbyte/python-evnex).

Evnex publishes no official API documentation. Every endpoint, every response
shape, every Cognito authentication detail, and every hard-won operational quirk
in this library — which commands must never be retried, why a stop request
against an idle charger surfaces as a read timeout, which fields only appear
when a power sensor is installed — was discovered, verified against real
hardware, and carefully documented in `python-evnex` first. Porting it was the
easy part; the reverse engineering was not.

Thank you, Brian, for doing that work and for sharing it under a permissive
licence. This port stands entirely on it, and tries to preserve the care that
went into the original — including the comments explaining _why_ the code is
shaped the way it is.

If you use Python, please use [`python-evnex`](https://github.com/hardbyte/python-evnex)
directly. It is the reference implementation and this port tracks it.

---

## Features

- Talks to your Evnex charger via the Cloud API
- Automatic retries with exponential backoff
- Automatic re-authentication
- Multi-factor authentication, including managing your MFA devices
- Password change and reset
- Optionally pass in your own `fetch` implementation
- Optionally pass in tokens to resume an existing session
- Fully typed, with runtime response validation
- A deliberately small dependency footprint

## Dependencies

Direct dependency counts hide what actually matters, so this project tracks the
**total transitive package count** and prints it in CI.

`zod` handles response validation; it pulls in nothing else. Everything modern
Node already provides is used directly rather than wrapped: `fetch` for HTTP,
`node:util`'s `parseArgs` for the CLI, `node:crypto` for JWT and SRP. There is
no HTTP client library, no CLI framework, and no bundler.

`qrcode` is an optional peer, used only by `evnex auth mfa enable` to draw a
scannable code. It is 32 packages, which is why it is optional rather than
required — without it the CLI prints the `otpauth://` URI instead and everything
else works unchanged.

See [`foundational/PLAN.md` §0](foundational/PLAN.md) for the measured counts and
the policy.

## Installation

```shell
npm install evnex
```

**Requirements:** Node 20+. ESM only.

## Usage

`EvnexAuth` handles signing in and keeping the session alive; the `Evnex` client
uses it to call the API. Credentials establish a session once and are never
stored:

```ts
import { Evnex } from "evnex";
import { EvnexAuth } from "evnex/auth";

const auth = new EvnexAuth();
await auth.startAuthentication(
  process.env.EVNEX_CLIENT_USERNAME!,
  process.env.EVNEX_CLIENT_PASSWORD!,
);

const evnex = new Evnex({ auth });

const user = await evnex.getUserDetail();
for (const org of user.organisations) {
  for (const entry of await evnex.getOrgInsight({ days: 7, orgId: org.id })) {
    console.log(org.name, entry);
  }
}
```

### Multi-factor authentication

If the account has MFA enabled, `startAuthentication` resolves to an
`AuthChallenge` instead of tokens. Show it to the user, collect their 6-digit
code, and answer it:

```ts
import { isAuthChallenge } from "evnex/auth";

let result = await auth.startAuthentication(username, password);
while (isAuthChallenge(result)) {
  const code = await promptForCode(result.name);
  result = await auth.respondToChallenge(result, code);
}
```

Challenges are short-lived (a few minutes): `ChallengeExpiredError` means start
over, while `InvalidChallengeResponseError` means the code was wrong and the
same challenge can be retried. A challenge is JSON-serialisable, so a web
backend or config flow can answer it in a later request or another process.

### Staying signed in

Store the tokens and resume later — the refresh token alone is enough, no
password or MFA prompt. Expired sessions renew automatically; register
`onTokenUpdate` to be handed every newly issued token set, and it will have
completed before any request uses the new tokens, so your stored copy can never
fall behind one that is already in use:

```ts
import { EvnexAuth, TokenSet } from "evnex/auth";

const auth = new EvnexAuth({
  tokens: TokenSet.fromJSON(await myStore.read()),
  onTokenUpdate: async (tokens) => myStore.write(tokens.toJSON()),
});

const evnex = new Evnex({ auth });
const user = await evnex.getUserDetail();
```

If a request is rejected mid-session, the client refreshes and retries it once,
transparently. When the session truly cannot be renewed, calls reject with
`ReauthenticationRequiredError` — run the interactive sign-in again.

See `examples/getToken.ts` for a complete sign-in and persistence flow.

### Managing MFA devices

The Evnex app does not currently expose changing or removing your MFA device;
the API does, and `EvnexAuth` wraps it (requires a signed-in session):

```ts
const status = await auth.getMfaStatus(); // which methods are enabled

const enrollment = await auth.beginTotpEnrollment();
console.log(enrollment.provisioningUri("you@example.com")); // render as a QR code
await auth.confirmTotpEnrollment(code, { deviceName: "New phone" });
await auth.setMfaPreference({ totp: true }); // turn TOTP on / make preferred

await auth.setMfaPreference(); // disable MFA entirely
```

Completing a new TOTP enrollment replaces the previously registered
authenticator device.

### Changing or resetting your password

```ts
// Change the password of a signed-in account:
await auth.changePassword(currentPassword, newPassword);

// Reset a forgotten password (no session needed):
const destination = await auth.startPasswordReset("you@example.com"); // masked email
await auth.confirmPasswordReset("you@example.com", emailedCode, newPassword);
```

## Command line

Everything above is also available as a CLI:

```shell
export EVNEX_CLIENT_USERNAME=you@example.com
export EVNEX_CLIENT_PASSWORD=<your password>

npx evnex auth login                 # sign in (uses cached tokens when valid)
npx evnex auth status                # signed-in user, session, and MFA state
npx evnex auth logout                # forget the cached session
npx evnex auth mfa enable            # enroll a TOTP device and turn MFA on
npx evnex auth mfa disable           # turn MFA off entirely
npx evnex auth change-password       # change your password (prompts)
npx evnex auth reset-password        # reset a forgotten password via email

npx evnex status                     # live view: connectors, power, sessions
npx evnex charge-points list         # id, name, serial, network status
npx evnex charge-points show         # detail for one charge point
npx evnex sessions list              # recent charging sessions
npx evnex locations list             # name, city, ICP number, retailer, timezone
npx evnex insights                   # daily energy, cost, and session counts
npx evnex charge now                 # start charging immediately
npx evnex charge auto                # return to the configured schedule
npx evnex charge stop                # stop the active charging session
npx evnex schedule show              # the configured charging schedule
```

The resource commands pick the charge point automatically when the account has
only one; otherwise select it with `--charge-point ID`, where `ID` is a charge
point id or part of its name or serial. Add `--json` to `status`, the listings,
and `schedule show` for a machine-readable document on stdout:

```shell
npx evnex status --json
```

`evnex auth mfa enable` is the interactive one-shot: it prints an `otpauth://`
URI (paste it straight into a password manager's one-time password field), the
bare secret, and a QR code, then asks for a code from the new device and makes
TOTP the preferred method. For automation, the same flow is split into
`evnex auth mfa enroll` (print the URI/secret/QR and exit) and
`evnex auth mfa confirm CODE` (verify and enable; `--no-prefer` registers the
device without changing the MFA preference). The QR code renders in the
terminal, or in the browser with `--browser`.

Session tokens are cached (mode 0600, `~/.cache/evnex/tokens.json` by default,
or `EVNEX_TOKEN_CACHE`) so an MFA sign-in is only needed occasionally. The cache
format is interchangeable with `python-evnex`'s. To answer sign-in challenges
from a password manager instead of typing codes — for example with the
[1Password CLI](https://developer.1password.com/docs/cli/) v2+:

```shell
npx evnex auth login --otp-command 'op item get Evnex --otp'
```

## Configuration

| Environment variable         | Default                       | Purpose                                                            |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `EVNEX_CLIENT_USERNAME`      | —                             | Account email, for the CLI and examples                            |
| `EVNEX_CLIENT_PASSWORD`      | —                             | Account password, for the CLI and examples                         |
| `EVNEX_BASE_URL`             | `https://client-api.evnex.io` | API base URL                                                       |
| `EVNEX_ORG_ID`               | first org on the account      | Default organisation for org-scoped calls                          |
| `EVNEX_TOKEN_CACHE`          | `~/.cache/evnex/tokens.json`  | CLI token cache location                                           |
| `EVNEX_COGNITO_USER_POOL_ID` | `ap-southeast-2_zWnqo6ASv`    | Cognito user pool. Only set this to point at a non-production pool |
| `EVNEX_COGNITO_CLIENT_ID`    | Evnex's public app client     | Cognito app client, as above                                       |

The last two exist so the client can be aimed at a test pool. Evnex's own
values are the defaults and are not secret — they are public app-client
identifiers, which is why they can sit in source. Leave both alone unless you
know you need them.

## Examples

`typescript-evnex` is intended as a library, but a few example scripts are
provided in the `examples` folder:

```shell
export EVNEX_CLIENT_USERNAME=you@example.com
export EVNEX_CLIENT_PASSWORD=<your password>

npx tsx examples/getChargePointDetail.ts
```

## Differences from python-evnex

Deliberate deviations from the Python original are tracked, one row per symbol,
in [`PARITY.md`](PARITY.md). The load-bearing ones:

- `asyncio.to_thread` offloading is gone — the AWS SDK and `fetch` are natively
  async in Node, so there is no blocking I/O to move off the event loop.
- `pycognito` is replaced by `@aws-sdk/client-cognito-identity-provider` plus a
  hand-written SRP implementation.
- `pydantic` is replaced by `zod`; the deprecated `NotAuthorizedException`
  module alias is not carried over — catch `EvnexAuthError`.
- **`EvnexChargePointLoadSchedule.timezone` is optional here.** The Python model
  marks it required, but the live API does not send it, so validation fails on
  any response carrying a load schedule. See
  [`foundational/PLAN.md` §10.1](foundational/PLAN.md).
- `EvnexHttpError` carries the response's `x-correlation-id`, which the Python
  client discards. It is the only handle support has on a specific failed request.
- A `sessionEnergyWh()` helper derives session energy from the meter delta —
  the authoritative figure, in watt-hours. `totalEnergyUsage`'s unit is
  undocumented and `totalPowerUsage` is deprecated in Evnex's Enterprise schema.

The API observations behind these come from
[`ev-charging-log`](https://github.com/brianramseyau/ev-charging-log), an
independent implementation verified against a live account.

## Development

```shell
npm ci
npm run lint
npm run typecheck
npm test              # 100% line and branch coverage, enforced per-file
npm run build
```

Coverage thresholds are set to 100 per-file and are part of CI. Exclusions
require an inline comment naming a concrete reason and are audited.

See [`foundational/PLAN.md`](foundational/PLAN.md) for the architecture, the
porting rules every contributor should follow, and the module-by-module map back
to the Python source. See [`RELEASING.md`](RELEASING.md) for how to cut a release.

## Licence

Apache-2.0, the same licence as `python-evnex`. See [`LICENSE`](LICENSE) and
[`NOTICE`](NOTICE) for attribution to the original work.
