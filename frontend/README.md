# Frontend shell

React, strict TypeScript, Vite and Material UI provide the French entry screen
and shared theme from [DESIGN.md](../DESIGN.md). Public OIDC configuration enables
personal sign-in with Authorization Code and PKCE. The authenticated store screen
uses the read transport; the unauthenticated entry screen makes no business API calls.
Missing configuration keeps sign-in unavailable.
Loading and render failures have accessible, generic fallback screens.

The store screen loads one cursor page at a time, initially requesting 25 rows.
Checkboxes retain an explicit selection across pages in session memory. “Trier cette
page” sorts only the displayed rows without an API request. Opening a store rereads
its current header by ID; returning preserves the page, sort and selection.
Missing stores and failed reads have explicit states. Logout and expiry remove all
rows and selection. No business IDs enter navigation URLs or persistent storage.
The detail screen validates and displays all published store reference fields on
explicit expansion of the active detailed-data tab. Unknown fields are discarded;
null, zero, false, leading-zero codes and exact decimal strings remain distinct.
The reference describes current attributes independently of the selected period.

The period starts empty. Draft months and applied inclusive months remain separate
in session memory through list/detail navigation. Valid months range from 0001-01
to 9999-12, with a maximum interval of 120 inclusive months. Calendar arithmetic
uses month indexes without timezone conversion. This client limit bounds reads
and makes no claim about available months. The active synthesis tab reads the
existing single-store monthly publication only after Apply; other monthly views
remain subsequent work. Network and comparison actions are unavailable because
their server aggregations are not implemented.

The authenticated screen reads `/v1/analytics/status` once on entry and on an
explicit “Vérifier la fraîcheur” action. It distinguishes current, stale and
uninitialized publications, the latest failed/running attempt, and the last
successful completion (shown in UTC). A failed status read preserves a clearly
qualified last known state, without confirming current freshness. Coverage is
separate and remains unknown; the live reference can be read independently.
This read-only action checks status and never starts an analytical refresh.

Exact decimal helpers use BigInt coefficients and decimal scales for addition,
subtraction and division. Division explicitly rounds half away from zero to six
decimal places by default (caller-selected 0–18); null inputs or a zero denominator
remain unavailable. Displayed published decimals and percentages retain their
exact magnitude without binary-number conversion, currency or HT/TTC assumptions.
Identifiers keep their original text; counts use French separators. Month labels
use calendar strings, without timezone conversion. Helpers bound input/output to
1024 characters and exponent/scale magnitude to 512, rejecting excessive values.
Collection checks discard a batch and its cache when status changes between pages;
a subsequent explicit read loads again, without guaranteeing a database snapshot.
The store synthesis reads only `analytics_store_month` with an explicit store ID
and inclusive applied months. It projects sales, separate activity measures and
product diagnostics, without summing nested category/product/typology detail.
It checks initialization before reading and freshness around the bounded collection
(maximum five pages / 120 rows). Incomplete or changed publications display no
total or inferred missing month; recovery is an explicit read. Decimal bounds
and summary arithmetic are checked before publishing the result, so an excessive
value or combined result stays a local retryable error.

The complete read becomes a grid of expected months. Missing rows and null values
remain unavailable, zero and negative sales remain exact. Every sum states its
own covered/expected months; no valid value means unavailable. Non-ambiguous
reported sales are separate partial diagnostics. Revenue per unit requires all
expected months valid for both measures and nonzero units, with the documented
six-place division precision. Units are not physical volumes; currency and HT/TTC
remain unconfirmed. The live store header is independent of publication attributes.

