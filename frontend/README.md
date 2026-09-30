# Frontend shell

React, strict TypeScript, Vite and Material UI provide the French entry screen
and shared theme from [DESIGN.md](../DESIGN.md). This increment has no
authentication, API calls or business data. Sign-in is intentionally unavailable.
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
without echoing the input. A valid origin still does not enable sign-in or make
requests in this increment. Restart Vite after changing environment settings;
rebuild when changing configuration for a built application.

Vite client configuration is public and may appear in built assets. Never place
tokens, client secrets, passwords or business values in frontend environment
variables. OIDC configuration and its validation will arrive with the sign-in task.

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
| `npm run test:e2e`     | Build and test with Playwright Chromium and axe                  |
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

The harness starts a fresh production preview on `127.0.0.1:4180` and refuses
an occupied port. Tests use isolated contexts at 360, 768 and 1440 pixels. They
exercise the public shell with synthetic inputs, keyboard expansion/collapse,
retained focus, horizontal overflow, empty browser storage and axe checks in both
disclosure states. No backend or identity-provider credentials are needed.
Only the local document and hashed JavaScript/CSS assets may reach the network;
other requests are aborted and fail the test. Future business scenarios must
explicitly fulfill synthetic responses. Browser errors also fail the test.

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
No runtime storage, service worker, external font or telemetry is added here.
MUI uses its MIT-licensed components and Emotion engine; charts and commercial
components are not installed in this increment. Versions are pinned in the
manifest and lockfile; review dependency changes deliberately.
