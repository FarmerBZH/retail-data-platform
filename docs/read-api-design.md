# Read API security and client contract

The read API contract grants global access to authorized readers; store
filters are navigation, not authorization. There is no tenant or store ACL model.
Implementation and verification status are recorded in [architecture.md](architecture.md).

## Identity and trust boundary

The FastAPI application uses SQLAlchemy Core and PostgreSQL mappings.
It is an OAuth2 resource server, not an identity provider. It accepts signed
JWT access tokens from one configured issuer and JWKS endpoint, for one exact API
audience. Only RS256 is allowed. Signature, issuer, audience, expiry, issued-at,
not-before (when present), subject, access-token type and scope are checked.
It requires `typ=at+jwt`, a `data:read` scope and a token lifetime at most 24 hours,
the configured personal client in `azp`, and an integer `auth_time`. It enforces a
24-hour deadline from authentication.
Tokens must have been issued within 60 seconds of that authentication.
Do not accept ID tokens, passwords, query-string tokens, unsigned JWTs or shared
browser API keys. The issuer must map its access tokens to this contract.

All access follows a personal Authorization Code with PKCE login. Scripts and
notebooks reuse that personal access token until expiry and then stop for a new
login. No client credentials flow or automatic token renewal is supported. The
provider must require fresh username/password authentication for each login. No
client secret belongs in browser code, a notebook committed to Git, a prompt, or
an agent tool definition.
The personal client stores only the access token and deadline in the native OS
vault. It requests no offline access and rejects refresh-token responses.
This API validates self-contained JWTs without introspection. Revoking a provider
session or deleting the local vault entry does not revoke an already issued token;
it remains valid until expiry unless its signing key is withdrawn.

All business rows and personnel fields are available to `data:read` principals.
Grant that scope only to clients entitled to the entire dataset. Operational audits
additionally require `operations:read`, issued only to users with the dedicated
provider role. Source filenames, source hashes and raw
failure messages are never API output. Data returned to agents is untrusted content,
not instructions; API authorization does not authorize sending it to another service.

## Resource and query contract

Routes are versioned under `/v1`. An explicit, checked-in registry exposes all 13
base tables and 11 analytical views. New model columns cannot become public implicitly.
The authenticated resource catalog describes columns, grain and supported filters.
Typed OpenAPI response models are generated for each resource. Protected OpenAPI is the
machine contract for frontend, agents and notebooks. `/docs` is a public Swagger
authentication shell containing no schema; the browser must supply a valid token
to fetch OpenAPI and execute reads. Tokens stay in memory, with no persistence.
The API offers no arbitrary SQL, joins, expressions, sorts, writes or refresh routes.

Every collection uses stable ascending primary-key order, keyset pagination,
`limit` 1..200 (default 50), and an opaque `after` cursor. Read at most limit+1
rows; do not compute unbounded total counts. Cursors contain only typed keys and
request context, confer no authority, and are not encrypted. Authorization is
rechecked on every page. Unknown/duplicate query parameters are rejected. Every
primary-key column is filterable; explicit filters also cover store, product and
monthly interval where applicable.
Unsupported filters fail rather than being silently ignored.

Business decimals serialize as strings; dates/timestamps use ISO 8601; UUIDs use
strings; missing values remain null. Preserve analytical ambiguity and coverage
fields. Never aggregate ratios or join independent fact grains into inflated totals.
Global analytical views are accessible directly, optionally filtered by month/store.
Large ML extracts iterate pages. Pages are separate snapshots: imports or analytical
refreshes between pages may change results. This is not a reproducible export API;
freeze publication externally for a consistent dataset. See monthly-analytics.md.

## Database and service boundaries

Use a separate PostgreSQL login with SELECT grants only on the registry's columns,
USAGE on the application schema, no ownership, no role memberships, and no elevated
role flags. Do not reuse ingestion credentials. Validate privileges at startup.
Provisioning grants is an explicit administrative operation, separate from schema
migrations and the HTTP process. Never apply default grants to future tables.

Each request uses a read-only transaction, fixed search path, statement/lock/idle
transaction timeouts, bound SQL parameters and a bounded connection pool. Startup
fails closed on unsafe configuration or privileges. Authentication and parameter
validation precede opening a query connection. No database connection per row.
Bound encoded response size as well as page length; nested JSON can be large.

Require TLS at the ingress and TLS verification for remote PostgreSQL. The local
runner binds loopback. Configure exact trusted hosts and exact CORS origins;
credentials/cookies are not enabled. Ingress must enforce distributed rate limits,
header/request limits and concurrency caps before production exposure. Application
limits supplement ingress protection; they do not claim distributed DoS prevention.
Disable access logs containing raw URLs, configure redaction at the ingress/database,
and never log tokens, claims, SQL parameters or returned values. Responses are
no-store and nosniff. Generate request IDs server-side; errors expose stable codes,
not exceptions, connection strings, SQL, validation inputs or private data.

## References

- [OAuth2 security best current practice](https://www.rfc-editor.org/rfc/rfc9700.html)
- [JWT access token profile](https://www.rfc-editor.org/rfc/rfc9068.html)
- [PyJWT validation](https://pyjwt.readthedocs.io/en/stable/usage.html)
- [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/)
- [PostgreSQL connection settings](https://www.postgresql.org/docs/18/runtime-config-client.html)
