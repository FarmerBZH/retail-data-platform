# Local Keycloak identity service

This optional local stack runs Keycloak and a separate PostgreSQL database. It
does not contain or access the commercial dataset. The services bind only to
`127.0.0.1`; no identity port is published on the LAN. It uses a fixed Keycloak
image version and a separate Docker volume for repeatable startup.

## First start

From the repository root:

```sh
sh scripts/init-local-identity.sh
docker compose -p retail-identity -f compose.identity.yaml up -d
```

The init script creates `.env.identity.local` with random database and bootstrap
administrator passwords, and `.env.identity.local-certs/` with a self-signed
certificate for `localhost`. These paths match the existing `.env.*` ignore rule.
Keep the files private; do not copy them into issues, logs, commits or notebooks.
The script refuses to replace existing identity files. Keycloak stores its users,
configuration and signing keys in the `identity_database_data` Docker volume.

Keycloak is at `https://localhost:8443`. A browser initially distrusts the locally
generated certificate. Verify its fingerprint with `openssl x509 -in
.env.identity.local-certs/tls.crt -noout -fingerprint -sha256` and trust this
specific localhost certificate in your local operating-system trust store. On
macOS, the following command installs it in your login keychain and may prompt
for approval:

```sh
security add-trusted-cert -r trustRoot \
  -k "$HOME/Library/Keychains/login.keychain-db" \
  .env.identity.local-certs/tls.crt
```

Do not disable TLS verification in the API or CLI. Python tools can use the
certificate as a local trust anchor:

```sh
export SSL_CERT_FILE="$PWD/.env.identity.local-certs/tls.crt"
curl --cacert .env.identity.local-certs/tls.crt \
  https://localhost:8443/realms/master/.well-known/openid-configuration
```

The bootstrap username is `local-admin`. Read its generated password directly
from `.env.identity.local` in a private terminal. Do not paste the password into
commands that may be saved in shell history. Create a permanent administrator,
enable strong administrator authentication, and retire the temporary bootstrap
account after configuration.

## Application realm and personal account

Provision the local realm and client once:

```sh
.venv/bin/python scripts/configure-local-identity.py
```

The script creates realm `retail`, public client `retail-personal`, roles
`data_reader` and `operations_reader`, their optional `data:read` and
`operations:read` scopes, and the `retail-api` audience. The
client uses Authorization Code with PKCE S256, a 24-hour access token, no refresh
token and the exact loopback callback. It does not create a personal user. If the
realm already exists, the script refuses to overwrite it. The live smoke test
creates two fully synthetic users, checks both allow and deny cases against the
API token verifier, then removes both users:

```sh
.venv/bin/python scripts/smoke-local-identity.py
```

For a realm provisioned with the earlier 30-minute setting, update only its
token and SSO session lifespans:

```sh
.venv/bin/python scripts/update-local-identity-session.py
```

The update refuses unfamiliar existing policies. A token already saved in the OS
vault keeps its original expiry; run a new personal login to receive 24 hours.

For a realm created before the optional audit scope existed, add it without
assigning any user:

```sh
.venv/bin/python scripts/configure-local-operations.py
```

To create your own user, open `https://localhost:8443/admin/master/console/`,
sign in as `local-admin`, then select realm `retail` in the realm selector. Check
that the page address ends in `#/retail/users` before clicking **Add user**; a
user created under `#/master/users` belongs to the administration realm and
cannot be assigned the `retail` realm role. Open **Users → Add user**, enter a
username, first name, last name and your email, and save. Under **Credentials**,
set a strong password with **Temporary** disabled.
Under **Role mapping → Assign role**, select the realm role `data_reader` and
assign it. Create personal users only in `retail`, not the `master` realm. Keep
their passwords out of project files and scripts. Only users with that role may
receive the `data:read` scope. To read the two operational audit collections,
also assign `operations_reader` to that user. The client requests the optional
`operations:read` scope, but Keycloak includes it only for holders of this role.

In a fresh terminal at the repository root, load the public local OIDC settings:

```sh
source scripts/local-identity-env.sh
.venv/bin/retail-auth login
```

