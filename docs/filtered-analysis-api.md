# Filtered analysis API

T24B adds seven authenticated GET routes under `/v1/analytics/analysis` over the
published analytical snapshot. They reuse the T24A SQL reader. The existing
28-resource catalog, native collections and T23 global views keep their contracts.
The new projections are discovered through authenticated `/v1/openapi.json`;
they are not extra `/v1/data/*` collections. SaaS consumption remains T24C.

## Requests and publication

All routes require the existing personal `data:read` token and global organisation
read access. Store selection is a query scope, never an authorization boundary.
No new identity, scope, migration, source import or refresh endpoint is introduced.

Common query fields are `scope=all|selection` (default all), repeated `store_ids`
(1–100 distinct UUIDs for selection, forbidden with all), exact `retailer_name`,
`region_code`, `store_format`, `activity_status=all|active|inactive` (default all),
and optional `publication_id`. Names/regions/formats have their database length
limits (128/32/64). Unknown store IDs fail before dimension filtering; an empty
filtered scope is valid. Only `store_ids` may repeat. Extra parameters are rejected.
Returned store IDs are normalized in ascending UUID order.

| Route | Additional request fields | Response model |
| --- | --- | --- |
| `/stores` | Optional `q`, `limit`, `after` | `Page[StoreItem]` |
| `/dimensions` | Required `dimension=retailer_name|region_code|store_format`; optional `q`, `limit`, `after` | `DimensionPage` |
| `/availability` | Optional paired `period_from`, `period_to` | `Availability` |
| `/summary` | Required `period_from`, `period_to`; optional `comparison` | `Summary` |
| `/series` | Same as summary | `Series` |
| `/ranking` | Same as summary, plus optional `sort=revenue|revenue_change`, `direction=asc|desc`, `limit`, `after` | `Page[RankingItem]` |
| `/store-series` | Same as summary, plus optional `limit`, `after` | `Page[StoreSeries]` |

Periods are inclusive first-of-month dates, at most 120 months. Comparison is
`previous` by default or `previous_year`, with equal-length reference windows.
Availability has no requested comparison; a supplied window uses the default
reference in its context. Omit both dates to discover reported availability bounds.
`q` contains 1–128 characters and searches literal name/city text for stores or
literal dimension text for options. `%`, `_` and backslash are escaped, not user
wildcards. Search affects discovery only, never analytical totals.
Omit `q` for an unsearched page; an explicitly empty value is invalid.

Ordinary pages default to 50 with a maximum of 200. Store-series pages default to
six with a maximum of six; no following store's business series is downloaded.
The cursor is at most 8192 characters; the existing 10,000-byte query limit can
constrain the number of UUIDs or cursor/filter combination before these maxima.

Every response contains `context.publication_id`, public freshness, normalized
scope and its requested/resolved/filtered-out/final counts, window, reference and
comparison. Discovery without dates returns null window/reference/comparison.
Measures, dimensions, ID and freshness are read within one read-only repeatable-read
transaction, using the existing statement/lock/idle timeouts and connection pool.

Start without a publication precondition, then retain the returned UUID. Supply
`publication_id` on related reads and always when following `next_cursor`. A new
successful refresh gives `409 publication_changed`, with no business payload from
the replacement publication. Discard dependent results and reload explicitly.
This is a precondition, not a retained historical snapshot. No refresh is started
by a read. An older publication remains readable after import or refresh failure;
freshness says `stale` when the successful import set has changed.

Cursors bind endpoint, publication and a digest of all normalized filters, search,
windows, comparison, sorting and last typed key. Page size may change. They are
base64 JSON, not encrypted or signed and confer no authority. Editing the typed key
can skip rows within the same authorized scope; authentication and scope checks
still apply. Never treat cursors as access credentials or log their content.

## Response projections

The checked-in [models](../src/retail_data_platform/api/analysis_models.py) define
all fields and reject extra fields. Decimal measures and ratios serialize as
strings, counts as integers, UUIDs/dates/timestamps as strings and missing values
as explicit nulls. Ratios are fractions. No operational audit payload, source
identity or raw source row is added to an analytical response.

