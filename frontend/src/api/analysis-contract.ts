import {
  boolean,
  date,
  decimal,
  nullable,
  object,
  text,
  timestamp,
  uuid,
} from "./api-validation";
import type { Decoder } from "./api-validation";
import { shiftMonth, validatePeriod } from "../shared/month-period";

const fail = (): never => {
  throw new Error("Invalid analysis contract");
};
const integer: Decoder<number> = (v) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : fail();
const choice =
  <const T extends readonly string[]>(values: T): Decoder<T[number]> =>
  (v) =>
    typeof v === "string" && values.includes(v) ? v : fail();
const short =
  (n: number): Decoder<string> =>
  (v) =>
    text(v, n);
const month: Decoder<string> = (v) => {
  const m = date(v);
  return m.endsWith("-01") ? m : fail();
};
const exact: Decoder<string> = (v) => {
  const d = decimal(v);
  const exponent = Number(d.split(/[eE]/)[1] ?? 0);
  if (Math.abs(exponent) > 512) return fail();
  return d;
};
const list =
  <T>(decode: Decoder<T>, max: number): Decoder<T[]> =>
  (v) =>
    Array.isArray(v) && v.length <= max ? v.map(decode) : fail();
function shape<T extends Record<string, Decoder<unknown>>>(
  fields: T,
): Decoder<{ [K in keyof T]: ReturnType<T[K]> }> {
  return (value) => {
    const row = object(value);
    if (
      Object.keys(row).length !== Object.keys(fields).length ||
      Object.keys(row).some((k) => !Object.hasOwn(fields, k))
    )
      return fail();
    return Object.fromEntries(
      Object.entries(fields).map(([key, decode]) => [key, decode(row[key])]),
    ) as { [K in keyof T]: ReturnType<T[K]> };
  };
}
export const measures = [
  "revenue",
  "units",
  "calls",
  "field_visits",
  "crowdsourced_visits",
] as const;
export const labels: Record<(typeof measures)[number], string> = {
  revenue: "CA observé",
  units: "Unités vendues",
  calls: "Appels",
  field_visits: "Visites terrain",
  crowdsourced_visits: "Visites participatives",
};
const activity = choice(["all", "active", "inactive"]);
const comparison = choice(["previous", "previous_year"]);
const scope = choice(["all", "selection"]);
const dimension = choice(["retailer_name", "region_code", "store_format"]);
const counts = {
  requested_store_count: nullable(integer),
  resolved_store_count: integer,
  filtered_out_store_count: integer,
  scope_store_count: integer,
};
const filters = {
  scope,
  store_ids: list(uuid, 100),
  retailer_name: nullable(short(128)),
  region_code: nullable(short(32)),
  store_format: nullable(short(64)),
  activity_status: activity,
};
const windowDecoder = shape({ start: month, end: month, months: integer });
const context = shape({
  publication_id: uuid,
  freshness: shape({
    state: choice(["current", "stale"]),
    last_completed_at: timestamp,
    last_attempt_status: nullable(choice(["running", "succeeded", "failed"])),
  }),
  scope: shape({ ...filters, ...counts }),
  window: nullable(windowDecoder),
  reference: nullable(windowDecoder),
  comparison: nullable(comparison),
});
const store = shape({
  store_id: uuid,
  name: nullable(short(255)),
  city: nullable(short(128)),
  retailer_name: nullable(short(128)),
  region_code: nullable(short(32)),
  store_format: nullable(short(64)),
  is_active: boolean,
});
const measure = shape({
  value: nullable(exact),
  partial: nullable(exact),
  covered_cell_count: integer,
  expected_cell_count: integer,
});
const change = shape({
  difference: nullable(exact),
  ratio: nullable(exact),
  reference_state: choice(["missing", "zero", "negative", "positive"]),
});
const cohort = shape({
  store_count: integer,
  excluded_store_count: integer,
  expected_cell_count: integer,
  current: nullable(exact),
  reference: nullable(exact),
  change,
});
const metric = shape({ current: measure, reference: measure, change, cohort });
const pointMetric = shape({
  current: measure,
  reference: measure,
  cohort_store_count: integer,
  cohort_current: nullable(exact),
  cohort_reference: nullable(exact),
});
const metrics = <T>(decode: Decoder<T>) =>
  shape({
    revenue: decode,
    units: decode,
    calls: decode,
    field_visits: decode,
    crowdsourced_visits: decode,
  });
