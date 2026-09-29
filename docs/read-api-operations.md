# Running and consuming the read API

See [design and security contract](read-api-design.md) and
[agent guide](api-agent-guide.md). Authorized readers have global data access.

## Configuration

Install the locked environment with `uv sync --locked` (or use the existing project
virtual environment). Configure these variables through your local secret manager
or unversioned environment. The application does not load `.env` implicitly.

| Variable | Meaning |
| --- | --- |
| `API_DATABASE_URL` | SQLAlchemy `postgresql+psycopg` URL for a dedicated SELECT-only login |
| `API_ISSUER` | Exact HTTPS issuer, including any trailing slash |
| `API_AUDIENCE` | Dedicated API audience, a single string |
| `API_CLIENT_ID` | Authorized personal public client ID, default `retail-personal` |
| `API_JWKS_URL` | Administrator-configured HTTPS JWKS endpoint; never taken from token headers |
| `API_HOSTS` | Comma-separated exact hostnames, default `localhost,127.0.0.1` |
| `API_ORIGINS` | Comma-separated exact browser origins, default empty |
| `API_SCHEMA` | Application schema, default `public` |

Remote database URLs require `sslmode=verify-full` with the appropriate trusted CA.
Local loopback development can use the Docker PostgreSQL instance without TLS.
Issuer and JWKS URLs always require HTTPS. The service requires RS256 access tokens
with `typ=at+jwt`, `iss`, `aud`, `sub`, integer `iat` and `exp`, a lifetime of at most
86400 seconds, `azp` matching `API_CLIENT_ID`, an integer `auth_time`, and a
space-separated `scope` claim containing `data:read`.
Audit collections additionally require `operations:read`. Configure token claim
mapping at your provider; OIDC support alone does not imply this exact token format.

Use the personal authorization-code/PKCE flow described in
[personal authentication](personal-authentication.md). Scripts stop at expiration
and require fresh credentials; service accounts and refresh tokens are not supported.
JWKS keys cache for five minutes; unknown-key refreshes are throttled
to once per 30 seconds per process. Key rotation should overlap old/new keys and
publish the new key before issuing tokens. Expired/unverifiable tokens fail closed.

## Provision the database login

This is an explicit administrator operation, not an application startup action.
Create a new, dedicated role using an administrative PostgreSQL connection:

```sql
CREATE ROLE api_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
    NOCREATEROLE NOREPLICATION NOBYPASSRLS;
```

Set its password using the administrator's secret provisioning mechanism, for
example the interactive `psql` command `\password api_reader`. Never paste secrets
into SQL committed to Git. The role must have no memberships, no schema ownership,
no CREATE privilege in the application schema, and no write grants. Existing PUBLIC
grants may need an administrator review. Do not grant SELECT on all future tables.

Render the exact grants for review (this command only prints SQL):

```bash
python -m retail_data_platform.api.database --role api_reader --schema public
```

Apply the reviewed output using your administrative connection. It grants USAGE
on the schema and SELECT on explicit columns of the 24 resources. Audit filenames,
hashes and error messages are excluded at the database grant boundary. Set
`API_DATABASE_URL` to the reader login. Startup rejects importer/superuser/owner
credentials, memberships, write access, missing grants and overbroad audit grants.
No schema changes or new migration are required for this API.

Migrate and refresh analytics using the existing administrator/importer workflow.
The API cannot migrate, import or refresh. Unpopulated analytical views return a
generic 503; use `/v1/analytics/status` to inspect freshness.

## Start and deploy

```bash
python -m retail_data_platform.api.app
# The installed equivalent is: retail-api
```

The runner binds `127.0.0.1:8000`, disables URL access logs and forwarded-header
trust, and caps concurrency at 50. The connection pool permits five connections
per worker with a three-second acquisition timeout. Queries use five-second statement
and one-second lock timeouts, with read-only transactions. Each authenticated subject
has a process-local budget of 120 requests per minute; the limiter holds at most
4096 active subject windows and fails closed at capacity. This is not a distributed
rate-limit implementation. Responses are capped at 2 MB after encoding, and a page
contains at most 200 rows; exceptionally large nested rows can still consume memory
before this response cap is applied. Reduce `limit` on a 413 response.

