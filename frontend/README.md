# Frontend shell

React, strict TypeScript, Vite and Material UI provide the French entry screen
and shared theme from [DESIGN.md](../DESIGN.md). Public OIDC configuration enables
personal sign-in with Authorization Code and PKCE. No business API calls or data
screens are implemented yet; missing configuration keeps sign-in unavailable.
Loading and render failures have accessible, generic fallback screens.

## Run locally

Use Node 24.15 or a later Node 24 release and npm. `.nvmrc` selects the verified
runtime when using nvm. From this directory:

```sh
nvm use
npm ci
npm run dev
```

The development server binds to loopback at `http://127.0.0.1:5173` and refuses
to silently choose another port. The frontend package and Vite filesystem allow
list are limited to this directory; the repository's private environment files
are not frontend configuration.

No configuration is required to inspect the shell. Missing configuration shows
an explicit unavailable state. To exercise the configured state, optionally create
an ignored `frontend/.env.local` containing only this public setting:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Only an HTTPS origin (or HTTP loopback for development) is accepted, without
credentials, path, query or fragment. Invalid values produce a generic message
without echoing the input. An API origin alone does not enable sign-in.
Restart Vite after changing environment settings;
rebuild when changing configuration for a built application.

Vite client configuration is public and may appear in built assets. Never place
tokens, client secrets, passwords or business values in frontend environment
variables.

## Personal OIDC sign-in

Configure these public values alongside the API origin:

```dotenv
VITE_OIDC_ISSUER=https://identity.example.test/realm
VITE_OIDC_CLIENT_ID=synthetic-web
VITE_OIDC_REDIRECT_URI=http://127.0.0.1:5173/oidc/callback
```

The redirect must be exactly the current origin plus `/oidc/callback`, with no
query, fragment or wildcard. The issuer uses HTTPS (HTTP loopback is allowed only
for local development). Discovery must advertise S256 and authorization, token
and JWKS endpoints on the issuer origin. Discovery, token and JWKS fetches omit credentials/referrers,
disable caching, reject HTTP redirects and time out after ten seconds.
Top-level authorization navigation and provider cookies remain provider-controlled.

The MIT-licensed, pinned `oauth4webapi` library handles PKCE and protocol validation.
Every login requests `openid data:read`, `prompt=login`, `max_age=0`, state and nonce.
The callback requires an exact issuer and matching state; it is consumed before
network activity and its URL is immediately replaced with `/`. ID tokens require
RS256, valid issuer/audience/nonce/time claims and a valid JWKS signature. An
authentication time more than sixty seconds before issuance is rejected. Token
responses require Bearer, explicit `data:read`, and a processed integer lifetime from one
second to 24 hours. Any refresh-token field is rejected; there is no silent login,
refresh, userinfo request or arbitrary return destination.

Only state (including creation time and configuration binding), nonce and the PKCE
verifier pass through `sessionStorage` during redirection. The transaction expires
after ten minutes and is deleted on return, failure, a new attempt, or re-entry
after expiry. A page away at the provider cannot actively erase storage; expired
state is never accepted when the app executes again. The access token stays only
in memory; the ID token is never retained or sent to the API. Reload requires a new
login. Session expiry and logout remove the authenticated screen and restore focus
on the sign-in action. The success screen confirms OIDC validation, not API authorization.

Each session has an in-memory generation and cancellation signal. Expiry, logout,
a new login and document departure invalidate the previous generation. Pending OIDC
fetches are aborted, and even responses that ignore abort cannot establish an old
session. Protected components are unmounted and their local state is reset.
The `Session.run` boundary rejects results from an ended generation and checks
expiry before work starts and after it completes; future API transport must use it.
Its work callback must publish data only after guarded completion and must not
retain credentials or write an external cache before that check.
No business transport or business cache exists yet (T05/T06).