| Object | Fields and semantics |
| --- | --- |
| `context` | `publication_id`; `freshness` (`state`, `last_completed_at`, `last_attempt_status`); `scope` (scope/filter fields, `store_ids` and four store counts); nullable `window`, `reference` (`start`, `end`, `months`); nullable `comparison` |
| Store | `store_id`, `name`, `city`, `retailer_name`, `region_code`, `store_format`, `is_active`; published dimensions, never the live master |
| Page | `context`, `items`, nullable `next_cursor`; never a page-derived network total |
| Dimension page | Page plus `dimension`, `missing_store_count`; items contain one non-null `value` |
| Measure | `value`, `partial`, `covered_cell_count`, `expected_cell_count`; missing grid cells remain in the denominator |
| Change | `difference`, `ratio`, `reference_state=missing|zero|negative|positive`; zero reference gives null ratio |
| Metric | `current`, `reference` measures; `change`; `cohort` with `store_count`, `excluded_store_count`, `expected_cell_count`, `current`, `reference`, `change` |
| Summary | `context`; `metrics` for revenue, units, calls, field visits and crowdsourced visits; `revenue_per_unit` (`current`, `reference`, `cohort_current`, `cohort_reference`, `cohort_store_count`); global `revenue_contribution_sum` |
| Point | `period`, `reference_period`, five `metrics`; each has current/reference measures, fixed `cohort_store_count`, `cohort_current`, `cohort_reference` |
| Series | `context`, monthly point `items`, at most 120 points; empty scope gives an empty series |
| Ranking item | Store fields; `rank`, current/reference revenue and revenue partials, `current_revenue_covered`, `reference_revenue_covered`, `expected_month_count`, `revenue_change`, nullable `exclusion_reason=missing_month|ambiguous_measure|missing_measure` |
| Store-series item | `store` and its monthly `points`; context store count still describes the entire selected scope |
| Availability | `context` and five dataset `items`: `dataset`, nullable `first_period`/`last_period`, `months` |
| Availability month | `period`, `has_observation`, nullable `source_row_count`, `observed_row_count`, `inferred_absence_row_count`, `observed_store_count`; no source line means null counters, not measured zero |

Cohorts are fixed independently per metric over both entire windows. Revenue/unit
cohort ratios use the intersection of both cohorts. Contributions belong only to
the fixed revenue cohort; their global sum equals that cohort's change. Ranking
runs over the full scope before keyset pagination, with nulls last and UUID ties.
`exclusion_reason` explains exclusion from the comparable revenue cohort, even
when current revenue alone is available for revenue sorting.

Availability bounds include reported observations only. Monthly counts retain
inferred absences separately and count typology parent snapshots before children.
A month with inferred rows alone has source observations but zero reported stores;
this does not establish observed bounds or evidence of source delivery completeness.
No absent month is presented as an unreported delivery failure.

## Errors, limits and operations

Errors use the existing `{ "error": "code" }` format without input values.
The shared `ErrorResponse` model describes 401/403/409/413/414/422/429/500/503
responses in the dedicated routes’ OpenAPI, including sanitized validation errors.
Authentication/scope failures are 401/403. Invalid inputs give 422 (`invalid_request`,
`invalid_query`, `invalid_cursor` or `invalid_analysis_query`). Changed publication
is 409; no initial successful publication or unpopulated view gives 503
`analytics_uninitialized`. SQL failures, timeouts and cancellations give 503
`database_unavailable`; per-subject rate/capacity limits remain 429/503. Encoded
responses beyond the configured cap (default 2 MB) give 413
`response_too_large_reduce_limit_or_window`. Responses retain no-store/nosniff
and a generated request ID, including errors. Logs omit URLs, values and tokens.

The synchronous query adapter does not promise immediate PostgreSQL cancellation
on browser disconnect. Each SQL statement remains bounded by the configured five
seconds; completed or interrupted transactions release their connection. Ingress
concurrency/distributed limits and production load qualification remain necessary.

Apply the existing T24A migration and publish with the matching refresh code.
Generate reviewed grants with the existing grant CLI, then have the administrator
apply them before starting T24B. The SQL permission manifest now contains the two
internal view projections in addition to the 28 resource projections. Startup checks
all 30 relations for exact column readability, no writes or ownership and safe
role flags/memberships. A role provisioned only for T23 fails startup until grants
are extended. The HTTP process never applies those grants or changes the schema.
Older HTTP clients continue to use the same native catalog and collection shapes.

Before schema downgrade, remove T24 consumers and revoke the additional grants;
restore matching older refresh/status code. No live environment is changed by the
tests. Local verification uses isolated synthetic PostgreSQL, including two-page
rankings, seven-store series, refresh during a response, stale/failed publication,
rights, deadlines/cancellation and response/rate limits. The declared profile adds
300 stores × 24 months to the seven-store oracle and records bounded HTTP output
and local elapsed time; it is not production p95 or a concurrent load acceptance.