const point = shape({
  period: month,
  reference_period: month,
  metrics: metrics(pointMetric),
});
const cursor = nullable(short(8192));
const ranking = shape({
  store_id: uuid,
  name: nullable(short(255)),
  city: nullable(short(128)),
  retailer_name: nullable(short(128)),
  region_code: nullable(short(32)),
  store_format: nullable(short(64)),
  is_active: boolean,
  rank: integer,
  current_revenue: nullable(exact),
  reference_revenue: nullable(exact),
  current_revenue_partial: nullable(exact),
  reference_revenue_partial: nullable(exact),
  current_revenue_covered: integer,
  reference_revenue_covered: integer,
  expected_month_count: integer,
  revenue_change: nullable(exact),
  exclusion_reason: nullable(
    choice(["missing_month", "ambiguous_measure", "missing_measure"]),
  ),
});
export const analysisDecoders = {
  stores: shape({ context, items: list(store, 200), next_cursor: cursor }),
  dimensions: shape({
    context,
    items: list(shape({ value: short(128) }), 200),
    next_cursor: cursor,
    dimension,
    missing_store_count: integer,
  }),
  summary: shape({
    context,
    metrics: metrics(metric),
    revenue_per_unit: shape({
      current: nullable(exact),
      reference: nullable(exact),
      cohort_current: nullable(exact),
      cohort_reference: nullable(exact),
      cohort_store_count: integer,
    }),
    revenue_contribution_sum: nullable(exact),
  }),
  series: shape({ context, items: list(point, 120) }),
  ranking: shape({ context, items: list(ranking, 200), next_cursor: cursor }),
  "store-series": shape({
    context,
    items: list(shape({ store, points: list(point, 120) }), 6),
    next_cursor: cursor,
  }),
  availability: shape({
    context,
    items: list(
      shape({
        dataset: choice([
          "register",
          "activity",
          "distribution",
          "shelf",
          "typology",
        ]),
        first_period: nullable(month),
        last_period: nullable(month),
        months: list(
          shape({
            period: month,
            has_observation: boolean,
            source_row_count: nullable(integer),
            observed_row_count: nullable(integer),
            inferred_absence_row_count: nullable(integer),
            observed_store_count: nullable(integer),
          }),
          120,
        ),
      }),
      5,
    ),
  }),
};
export type AnalysisRoute = keyof typeof analysisDecoders;
export type AnalysisResult<R extends AnalysisRoute> = ReturnType<
  (typeof analysisDecoders)[R]