The command opens the Keycloak login page. Enter your personal username and
password there. It saves the access token in the native OS vault for at most 24 hours.
Run `.venv/bin/retail-auth status` to check the session; an expired token requires another
personal login. The CLI prints neither password nor token during ordinary login.
The API also needs its dedicated SELECT-only PostgreSQL role and `API_DATABASE_URL`
before it can serve requests; see [API operations](read-api-operations.md).

The local issuer is `https://localhost:8443/realms/retail`. The same value must
be used by the API and CLI. The discovery endpoint at
`https://localhost:8443/realms/retail/.well-known/openid-configuration` publishes
the authorization, token and JWKS URLs. The local shell script supplies them
without storing secrets.

For status or a restart:

```sh
docker compose -p retail-identity -f compose.identity.yaml ps
docker compose -p retail-identity -f compose.identity.yaml up -d
```

The main project `compose.yaml` is separate. Do not run `down -v` for the identity
stack: that deletes its users, configuration and signing keys.

## Browser and API integration smoke

Run the opt-in browser smoke from the repository root on a POSIX system with Node 24.15+ on PATH,
the locked Python/frontend dependencies and Playwright Chromium installed. The
local identity stack above must be running. Supply `TEST_DATABASE_URL` through
your private shell configuration: a local PostgreSQL administration connection
using `postgresql+psycopg`, with permission to create/drop a test schema and role.
Do not paste a credential-bearing URL into shared output or versioned files.

```sh
.venv/bin/python scripts/smoke-browser-identity.py
```

The runner uses the ignored local identity certificate and administrator settings.
It creates a new realm, two synthetic users, an exact web callback/origin and the
existing CLI callback on the same public client ID. It leaves the existing application
realm, clients, users, API configuration and native credential vault untouched.
It migrates a unique disposable schema and grants a unique role only the existing
API SELECT projections. It starts the real API on loopback port 8181 and Vite on
4181; occupied ports fail rather than reusing another service.

Chromium uses the production entry screen and OIDC code; a test-only in-page closure
then exercises the real `ReadQueries`/decoder modules against two synthetic store
pages. Tokens remain inside the page and are never returned to the runner. Synthetic
passwords reach the browser through stdin and only populate the provider's login form.
The rendered store list also retains a checkbox selection through opening a current
store summary and returning, and removes its rows after logout.
No traces, screenshots, videos, browser storage state or business output are saved.
Python verifies TLS with the local certificate; Chromium trusts only its SPKI pin
for this disposable context, without a global certificate-ignore option.

The smoke verifies PKCE/prompt/max-age, cross-origin code exchange, cleared callback
and redirect storage, API pagination, refusal without `data:read`, API CORS refusal,
HTTP 400 for an unregistered callback, and logout. The original CLI request builder,
token validator and test memory vault also read this API. Separately generated real
signed tokens for a wrong client, wrong audience and one-second expiry receive 401.
The API's existing unit tests cover the RS256, `at+jwt`, `azp` and `auth_time` guards;
the valid real-provider reads exercise those guards together without replacing them.

All child services are stopped and the temporary realm/users/schema/role are removed
in cleanup, including ordinary test failures. Final success requires completed cleanup.
The browser runner has a bounded deadline and its process group is included in cleanup;
descendants are terminated even if the parent has already exited. A failed service
stop does not skip the remaining service or identity/database cleanup attempts.
A hard process kill or unavailable dependency during cleanup can leave temporary
resources; retain the local administrative ability to inspect and remove them.
This local recipe does not validate a deployed provider, native OS vault or rendered
analytical screens, and does not run automatically in the synthetic browser suite.

## Moving to a server later

Keep the identity database separate and back it up before moving it. Restore it
with the same Keycloak version first, then change `KC_HOSTNAME` to the real HTTPS
identity domain and replace the localhost certificate with a trusted production
certificate. Publish Keycloak only through a hardened HTTPS ingress and restrict
the administration interface. Replace the local environment file with a proper
secret store. Never expose PostgreSQL to the public Internet.

Changing the identity hostname changes the OIDC issuer. Update the API and client
issuer, JWKS, authorization and token URLs, then require users to log in again.
Existing localhost access tokens are not valid for the new issuer. Review the
[Keycloak production guide](https://www.keycloak.org/server/configuration-production),
[container guide](https://www.keycloak.org/server/containers) and
[database guide](https://www.keycloak.org/server/db) before deploying. A free VM
may be adequate for testing but is not an availability guarantee.
