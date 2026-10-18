# Monthly store analytics

## Contract

`analytics_store_month` has one row per `(store_id, period)`. `period` is the first
calendar day of the month. The spine contains every current store, including
inactive stores, for every month between the earliest and latest period in the
six dated datasets. Empty sources produce no months. The spine is an analytical
calendar, not evidence that a store existed, was open, or was covered in a month.

These are indexed PostgreSQL materialized views over the imported tables. All
seventeen results (fifteen public and two internal) are refreshed in dependency order and published in one transaction
from a repeatable-read source snapshot. Reads reuse stored results. Unique indexes
enforce each grain; period indexes support monthly selection across stores.
The previous successful snapshot remains readable during subsequent concurrent
refreshes. A first refresh initializes the views; querying an uninitialized view
raises a PostgreSQL error rather than returning a misleading empty result.

Imports and analytical publication are separate transactions. Run a refresh after
the final successful import in a bundle, or opt in with `--refresh-analytics` on
that import. There is no background scheduler. Imports replace source datasets,
and refreshes replace the analytical snapshot: prior analytical versions are not
retained. Use a read-only repeatable-read transaction when several queries must
share the same published snapshot.

The four network summaries and their coverage contract are documented in
[Network analytics](network-analytics.md).

## Relations and detail

| View | Grain | Purpose |
| --- | --- | --- |
| `analytics_store_month` | Store, month | Scalar commercial metrics, current store attributes, nested activity/category/typology detail |
| `analytics_register_product_month` | Store, month, source GTIN | Revenue, units, volume, source kinds, ambiguity and source observation IDs |
| `analytics_activity_month` | Store, month, activity type | Calls and each visit type, independently reconciled |
| `analytics_distribution_product_month` | Store, month, category, product key | Observed presence and inferred absences |
| `analytics_shelf_category_month` | Store, month, category | Company measure, total measure and their ratio |
| `analytics_typology_month` | Source typology value | Historical snapshot attributes and candidate rank rules |
| `analytics_assortment_candidates` | Store, month, assortment row | Unambiguous exact-rank candidate membership |
| `analytics_retailer_assortment_month` | Store, month, assortment row | Broader context at historical retailer level, including unsegmented/unmapped assortments |
| `analytics_store_category_month` | Store, month, category | Presence, shelf share and exact assortment candidate counts |
| `analytics_monthly_link_quality` | Dataset, month, store match status | Attribution coverage, including unresolved/conflicting stores |
| `analytics_store_month_changes` | Store, month | Previous calendar month/year revenue and change ratios, previous-month activities and units |

All store relationships use existing matched `store_id` values. Unmatched stores
are not assigned to synthetic identities. Their observations remain in the base
tables and their counts appear in `analytics_monthly_link_quality`.

Each fact is aggregated independently before joining the store-month spine.
Joining raw sales, visits, distribution and shelf observations directly would
multiply rows. Likewise, do not sum store-month revenue after joining it to a
product or category detail view without restoring the original grain.

`observation_ids` links detail rows back to their respective source table using
`id = ANY(observation_ids)`. This preserves access to all source fields, including
reported price/change ratios, labels and match methods. Product attributes are
available through `product_id = products.id`. Typologies retain `snapshot_id` and
`typology_value_id`; assortment candidates retain `assortment_id` and rank-rule
IDs. Mapping rules remain available in `typology_mapping_rules`. Execution audit
metadata remains in `import_runs`; no unsupported row-to-import lineage is inferred.
Source tables can move ahead of a stored analytical snapshot after an import.
Check freshness before joining materialized results back to live source rows or
master attributes; until refresh, a source ID may be absent or have newer content.

## Main fields and interpretation

- `current_*` and `current_store` describe the store master at refresh time,
  including its full attributes. They are not historical values. Product
  master attributes and rank/mapping rules are also current, not effective-dated.
- `revenue` and `units` sum the observed product universe only when every product
  group has an unambiguous retained source and a non-null measure. They do not establish
  complete store turnover or complete source delivery.
- `unambiguous_reported_revenue` and `unambiguous_reported_units` are explicitly
  partial sums. They exclude ambiguous groups and missing measures; an empty sum
  remains null. Coverage counts must accompany their use.
- `revenue_per_unit` divides complete revenue by complete units; zero units yield
  null. It is a product-mix-dependent ratio, not a price index. Returns and
  negative values are preserved. Volumes remain at product grain because units
  are not established as comparable across products. Source prices and growth
  ratios are not averaged or summed.