>;
export type AnalysisStore = ReturnType<typeof store>;
export type AnalysisPoint = ReturnType<typeof point>;
export type AnalysisContext = ReturnType<typeof context>;
export type AnalysisQuery = Readonly<{
  scope?: "all" | "selection";
  store_ids?: readonly string[];
  retailer_name?: string;
  region_code?: string;
  store_format?: string;
  activity_status?: "all" | "active" | "inactive";
  publication_id?: string;
  period_from?: string;
  period_to?: string;
  comparison?: "previous" | "previous_year";
  q?: string;
  dimension?: "retailer_name" | "region_code" | "store_format";
  limit?: number;
  after?: string;
  sort?: "revenue" | "revenue_change";
  direction?: "asc" | "desc";
}>;
export function analysisParameters(
  route: AnalysisRoute,
  query: AnalysisQuery,
): URLSearchParams {
  if (!Object.hasOwn(analysisDecoders, route)) return fail();
  const shared = [
    "scope",
    "store_ids",
    "retailer_name",
    "region_code",
    "store_format",
    "activity_status",
    "publication_id",
  ];
  const dated = ["period_from", "period_to", "comparison"];
  const paged = ["limit", "after"];
  const allowed = [
    ...shared,
    ...(route === "stores"
      ? [...paged, "q"]
      : route === "dimensions"
        ? [...paged, "q", "dimension"]
        : route === "availability"
          ? ["period_from", "period_to"]
          : route === "ranking"
            ? [...dated, ...paged, "sort", "direction"]
            : route === "store-series"
              ? [...dated, ...paged]
              : dated),
  ];
  if (Object.keys(query).some((k) => !allowed.includes(k))) return fail();
  const mode = scope(query.scope ?? "all"),
    ids = query.store_ids ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    new Set(ids.map(uuid)).size !== ids.length ||
    (mode === "all" && ids.length > 0) ||
    (mode === "selection" && !ids.length)
  )
    return fail();
  activity(query.activity_status ?? "all");
  if (query.publication_id !== undefined) uuid(query.publication_id);
  if (query.after !== undefined && (!query.publication_id || !query.after))
    return fail();
  if (
    query.limit !== undefined &&
    (integer(query.limit) < 1 ||
      query.limit > (route === "store-series" ? 6 : 200))
  )
    return fail();
  if (route === "dimensions") dimension(query.dimension);
  if (query.sort !== undefined)
    choice(["revenue", "revenue_change"])(query.sort);
  if (query.direction !== undefined) choice(["asc", "desc"])(query.direction);
  const needsDate = !["stores", "dimensions", "availability"].includes(route);
  if (
    needsDate ||
    query.period_from !== undefined ||
    query.period_to !== undefined
  ) {
    const from = month(query.period_from).slice(0, 7),
      to = month(query.period_to).slice(0, 7);
    const checked = validatePeriod(from, to);
    if (!checked.valid) return fail();
    const ref = comparison(query.comparison ?? "previous");
    if (
      !shiftMonth(from, ref === "previous_year" ? -12 : -checked.period.months)
    )
      return fail();
  }
  const params = new URLSearchParams();
  const maxima: Record<string, number> = {
    retailer_name: 128,
    region_code: 32,
    store_format: 64,
    q: 128,
    after: 8192,
  };
  for (const [key, value] of Object.entries(query)) {
    if (key === "store_ids") {
      for (const id of [...ids].sort()) params.append(key, id);
      continue;
    }
    if (value === undefined) return fail();
    if (Object.hasOwn(maxima, key)) {
      text(value, maxima[key]);
      if ((key === "q" || key === "after") && !value) return fail();
    }
    params.set(key, String(value));
  }
  params.sort();
  if (new TextEncoder().encode(params.toString()).length > 10000) return fail();
  return params;
}
export function decodeAnalysis<R extends AnalysisRoute>(
  route: R,
  value: unknown,
  query: AnalysisQuery,
): AnalysisResult<R> {
  const result = analysisDecoders[route](value) as AnalysisResult<R>;
  const c = result.context;
  if (query.publication_id && c.publication_id !== query.publication_id)
    return fail();
  if (
    c.scope.scope !== (query.scope ?? "all") ||
    c.scope.activity_status !== (query.activity_status ?? "all")
  )
    return fail();
  if (
    JSON.stringify([...c.scope.store_ids].sort()) !==
    JSON.stringify([...(query.store_ids ?? [])].sort())
  )
    return fail();
  for (const key of ["retailer_name", "region_code", "store_format"] as const)
    if (c.scope[key] !== (query[key] ?? null)) return fail();
  if (
    c.scope.resolved_store_count - c.scope.filtered_out_store_count !==
    c.scope.scope_store_count
  )
    return fail();
  if (
    c.scope.scope === "selection" &&
    (c.scope.requested_store_count !== c.scope.store_ids.length ||
      c.scope.resolved_store_count !== c.scope.store_ids.length)
  )
    return fail();
  if (query.period_from) {
    const checked = validatePeriod(
      query.period_from.slice(0, 7),
      query.period_to!.slice(0, 7),
    );
    if (!checked.valid || !c.window || !c.reference) return fail();
    const mode = query.comparison ?? "previous",
      offset = mode === "previous_year" ? -12 : -checked.period.months;
    if (
      c.comparison !== mode ||
      c.window.start !== query.period_from ||
      c.window.end !== query.period_to ||
      c.window.months !== checked.period.months ||
      c.reference.months !== checked.period.months ||
      c.reference.start !== `${shiftMonth(checked.period.from, offset)}-01` ||
      c.reference.end !== `${shiftMonth(checked.period.to, offset)}-01`
    )
      return fail();
  } else if (c.window !== null || c.reference !== null || c.comparison !== null)
    return fail();
  if ("next_cursor" in result && result.next_cursor === "") return fail();
  if (
    "items" in result &&
    result.items.length >
      (query.limit ?? (route === "store-series" ? 6 : 200)) &&
    ["stores", "dimensions", "ranking", "store-series"].includes(route)
  )
    return fail();
  if (c.scope.scope === "all" && c.scope.requested_store_count !== null)
    return fail();
  const unique = (keys: string[]) => {
    if (new Set(keys).size !== keys.length) return fail();
  };
  const pointsMatch = (points: AnalysisPoint[]) => {
    if (!c.window || !c.reference || points.length !== c.window.months)
      return fail();
    for (const [index, point] of points.entries())
      if (
        point.period !==
          `${shiftMonth(c.window.start.slice(0, 7), index)}-01` ||
        point.reference_period !==
          `${shiftMonth(c.reference.start.slice(0, 7), index)}-01`
      )
        return fail();
  };
  if (route === "stores")
    unique((result as AnalysisResult<"stores">).items.map((s) => s.store_id));
  if (route === "dimensions")
    unique((result as AnalysisResult<"dimensions">).items.map((s) => s.value));
  if (route === "ranking") {
    const items = (result as AnalysisResult<"ranking">).items;
    unique(items.map((s) => s.store_id));
    if (
      items.some(
        (item, i) =>
          item.rank < 1 ||
          item.rank > c.scope.scope_store_count ||
          (i > 0 && item.rank !== items[i - 1]!.rank + 1),
      )
    )
      return fail();
  }
  if (route === "series") {
    const points = (result as AnalysisResult<"series">).items;
    if (c.scope.scope_store_count) pointsMatch(points);
    else if (points.length) return fail();
  }
  if (route === "store-series") {
    const items = (result as AnalysisResult<"store-series">).items;
    unique(items.map((s) => s.store.store_id));
    items.forEach((item) => pointsMatch(item.points));
  }
  if (route === "availability") {
    const items = (result as AnalysisResult<"availability">).items;
    unique(items.map((d) => d.dataset));
    if (items.length !== 5) return fail();
    items.forEach((d) => {
      if (d.months.length !== (c.window?.months ?? 0)) return fail();
      d.months.forEach((m, i) => {
        if (m.period !== `${shiftMonth(c.window!.start.slice(0, 7), i)}-01`)
          return fail();
      });
    });
  }
  return result;
}
