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

| Script                 | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `npm run dev`          | Loopback development server                              |
| `npm run format`       | Format frontend source and configuration                 |
| `npm run format:check` | Check formatting without editing                         |
| `npm run lint`         | ESLint, no warnings accepted                             |
| `npm run typecheck`    | Strict TypeScript including tests and Vite configuration |
| `npm test`             | Run Vitest and Testing Library tests once                |
| `npm run test:watch`   | Interactive test loop                                    |
| `npm run build`        | Typecheck and production build in ignored `dist/`        |
| `npm run preview`      | Inspect the built shell on loopback, default port 4173   |

Run format check, lint, typecheck, tests and build before proposing a change.
Tests cover keyboard access to the explanation, disabled sign-in, configuration
validation/redaction, loading feedback and render failure recovery. All inputs
are synthetic. No identity-provider integration is claimed by these tests.

The dedicated browser harness and CI are task T02; production CSP and hosting
checks are later tasks. Vite dev/preview are local tools, not production servers.
No runtime storage, service worker, external font or telemetry is added here.
MUI uses its MIT-licensed components and Emotion engine; charts and commercial
components are not installed in this increment. Versions are pinned in the
manifest and lockfile; review dependency changes deliberately.