A timer ends the session at its deadline; focus, visibility changes and page-show
also check expiry after a suspended tab. Page-hide removes credentials and protected
content synchronously before browser caching. A persisted page-show ends the session
and attempts to remove redirect state instead of restoring authentication. Storage
removal is best-effort if browser access throws; memory authority still ends, and
login/exchange fail closed on storage errors. Only an intentional provider
handoff preserves the transient PKCE record across departure. These controls do not
revoke a copied JWT or end the identity provider's own session; a new login still
requests `prompt=login` and `max_age=0`.

Real provider compatibility is unverified (T07). Configure the public client with
the exact redirect, web origin and token-endpoint CORS. Its ID must match the API's
single allowed `API_CLIENT_ID`; do not silently introduce a second client or change
the CLI identity contract. The API remains responsible for validating RS256
`at+jwt`, its audience, `azp`, signed `auth_time` and read permissions. Provider
configuration must enforce credential entry and avoid issuing refresh tokens.
Production callback access logs must omit query parameters; no application log
or telemetry receives callback URLs, tokens or provider error payloads.

## Package scripts

| Script                 | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run dev`          | Loopback development server                                      |
| `npm run format`       | Format frontend source and configuration                         |
| `npm run format:check` | Check formatting without editing                                 |
| `npm run lint`         | ESLint, no warnings accepted                                     |
| `npm run typecheck`    | Strict TypeScript including tests and Vite configuration         |
| `npm test`             | Run Vitest and Testing Library tests once                        |
| `npm run test:watch`   | Interactive test loop                                            |
| `npm run build`        | Typecheck and production build in ignored `dist/`                |
| `npm run preview`      | Inspect the built shell on loopback, default port 4173           |
| `npm run test:e2e`     | Build synthetic configuration and test with Chromium and axe     |
| `npm run check`        | Run formatting, lint, types, unit tests, build and browser tests |

Run format check, lint, typecheck, tests and build before proposing a change.
Tests cover keyboard access to the explanation, disabled sign-in, configuration
validation/redaction, loading feedback and render failure recovery. All inputs
are synthetic. No identity-provider integration is claimed by these tests.

## Browser checks and CI

Install the Chromium revision selected by the lockfile once after `npm ci`:

```sh
npx --no-install playwright install chromium
npm run check
```

The harness builds the same application with explicit synthetic configuration in
ignored `dist-e2e/`, ignoring local environment files, then starts a fresh preview
on `127.0.0.1:4180` and refuses
an occupied port. Tests use isolated contexts at 360, 768 and 1440 pixels. They
exercise the public shell with synthetic inputs, keyboard expansion/collapse,
retained focus, horizontal overflow, empty browser storage and axe checks in both
disclosure states. No backend or identity-provider credentials are needed.
The default fixture allows only the local document and JavaScript/CSS assets;
other requests are aborted and fail the test. Future business scenarios must
explicitly fulfill synthetic responses. OIDC scenarios intercept only their
synthetic discovery, authorization, token, JWKS and callback routes. Keys are
generated per fixture, and tests exercise the real library without production
bypasses. Browser errors also fail the test. `npm run check` separately builds the
normal production configuration before these scenarios; test providers are never
imported by the application.

Tracing, video and screenshots are disabled. Generated test results are ignored;
the workflow does not upload them. Do not use personal sessions, real data,
credential storage states or private environment configuration in tests.
Automated axe checks do not establish complete accessibility conformance.

[Frontend quality](../.github/workflows/frontend.yml) runs locked installation,
Chromium installation and the same `npm run check` on GitHub pushes and pull
requests affecting the frontend or workflow. It has read-only repository
permissions, no persisted checkout credentials, secrets or deployment. Local
execution does not establish that the hosted job has run or that branch protection
is configured. Production CSP and hosting checks are later tasks.
Vite dev/preview are local tools, not production servers.
No token storage, service worker, external font or telemetry is added here.
MUI uses its MIT-licensed components and Emotion engine; charts and commercial
components are not installed in this increment. Versions are pinned in the
manifest and lockfile; review dependency changes deliberately.