- `calls`, `field_visits`, and `crowdsourced_visits` remain separate. A missing
  activity is null, whereas a reported zero stays zero. Planning fields in
  `current_store` have no assumed monthly periodicity.
- `category_details` retains the category grain. `observed_presence_rate` is the
  mean binary presence over observed product keys, including imported inferred
  absences. It is neither network numeric distribution nor assortment compliance.
  Unmatched product counts and inferred-absence counts qualify this denominator.
- Shelf share is company measure divided by total measure for an unambiguous
  category observation. Zero denominators yield null. Shares are not averaged
  across categories and values above one are not silently clamped.
- `typology_details` uses only the same month's snapshots, with historical region
  and representative where supplied. No forward/backward fill is performed.
  Snapshot IDs also retain access to snapshots with no category values.
- `has_*` flags indicate that observations exist, not that they are valid or
  complete. Empty detail arrays mean no linked detail, not measured zero.

## Ambiguities and assortment boundaries

Multiple rows within the retained sales source, or at an activity or shelf grain,
are marked ambiguous, even when values agree.
The measure becomes null and every observation ID remains available. No row is
chosen by arbitrary source order, and no source is assumed additive to another.

The recognized supplementary register source is an authoritative row revision.
For the same matched store, month and source GTIN, it replaces monthly measures
where a supplementary row exists. Several
supplementary rows at that grain remain ambiguous; duplicate monthly rows are
ambiguous when no supplementary revision exists. All measures come from the
retained row: a null supplementary measure remains null rather than falling back
to a monthly value. Observation IDs, all source kinds, original row counts and
reported-value counts retain every source row, including superseded rows. Product
attribution still requires agreement across all source rows. No monetary value is
added across competing sources. The frontend labels reconciled mixed-source cells
and keeps their evidence accessible.

For a retained monthly row only, a missing revenue or units value whose own
change ratio is exactly `-1` is published as zero under the confirmed producer
convention. Each measure is evaluated independently. Other blanks, supplementary
blanks and volumes remain unchanged. Raw observations and reported-value counts
remain unchanged: a convention zero can therefore have zero reported rows. The
product table labels these zeros and links to the original empty cell and ratio.

Distribution uses a prefixed product UUID when matched, otherwise a prefixed
source product reference. Unresolved references are not asserted to represent
distinct real-world products or to match an existing product by label.
For canonical presence, a reported value takes precedence over generated
`inferred_absence` rows for aliases of the same product. Agreeing reported values
produce one presence value; contradictory reported values remain ambiguous and
null. An inferred-only group remains zero. Source counts, inferred counts and
every observation ID are retained; binary presence values are never added.

Typology-to-rank matching uses either direct retailer/category/value equality or
explicit mapping rules. Comparison keys use Unicode NFKD decomposition, retain
only ASCII letters and digits, and uppercase, consistently with import keys.
Empty keys cannot match. No fuzzy matching or current-store retailer fallback
is used. Normalization collisions retain all candidate ranks rather than choosing
a winner. Missing or multiple ranks remain visible. Invalid matching mapping
rules block exact membership even if a direct rank match exists. Contradictory
snapshots for the same store/month/category key also block exact membership.
Identical snapshots retain evidence without multiplying an assortment candidate.

Exact candidates use the same month and rank ID. Ranks are not assumed cumulative;
candidate counts are assortment-row counts, not distinct product counts or a
mandatory assortment. The retailer-level view supplies broader context for
unsegmented or unresolved rows, without claiming store eligibility. It joins
direct historical retailer labels or uses a unique, valid raw-to-canonical
retailer mapping. An alias needs at least one valid rule with a nonempty target,
and all known nonempty retailer targets must agree, including targets on rules
flagged erroneous at category level. A category error alone does not invalidate
a consistent retailer alias, and never establishes exact category eligibility.
Retailer labels continue to use case and surrounding whitespace normalization.
Assortments without an observed matching historical retailer remain in the source table.
No completeness or compliance score is inferred from absent candidate rows.

## Time comparisons

`analytics_store_month_changes` uses the dense calendar: the previous month means
the preceding calendar month, not the preceding non-empty observation. The yearly
comparison uses twelve months. Missing values propagate and zero bases yield
null change ratios. Ratios are fractions, not percentages.

Filter the completed changes view by the reporting period; computing `lag` after
filtering the source to one month would remove its comparison history. Changes
are descriptive and do not enforce a constant product cohort. Seasonality,
assortment changes, reporting coverage and selection of visited stores can
confound associations. Dated promotions, prices, campaign assignments or other
decisions need their own source data before their effects can be studied.

Example with client-bound parameters:

