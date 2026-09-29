# Personal login for scripts and notebooks

Access requires an interactive personal login. Sessions last at most 24 hours,
with no automatic renewal, no stored password, no refresh token and no service
account. The identity provider owns the username/password form. This client never
collects or forwards a password. An optional [local Keycloak service](local-identity.md)
can be started separately; no application realm or user is created automatically.

## Configure the provider

For Keycloak, create a dedicated public OpenID Connect client `retail-personal`:

- Client authentication OFF; Standard flow ON; PKCE S256 required.
- Direct access grants, implicit flow, service accounts and token exchange OFF.
- Exact redirect URI: `http://127.0.0.1:8765/callback`. No wildcard redirects.
- Access token signature RS256, header type `at+jwt`, lifespan 86400 seconds.
- Use Refresh Tokens OFF (`use.refresh.tokens=false`); do not grant offline access.
- Keep the `iss` parameter in authorization responses enabled. The callback checks it.
- Use a username/password browser authentication flow; disable silent external SSO
  or passwordless alternatives if explicit password entry is required by policy.
- Grant `data:read` only to approved personal users, through a role-restricted client
  scope. Include that scope in the access token. Do not grant it to every realm user.
- Configure an Audience mapper with the single custom audience `retail-api`. Avoid
  additional audiences from default client scopes. `aud` must be a string, not an array.
- Keep the built-in `basic` client scope: it supplies `sub` and `auth_time`.
  If customizing it, map User Session Note `AUTH_TIME` to `auth_time` with JSON
  type `long`, included in the access token.
- Include the provider-derived numeric `auth_time` in the access token and retain
  `azp` equal to `retail-personal`. Never derive auth_time from an editable user attribute
  or a constant mapper: it must represent the actual password authentication time.

Evaluate the generated token using Keycloak's client-scope evaluation tools before
connecting the API. The API requires signed `iss`, `aud`, `sub`, `iat`, `exp`,
`auth_time`, `azp` and `scope` claims. Token issuance must be within 60 seconds of
authentication, its lifetime no more than 86400 seconds, and authentication no older
than 86400 seconds. Configure prompt/max-age handling and actual credential entry at
the provider; the API trusts its signed authentication claims. Missing personal
claims and tokens for other clients are rejected. Previous technical-client tokens
are no longer accepted by this contract.

The CLI sends `prompt=login` and `max_age=0` on every login, together with random
state and PKCE S256. The provider must honor these parameters and require fresh
credentials. A token response containing a refresh token is rejected entirely.
No ID token is stored or used as an API credential. The CLI requests the optional
`operations:read` scope, but the provider grants it only to users separately
assigned the `operations_reader` role. Other readers remain restricted to
`data:read`; the API checks the scope before returning audit collections.

Provider configuration remains an administrative prerequisite outside the optional
local Keycloak stack. The local stack has been exercised with disposable synthetic
users and verifies both role-gated access and denial, but no personal user or
production identity service is provisioned automatically. References:
[Keycloak administration](https://www.keycloak.org/docs/latest/server_admin/),
[OIDC endpoints](https://www.keycloak.org/securing-apps/oidc-layers),
[Keycloak client attributes](https://www.keycloak.org/docs-api/latest/javadocs/constant-values.html).

## Local configuration

Install dependencies with `uv sync --locked`. Supply these values through the local
unversioned environment (example issuer only):

```dotenv
API_ISSUER=https://identity.example.test/realms/retail
API_AUDIENCE=retail-api
API_JWKS_URL=https://identity.example.test/realms/retail/protocol/openid-connect/certs
API_CLIENT_ID=retail-personal
AUTH_AUTHORIZATION_URL=https://identity.example.test/realms/retail/protocol/openid-connect/auth
AUTH_TOKEN_URL=https://identity.example.test/realms/retail/protocol/openid-connect/token
AUTH_API_URL=http://127.0.0.1:8000
AUTH_CALLBACK_PORT=8765
```

The identity endpoints require HTTPS with valid certificates. API access requires
HTTPS except for loopback development. The callback binds only `127.0.0.1`; register
its exact port/path at the provider. A busy callback port fails the login. The
browser must run on the same machine as the CLI. Headless/remote notebook hosts
need a separate, explicitly designed flow; do not expose the callback publicly.

The client does not need `API_DATABASE_URL`. The API server still needs its dedicated
SELECT-only database login and the same identity/client settings. The client does
not load `.env` implicitly; export your trusted local configuration before using it.

## Commands

```bash
retail-auth login
retail-auth status
retail-auth get '/v1/data/stores?limit=20'
retail-auth logout
```

If the entry point is not installed yet, use the project's Python:

```bash
.venv/bin/python -m retail_data_platform.personal_auth.cli login
```

Login opens the provider's browser page and waits at most three minutes. A successful
login verifies the access token and stores it in the native OS credential vault.
Starting another login removes the previous local session. Status never prints a
credential. The read command automatically obtains the stored token and only accepts
relative `/v1/` paths. HTTP redirects are not followed with credentials.

An expired/missing/invalid session or HTTP 401 clears the saved session and fails
with exit code 2, instructing the user to run `retail-auth login` again. No script
opens a login page automatically, requests a refresh token or retries login. Other
configuration, vault, provider or HTTP failures exit with code 1 and a redacted error.
A script running beyond expiry must stop and be restarted after a personal login.

For Swagger, explicitly run `retail-auth token`, then paste the result into `/docs`.
This command intentionally prints the bearer token; do not capture it in logs or
saved notebook output. Ordinary scripts should use `get` or the Python client below.
Swagger still uses its existing token-entry interface; this change does not add a
second browser OAuth client or a local credential endpoint to the API.

## Python scripts and notebooks

```python
from retail_data_platform.personal_auth.client import PersonalClient

with PersonalClient() as api:
    page = api.get('/v1/data/stores', params={'limit': 20}).json()
    # Process page locally; the client attaches the personal token automatically.
```

`LoginRequired` means the script must stop for a new interactive login. The client
validates the saved token before every request; it never stores it in project files,
notebooks or environment variables. The vault entry is isolated by issuer, audience,
client ID and API URL. No plaintext fallback is supported: macOS Keychain, Windows
Credential Manager or Linux Secret Service must be available. The OS can request
vault access/unlock permission; run scripts in the same authorized OS user session.

Logout removes this local credential only. It does not revoke an already copied
JWT or close the provider's browser session; copied tokens remain usable for up to
24 hours after authentication. A subsequent CLI login still requests fresh credentials.
Tokens and API data must not be sent to external models/services without authorization.

## Verification

Tests use synthetic signing keys and a test-only in-memory vault. They cover PKCE,
state/issuer validation, code exchange, refusal of refresh tokens, personal claims,
expiry, request destination restrictions, HTTP 401 and CLI exit behavior. The opt-in
`TEST_AUTH_LOOPBACK=1` test exercises a real loopback HTTP callback with a synthetic
browser/provider. The separate local Keycloak smoke script tests a real provider
with temporary synthetic users, and deletes them afterward. Native-vault integration
and a personal login on each target OS remain deployment checks. Tests do not read
or write personal credentials.