Before exposing the service, configure TLS termination, distributed rate limits,
request/header/body limits, upstream concurrency limits, trusted hosts and exact
browser origins at the ingress. Restrict direct network access to the API and the
database. Size total database connections as workers multiplied by five. Redact
Authorization headers, URL query strings, database bind values and payloads from
proxy/database/monitoring logs. Application request logs contain only generated
request IDs, status codes and duration. Arrange dependency/security update monitoring
and backups in the deployment environment. No external deployment is included here.

`/health/live` and the empty Swagger login shell at `/docs` are public. The health
endpoint is a liveness check, not database readiness.
Startup validates database access; subsequent database failures return 503. OpenAPI
is at authenticated `/v1/openapi.json`; `/redoc` and `/openapi.json` are disabled.

Open `/docs`, paste an access token (without `Bearer`) and select **Load Swagger**.
After validation, Swagger displays the endpoints and **Try it out** can execute
authorized GET requests. **Clear session** reloads the page and discards its state.
The token remains in tab memory only; URL tokens, cookies and browser storage are
not used. Reloading requires a new token entry. Swagger assets load from jsDelivr
with a pinned version and SRI hashes, so browser access to that CDN is required.
The external schema validator is disabled; tokens and API calls stay on this origin.

## Client contract

Send `Authorization: Bearer <access-token>` on every request. Start with
`GET /v1/resources` for resource names, allowed fields, keys, filters and URLs.
Read `GET /v1/openapi.json` for typed schemas, including nested analytical objects.
Operational resources are omitted from the catalog without `operations:read`.
Local Keycloak users need both `data_reader` and `operations_reader` to read the
two operational audit collections; the latter role is not assigned automatically.

Examples of paths (supply identifiers obtained from an authorized stores request):

```text
GET /v1/data/stores?limit=50
GET /v1/data/stores?id=<uuid>
GET /v1/data/analytics_store_month?store_id=<uuid>&period_from=2025-01-01&period_to=2025-12-01
GET /v1/data/store_typology_values?store_id=<uuid>
GET /v1/data/analytics_store_category_month?store_id=<uuid>&period_from=2025-01-01&category_code=<code>
GET /v1/analytics/status
```

Start with `/v1/data/stores` to obtain a store ID. Then query each resource whose
catalog lists `store_id`: observations, activities, typology snapshots and values,
and store/month analytics. Global product, assortment, mapping and quality resources
remain separate; their association with a store is represented in the analytical
candidate and product/month resources, not by a direct store filter on the source table.

Use only filters listed for that resource in `/v1/resources`. Every primary-key
column is filterable, so a complete key selects at most one row. For a `period`
key, set `period_from` and `period_to` to the same first-of-month date. Other
filters include `store_id` and `product_id` where applicable.
For typology values, store filtering follows the snapshot relationship. Nonexistent
IDs produce empty collections. Filters and IDs do not change authorization.
No arbitrary sort, SQL expression, total count, bulk write or export endpoint exists.

A page is `{ "items": [...], "next_cursor": null }`. When `next_cursor` is non-null,
pass it unchanged as `after`, keeping the same resource and filters. Page size may
change. Cursors are typed positions, not credentials or snapshot guarantees. Reads
across requests can observe different import/refresh snapshots. A consistent training
extract needs an externally arranged publication freeze. Dates are ISO 8601, UUIDs
are strings, decimal values (including nested numeric fields) are strings, and null
stays null. Keep quality indicators alongside measures; see monthly-analytics.md.

Errors use `{ "error": "stable_code" }`, with a generated `X-Request-ID` response
header. 401 means missing/invalid token, 403 insufficient scope, 422 invalid filters
or cursor, 413 response too large, 429 request budget exhausted and 503 unavailable
database/identity/capacity. Honor `Retry-After` when present and use bounded backoff.
Do not retry 401/403 indefinitely or put access tokens into URLs or saved notebook cells.

## Verification boundary

Unit tests use ephemeral signing keys and synthetic claims. PostgreSQL tests create
and clean up a dedicated schema and login, apply migrations, initialize synthetic
views and exercise the actual SELECT-only connection and HTTP routes. Set
`TEST_DATABASE_URL` only to a database where isolated test schemas/roles may be created.
The separate local Keycloak smoke script checks real token issuance and role denial
with temporary synthetic users. Production ingress, production load and an external
frontend remain unverified; review deployment configuration before production use.