```sql
SELECT m.period, m.revenue, m.units, m.calls, m.field_visits,
       m.register_ambiguous_products, m.register_revenue_product_count,
       m.register_product_count, c.revenue_previous_month,
       c.revenue_month_change_ratio
FROM analytics_store_month m
JOIN analytics_store_month_changes c USING (store_id, period)
WHERE m.store_id = :store_id
  AND m.period BETWEEN :first_month AND :last_month
ORDER BY m.period;
```

## Installation, rollback and verification

The materialization migration is `20260927_12`, followed by retailer mapping
correction `20260927_13`. Reconciliation migration `20261017_16` replaces the
presence, typology and retailer-context definitions and their dependent views.
When explicitly deploying,
use the existing Alembic workflow with the locally configured `DATABASE_URL`:
`alembic upgrade head`, then `retail-data analytics refresh`. No source import is
needed. The migration creates unpopulated views so deployment does not perform
an expensive calculation implicitly. Rollback to `20260926_11` restores ordinary
views and removes the materialized snapshots and refresh audit. Rollback to
`20260925_10` removes all analytical views. Both preserve imported tables.

For upgrade or downgrade of `20261017_16`, stop API readers first: eleven
materialized views are recreated, losing their existing object grants and stored
results. Refresh the complete analytical publication, regenerate and apply the
reviewed [explicit reader grants](read-api-operations.md), deploy the compatible
frontend presence decoder, then restart the API.
No source import is needed. Downgrade to `20261015_15` restores the previous
reconciliation rules and requires the same refresh and grant steps. Imported
observations, refresh audit records and unrelated views are preserved.

Migration `20261018_17` installs supplementary revisions and the monthly zero
convention, and recreates
seven views (product sales and dependent store/network summaries). Its downgrade
restores overlap ambiguity and unnormalized monthly blanks. Both directions require stopping API readers,
refreshing the complete publication, restoring reviewed column grants and using
the compatible product-sales decoder before readers restart. Imported source
observations remain unchanged by this migration; no new API field is introduced.

The SQL file under `migrations/sql/` is part of the immutable migration and must
travel with the migration directory. Future changes require a new migration.
SQLAlchemy read mappings live in `database/analytics.py`, with separate metadata
so Alembic does not mistake views for tables. The `analytics_refresh_runs` audit
table belongs to normal table metadata. Never call `create_all` on the view
metadata or use these mappings for writes.

Refresh and inspect freshness with the locally configured connection:

```bash
retail-data analytics refresh
retail-data analytics status
# Or refresh immediately after a successful import, including an idempotent skip:
retail-data import register --source-dir /path/to/register-sources --refresh-analytics
```

If the environment has no installed `retail-data` executable, the same CLI is
available as `python -m retail_data_platform.cli analytics refresh` and
`python -m retail_data_platform.cli analytics status` using the project Python.

`analytics status` reports `uninitialized`, `current`, or `stale`, along with the
last successful completion time and latest attempt status. Freshness compares
the exact set of successful `import_runs` IDs in the source snapshot with the
current set, so even an import committed during refresh is detectable. It does
not detect manual source edits, which are outside the supported write boundary.
An import still in progress may commit later; status is a point-in-time check.

Refresh uses a session advisory lock and refuses overlapping refresh attempts.
The running audit entry is committed before computation; successful publication
and its source-run set commit with all materialized results. Failure rolls back
all view changes and records a generic failure without source values. A failed
post-import refresh returns a nonzero command status but does not undo the
successful source import; retry `analytics refresh`. Process termination that
bypasses cleanup can leave a `running` audit entry; its presence alone does not
prove a worker is alive. The session lock is released by PostgreSQL on disconnect.
Use the refresh command, not individual manual `REFRESH` statements, to maintain
the audit and snapshot consistency. Refresh prints view names as progress.

PostgreSQL tests use `TEST_DATABASE_URL` and uniquely named schemas with search
paths isolated from application tables. Contract tests roll back their outer
transaction; multi-connection lifecycle tests drop only their own synthetic schema
in cleanup. Tests cover fresh upgrade, downgrade/re-upgrade, `alembic check`,
SQLAlchemy column types, analytical measures, unique indexes, freshness, atomic
failure rollback, concurrent readers and source imports during refresh. They are
skipped if the test connection is not supplied.

The calculation cost is paid during refresh, including calendar expansion,
typology matching and JSON aggregation. Reads by store/month and by period use
indexes. Refresh requires disk space for stored results and concurrent refresh
work; duration and storage depend on dataset size. No universal latency or refresh
duration guarantee is implied by the synthetic tests.
