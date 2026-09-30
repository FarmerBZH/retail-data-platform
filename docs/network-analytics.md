# Network analytics

## Published scope

Four materialized views summarize the canonical `analytics_store_month` snapshot.
They cover every current store, including inactive stores, over the existing dense
calendar. They do not establish opening dates, complete source delivery, or total
store turnover outside the observed product universe. No current annual turnover
fields from the store master are added to monthly sales.

| View | Grain | Read route |
| --- | --- | --- |
| `analytics_network_month` | Calendar month | `/v1/data/analytics_network_month` |
| `analytics_network_year` | Calendar year, keyed by January 1 | `/v1/data/analytics_network_year` |
| `analytics_network_overview` | One row, `scope=network` | `/v1/data/analytics_network_overview` |
| `analytics_network_month_changes` | Calendar month | `/v1/data/analytics_network_month_changes` |

`first_period`, `last_period` and `month_count` describe the months actually in the
analytical calendar. An annual row may cover less than twelve months; its totals
must be labeled with that coverage, not presented as a full-year result. The
calendar comes from all dated datasets, not only sales. A gap inside that calendar
is included; a month outside it produces no monthly row and must not become zero.
The overview covers the entire available calendar, not a requested subperiod.
With an empty calendar it still returns one row, with zero coverage counts and
null measures/dates; `store_count` counts stores in the calendar, not a live master
inventory. Monthly and annual collections are then empty.

## Measures and business interpretation

For each of `revenue`, `units`, `calls`, `field_visits`, `crowdsourced_visits`:

- The unsuffixed measure is populated only when every expected store-month cell
  has a valid measure. This is completeness within the observed product universe.
- `<measure>_partial` sums the valid cells, including measured zero and returns.
  No valid cells means null. It equals the complete measure when coverage is full.
- `<measure>_covered_cell_count` is the numerator; `expected_cell_count` is the
  denominator. A missing cell prevents a complete measure. Each metric has its
  own numerator; sales coverage cannot stand in for activity coverage.

The frontend can choose a complete or explicitly labeled partial amount from these
fields. Coverage is undefined for a zero denominator. Money, unit sums, activity
sums and ratios are serialized as decimal strings; coverage counts are integers.
No rounding or floating-point summation is performed. PostgreSQL numeric division
retains database precision; clients round only for presentation.

`revenue_per_unit` divides the complete revenue and complete units over the same
cells. It is null for missing coverage or zero units. It is not an average of store
ratios, a price index, a basket value, or a physical-volume measure.

`unambiguous_reported_revenue` and `unambiguous_reported_units` retain partial
product-level diagnostics even when a store total is unavailable. They must not
silently replace the store-complete sums. `register_product_count` counts
store-month-product groups, not distinct products across the network;
`register_ambiguous_products` and `register_unmatched_product_rows` explain source
quality at their existing grains. These additive counts are also numeric strings.

`store_count` and `stores_with_register`, `stores_with_activity`,
`stores_with_category_data`, `stores_with_typology` are distinct stores in each
window. Observation flags are not completeness indicators. Annual/overview store
counts are computed from store identities, never summed from monthly counts.

Unattributed observations are excluded from store totals and remain inspectable
through `analytics_monthly_link_quality`; its observation counts do not quantify
lost revenue. Product, shelf, distribution, typology and assortment detail remain
in their existing resources. There is no defensible common unit for adding shelf
measurements or product volumes globally, and no basis for margin, customer
counts, basket value, or causal return on commercial activity.

Sales sources do not establish currency or tax treatment. Display “monetary unit
to be confirmed”; these are sums in source units, not a confirmed EUR or HT/TTC
business total. Combining currencies requires a separately validated conversion
contract. This change does not add one.

## Comparisons

The monthly changes view compares complete network amounts with the preceding
calendar month and the same month in the prior calendar year. Missing coverage
on either side yields null differences and ratios. A zero reference yields a null
ratio but retains the absolute difference. Negative references remain negative;
show the absolute change and a negative-base label rather than inferring a
favorable trend from the ratio sign. Ratios are fractions, not percentages.

Comparisons use the same current store population in the published calendar, but
do not guarantee a constant product universe or economically constant perimeter.
They are calculated before API period filtering, so selecting one month preserves
its reference history. There is no comparable-cohort calculation, store ranking,
arbitrary multi-store selection, or arbitrary-window summary in this release.
Do not add store filters to these global resources or sum a page as a window total.

## API and refresh

The routes use the existing personal authentication, `data:read` scope, typed
allowlist, decimal serialization, keyset pagination and column-only read grants.
For monthly/yearly collections, `period_from` and `period_to` select rows by their
period key. Annual filters select January 1 keys; they do not trim the annual
calculation. The overview accepts `scope=network` and rejects period/store filters.
Unsupported filters return 422. Collection responses retain `items` and
`next_cursor`; clients must follow pagination for a complete monthly series.

For example, a monthly request is:

```text
GET /v1/data/analytics_network_month?period_from=2025-01-01&period_to=2025-12-01
```

Use `/v1/analytics/status` for initialization and source freshness. All fifteen
views are refreshed from one repeatable-read snapshot and published atomically
with the refresh audit. Separate HTTP requests/pages can see different successful
refreshes; this is not a frozen export contract.

Migration `20260930_14` creates the four views unpopulated, with unique indexes.
Deploy with the configured database owner, using the existing Python commands:

```bash
alembic upgrade head
python -m retail_data_platform.cli analytics refresh
python -m retail_data_platform.cli analytics status
python -m retail_data_platform.api.database --role api_reader
```

The final command only prints reviewed SELECT grants; an administrator must apply
them before starting the updated API. Its startup validation rejects missing views
or missing column grants. Existing grants do not automatically cover new views.
There is no manual source-table edit, new import, scheduler or dependency required.
Downgrading to `20260927_13` removes only the four new views; deploy the matching
older API/refresh code and revoke obsolete grants as appropriate. Do not run old
refresh code alongside the new schema: it does not publish network views.

Synthetic PostgreSQL tests cover null/zero/negative measures, ambiguous products,
unattributed observations, independent coverage, calendar gaps, annual boundaries,
exact API serialization, authorization/grants, atomic refresh and migration cycles.
Private source rows and derived statistics are not test fixtures or documentation.
