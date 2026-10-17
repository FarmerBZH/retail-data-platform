// Entirely synthetic API objects; never imported by application code.
import {
  calendarMonths,
  shiftMonth,
  validatePeriod,
} from "../../src/shared/month-period";
import type {
  AnalysisQuery,
  AnalysisRoute,
} from "../../src/api/analysis-contract";
export const publication = "00000000-0000-0000-0000-000000000088";
export const syntheticId = (i: number) =>
  `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
export const analysisStore = (i: number) => ({
  store_id: syntheticId(i),
  name: i === 2 ? "<img src=x onerror=alert(1)>" : `Magasin synthétique ${i}`,
  city: "Ville synthétique",
  retailer_name: "Enseigne A",
  region_code: i === 2 ? "R-B" : "R-A",
  store_format: "Petit",
  is_active: i !== 2,
});
export const fixedWindow = {
  period_from: "2025-02-01",
  period_to: "2025-02-01",
} as const;
function amount(value: string | null, n: number, expected: number) {
  return {
    value,
    partial: value,
    covered_cell_count: n,
    expected_cell_count: expected,
  };
}
export function analysisFixture(
  route: AnalysisRoute,
  query: AnalysisQuery = {},
  total = 7,
): unknown {
  let ids =
    query.scope === "selection"
      ? [...(query.store_ids ?? [])]
      : Array.from({ length: total }, (_, i) => syntheticId(i + 1));
  const resolved = ids.length;
  let stores = ids.map((id) => analysisStore(Number(id.slice(-12))));
  if (query.region_code !== undefined)
    stores = stores.filter((s) => s.region_code === query.region_code);
  if (query.retailer_name !== undefined)
    stores = stores.filter((s) => s.retailer_name === query.retailer_name);
  if (query.store_format !== undefined)
    stores = stores.filter((s) => s.store_format === query.store_format);
  if (query.activity_status && query.activity_status !== "all")
    stores = stores.filter(
      (s) => s.is_active === (query.activity_status === "active"),
    );
  ids = stores.map((s) => s.store_id);
  const n = ids.length,
    missing = ids.includes(syntheticId(2)) ? 1 : 0,
    hasA = ids.includes(syntheticId(1));
  const checked = query.period_from
    ? validatePeriod(
        query.period_from.slice(0, 7),
        query.period_to!.slice(0, 7),
      )
    : undefined;
  const period = checked?.valid ? checked.period : undefined;
  const offset =
    query.comparison === "previous_year" ? -12 : -(period?.months ?? 1);
  const context = {
    publication_id: publication,
    freshness: {
      state: "current",
      last_completed_at: "2025-03-01T00:00:00Z",
      last_attempt_status: "succeeded",
    },
    scope: {
      scope: query.scope ?? "all",
      store_ids: [...(query.store_ids ?? [])].sort(),
      retailer_name: query.retailer_name ?? null,
      region_code: query.region_code ?? null,
      store_format: query.store_format ?? null,
      activity_status: query.activity_status ?? "all",
      requested_store_count: query.scope === "selection" ? resolved : null,
      resolved_store_count: resolved,
      filtered_out_store_count: resolved - n,
      scope_store_count: n,
    },
    window: period
      ? {
          start: query.period_from,
          end: query.period_to,
          months: period.months,
        }
      : null,
    reference: period
      ? {
          start: `${shiftMonth(period.from, offset)}-01`,
          end: `${shiftMonth(period.to, offset)}-01`,
          months: period.months,
        }
      : null,
    comparison: period ? (query.comparison ?? "previous") : null,
  };
  const count = period?.months ?? 1,
    expected = n * count;
  const change = (difference: string | null, ratio: string | null) => ({
    difference,
    ratio,
    reference_state: "positive",
  });
  const current = hasA ? "120" : "0",
    reference = String(n * 100 + missing * 100),
    cohortN = n - missing;
  const delta = String(Number(current) - cohortN * 100);
  const revenue = {
    current: {
      value: !n || missing ? null : current,
      partial: n ? current : null,
      covered_cell_count: (n - missing) * count,
      expected_cell_count: expected,
    },
    reference: amount(n ? reference : null, expected, expected),
    change: change(
      !n || missing ? null : String(Number(current) - Number(reference)),
      missing || !n
        ? null
        : String((Number(current) - Number(reference)) / Number(reference)),
    ),
    cohort: {
      store_count: cohortN,
      excluded_store_count: missing,
      expected_cell_count: cohortN * count,
      current: cohortN ? current : null,
      reference: cohortN ? String(cohortN * 100) : null,
      change: change(
        cohortN ? delta : null,
        cohortN ? String(Number(delta) / (cohortN * 100)) : null,
      ),
    },
  };
  const zero = {
    current: amount(n ? "0" : null, expected, expected),
    reference: amount(n ? "0" : null, expected, expected),
    change: {
      difference: n ? "0" : null,
      ratio: null,
      reference_state: n ? "zero" : "missing",
    },
    cohort: {
      store_count: n,
      excluded_store_count: 0,
      expected_cell_count: expected,
      current: n ? "0" : null,
      reference: n ? "0" : null,
      change: {
        difference: n ? "0" : null,
        ratio: null,
        reference_state: n ? "zero" : "missing",
      },
    },
  };
  const metrics = {
    revenue,
    units: revenue,
    calls: zero,
    field_visits: zero,
    crowdsourced_visits: zero,
  };
  const points = period
    ? calendarMonths(period).map((m) => ({
        period: `${m}-01`,
        reference_period: `${shiftMonth(m, offset)}-01`,
        metrics: Object.fromEntries(
          Object.entries(metrics).map(([key, v]) => [
            key,
            {
              current: v.current,
              reference: v.reference,
              cohort_store_count: v.cohort.store_count,
              cohort_current: v.cohort.current,
              cohort_reference: v.cohort.reference,
            },
          ]),
        ),
      }))
    : [];
  if (route === "summary")
    return {
      context,
      metrics,
      revenue_per_unit: {
        current: missing ? null : "1",
        reference: "1",
        cohort_current: cohortN ? "1" : null,
        cohort_reference: cohortN ? "1" : null,
        cohort_store_count: cohortN,
      },
      revenue_contribution_sum: cohortN ? delta : null,
    };
  if (route === "series") return { context, items: n ? points : [] };
  if (route === "availability")
    return {
      context,
      items: ["register", "activity", "distribution", "shelf", "typology"].map(
        (dataset) => ({
          dataset,
          first_period: dataset === "register" ? "2025-01-01" : null,
          last_period: dataset === "register" ? "2025-02-01" : null,
          months: points.map((p) => ({
            period: p.period,
            has_observation: dataset === "register",
            source_row_count: dataset === "register" ? n - missing : null,
            observed_row_count: dataset === "register" ? n - missing : null,
            inferred_absence_row_count: dataset === "register" ? 0 : null,
            observed_store_count: dataset === "register" ? n - missing : null,
          })),
        }),
      ),
    };
  const limit = query.limit ?? (route === "store-series" ? 6 : 50),
    start = query.after ? Number(query.after.split(":").at(-1)) : 0;
  if (route === "dimensions") {
    let values = [
      ...new Set(stores.map((s) => s[query.dimension ?? "region_code"])),
    ].sort();
    if (query.q)
      values = values.filter((v) =>
        v.toLowerCase().includes(query.q!.toLowerCase()),
      );
    return {
      context,
      dimension: query.dimension,
      missing_store_count: 0,
      items: values.slice(start, start + limit).map((value) => ({ value })),
      next_cursor:
        values.length > start + limit ? `synthetic:${start + limit}` : null,
    };
  }
  if (query.q)
    stores = stores.filter((s) =>
      (s.name + " " + s.city).toLowerCase().includes(query.q!.toLowerCase()),
    );
  if (route === "stores")
    return {
      context,
      items: stores.slice(start, start + limit),
      next_cursor:
        stores.length > start + limit ? `synthetic:${start + limit}` : null,
    };
  if (route === "store-series")
    return {
      context,
      items: stores.slice(start, start + limit).map((store) => ({
        store,
        points: points.map((p) => ({
          ...p,
          metrics: Object.fromEntries(
            Object.entries(metrics).map(([key]) => {
              const sales = key === "revenue" || key === "units",
                absent = sales && store.store_id === syntheticId(2);
              const current =
                sales && store.store_id === syntheticId(1) ? "120" : "0";
              const reference = sales
                ? store.store_id === syntheticId(2)
                  ? "200"
                  : "100"
                : "0";
              return [
                key,
                {
                  current: amount(absent ? null : current, absent ? 0 : 1, 1),
                  reference: amount(reference, 1, 1),
                  cohort_store_count: absent ? 0 : 1,
                  cohort_current: absent ? null : current,
                  cohort_reference: absent ? null : reference,
                },
              ];
            }),
          ),
        })),
      })),
      next_cursor:
        stores.length > start + limit ? `synthetic:${start + limit}` : null,
    };
  const order = [...stores].sort((a, b) => {
    if (a.store_id === syntheticId(2)) return 1;
    if (b.store_id === syntheticId(2)) return -1;
    const va = a.store_id === syntheticId(1) ? 120 : 0,
      vb = b.store_id === syntheticId(1) ? 120 : 0;
    return (
      (query.direction === "asc" ? va - vb : vb - va) ||
      a.store_id.localeCompare(b.store_id)
    );
  });
  return {
    context,
    items: order.slice(start, start + limit).map((s, i) => ({
      ...s,
      rank: start + i + 1,
      current_revenue:
        s.store_id === syntheticId(2)
          ? null
          : s.store_id === syntheticId(1)
            ? "120"
            : "0",
      reference_revenue: s.store_id === syntheticId(2) ? "200" : "100",
      current_revenue_partial:
        s.store_id === syntheticId(2)
          ? null
          : s.store_id === syntheticId(1)
            ? "120"
            : "0",
      reference_revenue_partial: s.store_id === syntheticId(2) ? "200" : "100",
      current_revenue_covered: s.store_id === syntheticId(2) ? 0 : count,
      reference_revenue_covered: count,
      expected_month_count: count,
      revenue_change:
        s.store_id === syntheticId(2)
          ? null
          : s.store_id === syntheticId(1)
            ? "20"
            : "-100",
      exclusion_reason:
        s.store_id === syntheticId(2) ? "missing_measure" : null,
    })),
    next_cursor:
      stores.length > start + limit ? `synthetic:${start + limit}` : null,
  };
}
export function fixtureQuery(params: URLSearchParams): AnalysisQuery {
  const query: Record<string, unknown> = {};
  for (const key of new Set(params.keys()))
    query[key] =
      key === "store_ids"
        ? params.getAll(key)
        : key === "limit"
          ? Number(params.get(key))
          : params.get(key);
  return query as AnalysisQuery;
}