MUI X Charts Community supplies a revenue curve with straight segments, marked
points, explicit coverage and partial-series labels, theme color and disabled
animation. Only finite plot coordinates use binary numbers; an infinite axis span
is omitted as well. Tooltips and the
scrollable keyboard-accessible table use exact values. Values outside finite
geometry remain in the table with a warning. See the
[MUI line chart contract](https://mui.com/x/react-charts/lines/).
Single-store revenue comparisons are loaded explicitly from the applied period.
`analytics_store_month_changes` supplies current, previous calendar month and
previous-year complete revenue amounts; published ratios are never aggregated.
A second bounded `analytics_store_month` read supplies the chosen reference window:
the k immediately preceding months or both bounds shifted by twelve months.
Each collection is limited to five pages and 120 rows. Initialization and freshness
are checked around both reads; an incomplete collection or changed publication
hides every comparison. Shared month amounts and known M-1/N-1 references are
checked for decimal equality, including overlapping windows. A contradiction
hides the comparison with a local retryable error; equivalent decimal encodings
remain valid and null is distinct from zero. Separate pages/collections, including
the synthesis above,
are not a guaranteed snapshot.

Window totals require every expected month in each period. Differences use exact
subtraction and ratios use six-place decimal division before percentage display.
Zero/missing references make percentages unavailable; negative bases show an
explicit label and the absolute difference without interpreting the percentage.
Reference dates and coverage remain visible. Calendar underflow does not generate
an invalid request. Changing the reference, store, applied period or tab cancels
pending reads and clears old results; draft months do not trigger comparison reads.
No store-network comparison or inferred missing-as-zero value is added.
Other analytics tabs and multi-store comparisons remain later work.

The Données navigation opens a catalogue-driven explorer of business references,
observations and monthly analyses. Public projection metadata is fixed in
`src/published-contract.ts`; catalogue fields, keys and filters must be compatible.
Responses remain bounded by the 2 MB transport limit. Large lists retain all
elements and render in local pages of 50, with first/last-page controls and no
per-element API calls. Published varchar limits and exact-value checks still apply.
Only published fields are retained, including the projected children of current
store, activity, category and typology details. Operational routes remain deferred
to the protected operations screen and are never requested here.

Pagination reads one page of at most 25 rows per action, without deriving totals.
Filters are explicitly applied and carried through opaque cursors. A row opens a
fresh complete-key lookup, including all composite members and exact monthly bounds.
Read cancellation, duplicate-key/cursor rejection, local errors and before/after
freshness checks protect navigation; pages are not a guaranteed snapshot.
Uninitialized analytic collections are unavailable. Reference collections can
still be read with no analytic publication.

`PublishedDetail` renders French labels and technical names, exact decimals,
null/zero and empty text/list distinctions, recursively expandable lists and inert
HTML text. It also serves the store reference. Other store collections are opened
on demand; a fixed store filter comes only from the catalogue and global resources
stay explicitly global. Selection, store page/sort, opened store, monthly drafts and
applied bounds survive navigation through Données in session memory. Leaving each
screen still cancels its reads and unmounts its business results. A rejected later
cursor can be reset to the first page. Expanding evidence ID lists performs no
network reads.
The [coverage manifest](../docs/saas/frontend-coverage.md) documents component/test
associations, including the remaining operational-screen boundary.

The Ventes et produits store tab reads the applied month window only after
catalogue validation. Five pages and 500 cells bound the collection; incomplete
reads show no table/chart and suggest a shorter period or the native explorer.
The exact table paginates by 25 cells. Monthly bars explicitly identify their
subset of at most 20 cells; selecting a source GTIN builds its calendar revenue
line with null/absent months preserved. Unresolved GTINs stay distinct, negative
returns stay visible and physical volumes remain at their original cell grain.
No category filter, store total or cross-product volume total is inferred.
Product IDs belong to the publication; null links may reflect conflicting
attributions as well as unmatched rows. Bar series carry a partial qualifier where
needed. Closing a detail restores its cell trigger or the table after pagination.
Source/measure counts and unique observation IDs are checked for consistency.

Details reuse the published renderer. Observation IDs are opened individually,
and the current product lookup is explicit. All lookups follow the authorized
catalogue and verify identity/freshness; a missing live product is unavailable,
without hiding the published cell. Live evidence is not an immutable snapshot.
Tab/period/session changes unmount data and cancel reads. The tab loads lazily.

The Présence et linéaire store tab reads the applied store/month window from
`analytics_store_category_month` after catalogue validation. Presence and shelf
share have separate calendar lines, exact values and published denominators.
Missing months, null values, declared zeros and inferred absences remain distinct.
Presence describes observed product keys, without a network-distribution or
assortment-compliance claim. Unknown category codes remain literal; physical
shelf units are unknown. Ratios above 100% are retained; no cross-category sums
or averages are calculated.

The distribution-product and shelf-category collections are loaded only on
explicit request, scoped to the selected category. Every collection must be
complete within five pages and 500 cells. Detail tables paginate locally by 25;
all published fields and source identifiers use the shared renderer without
per-ID reads. Freshness changes, incomplete reads and refusals hide values only
in the affected block. Leaving the tab or session cancels reads and removes data.

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
expiry before work starts and after it completes, including rejected work.
Its work callback must publish data only after guarded completion and must not
retain credentials or write an external cache before that check.
The read transport and query service use this boundary; their cache is confined
to the current memory session. The store screen uses this query service.

A timer ends the session at its deadline; focus, visibility changes and page-show
also check expiry after a suspended tab. Page-hide removes credentials and protected
content synchronously before browser caching. A persisted page-show ends the session
and attempts to remove redirect state instead of restoring authentication. Storage
removal is best-effort if browser access throws; memory authority still ends, and
login/exchange fail closed on storage errors. Only an intentional provider
handoff preserves the transient PKCE record across departure. These controls do not
revoke a copied JWT or end the identity provider's own session; a new login still
requests `prompt=login` and `max_age=0`.

Local Keycloak compatibility is verified by the opt-in
[browser/API smoke](../docs/local-identity.md#browser-and-api-integration-smoke).
Deployment compatibility remains unverified. Configure the public client with
the exact redirect, web origin and token-endpoint CORS. Its ID must match the API's
single allowed `API_CLIENT_ID`; do not silently introduce a second client or change
the CLI identity contract. The API remains responsible for validating RS256
`at+jwt`, its audience, `azp`, signed `auth_time` and read permissions. Provider
configuration must enforce credential entry and avoid issuing refresh tokens.
Production callback access logs must omit query parameters; no application log
or telemetry receives callback URLs, tokens or provider error payloads.

## Validated read transport

`ReadApi` takes a validated public API origin and the existing `Session`. It exposes
single GET reads for `/v1/resources`, `/v1/analytics/status` and pages of the fixed
published resource list. Callers provide a runtime row decoder; the initial
`storeSummary` projection validates only the fields required for store selection.
Additional projections must validate every field they consume before use. Catalog
paths are checked but never followed as destinations. Query names, lengths, UUIDs,
monthly dates and page limits are checked before requests. Unsupported filters on
a particular resource remain subject to server validation. Cursors stay opaque.

Requests use the current in-memory bearer only in the Authorization header, omit
cookies/referrers, disable caching and reject redirects. A ten-second abort signal
bounds native fetch; injected test transports must cooperate with cancellation for
prompt settlement. Generation checks also discard results from ignored aborts.
JSON responses require the correct media type and valid UTF-8 and are streamed with
a 2,000,000-byte cap. Pages validate the envelope, requested row bound and every
projected row. Decimals, including scientific notation, and date/timestamp values
stay strings; null does not become zero. Unknown fields are discarded by projections.
No response, token, URL or server error body is attached to application errors.

A current 401 ends the session and aborts sibling work. An old response or error
cannot end a new session or return old data. 403, 422, 413, 429 and 503 have explicit
error codes. `ReadApi` still performs one attempt; the `ReadQueries` service below
owns eligible retries. Network failure and cancellation are distinct.
Consumers must publish only after guarded completion and bind any retained state
to the current session generation; protected components already unmount on logout.
The transport has synthetic unit contract tests and the existing browser regression
suite. The opt-in local browser/API smoke verifies real Keycloak exchange and API
reads on disposable synthetic state; deployed integration and analytical screens remain
unverified.

## Bounded queries and collections

Create one `ReadQueries` service for the document with the configured origin and
existing `Session`, and call `dispose()` when its owner ends. It performs no startup
reads or background refresh. `resources`, `status` and `page` deduplicate identical
work and use a memory-only cache for thirty seconds. Page keys include resource,
normalized query and decoder identity; reuse named decoder functions. Each consumer
receives a clone, so mutations cannot change another consumer or the cache. Explicit
`refresh: true` skips a completed cache entry and still joins identical active work.

Every raw read shares the same session queue: at most two active reads, thirty-two
waiting jobs, a thirty-second queue deadline and sixty departures per rolling minute,
spaced by at least one second. Local rate history survives identity replacement on
that Session object. These conservative limits do not account for other tabs/CLI
clients; the API enforces its shared subject budget. An aborted operation keeps its
active slot until native fetch/body work settles. Non-cooperative custom transports
can block slots but cannot return ended-generation data.

The service permits at most thirty-two distinct jobs and sixty-four consumers per
job. Its cache keeps at most thirty-two entries and 1,000,000 serialized JSON
characters; a projection exceeding 100,000 characters is not cached. These are
retention limits, not a measurement of JavaScript heap bytes. Expiry, logout,
replacement and disposal clear the cache and cancel work. One consumer's cancellation
does not abort another consumer's identical read; the last departure aborts the work.
Cached delivery and cache writes check the current generation. Future screens still
must bind publication of awaited results to their selection and session generation.

Only HTTP 429 and 503 permit automatic retry, at most three transient failures per
page (two extra attempts). Other 5xx, network errors, 401/403/422 and queue failures
have no automatic retry. Valid visible `Retry-After` seconds or HTTP dates are honored;
an absent, CORS-hidden or invalid header uses one then two seconds. A delay exceeding
ten seconds returns the error for manual retry instead of waiting less than requested.
Backoff does not hold an active read slot and stops on cancellation.

On 413 or the response byte cap, page limit is halved to one, with filters/cursor
unchanged. A page reports its actual `limit`; the transient counter is not reset by
reductions. There are at most ten attempts per page, including reductions and retries.
Persistent failure at limit one is explicit. No indefinite reduction loop exists.

`collect` is an explicitly requested bounded batch, not a network-wide extraction.
It permits at most five pages, 1,000 projected rows and twenty-four total attempts,
including freshness reads before/after, reductions and retries. Smaller `maxPages`
or `maxItems` are allowed. Opaque cursors preserve filters; empty or repeated cursors
and empty pages advertising another page fail. Reduced limits carry to later pages.
Batches deduplicate while running but are not cached. The result includes `complete`,
`reason`, `nextCursor` and actual `attempts`; callers must not treat partial items as
a definitive total/KPI. A changed freshness response discards the batch and invalidates
cached values, preventing older work from repopulating that cache. An unchanged
freshness response does not establish a database snapshot. Neither this service nor
business data screens are wired into the entry screen yet.

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
MUI uses its MIT-licensed components and Emotion engine. MUI X Charts Community
is installed for the store synthesis; commercial components are not installed.
Versions are pinned in the manifest and lockfile; review dependency changes
deliberately.
