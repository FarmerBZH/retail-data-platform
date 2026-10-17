import { publishedContract } from "./published-contract";
import { rowDecoder } from "./published-data";
import type { PublishedRow } from "./published-data";
import type { Resource } from "./read-api";
import { calendarMonths } from "./month-period";
import type { MonthPeriod } from "./month-period";
import { plotValue } from "./monthly-sales";

const contract = publishedContract.analytics_register_product_month;
export const productSalesResource: Resource = {
  name: "analytics_register_product_month",
  path: "/v1/data/analytics_register_product_month",
  keys: contract.keys,
  filters: contract.filters,
  columns: Object.keys(contract.fields),
};
const decode = rowDecoder(productSalesResource);
export type ProductSale = PublishedRow & {
  store_id: string;
  period: string;
  source_gtin: string;
  product_id: string | null;
  source_row_count: number | null;
  ambiguous: boolean | null;
  unmatched_product_rows: number | null;
  observation_ids: readonly string[] | null;
  source_kinds: readonly string[] | null;
  revenue: string | null;
  units: number | null;
  volume: string | null;
  revenue_reported_rows: number | null;
  units_reported_rows: number | null;
};
export function productSale(value: unknown): ProductSale {
  const row = decode(value) as ProductSale;
  for (const field of [
    "source_row_count",
    "unmatched_product_rows",
    "revenue_reported_rows",
    "units_reported_rows",
  ] as const) {
    if (row[field] !== null && row[field] < 0)
      throw new Error("Invalid response");
  }
  if (
    row.ambiguous !== false &&
    [row.revenue, row.units, row.volume].some((v) => v !== null)
  )
    throw new Error("Invalid response");
  if (row.source_row_count !== null) {
    if (
      row.source_row_count < 1 ||
      (row.ambiguous !== null && row.ambiguous !== row.source_row_count > 1)
    )
      throw new Error("Invalid response");
    for (const field of [
      "unmatched_product_rows",
      "revenue_reported_rows",
      "units_reported_rows",
    ] as const)
      if (row[field] !== null && row[field] > row.source_row_count)
        throw new Error("Invalid response");
    if (
      row.observation_ids !== null &&
      row.observation_ids.length !== row.source_row_count
    )
      throw new Error("Invalid response");
    if (row.source_row_count === 1) {
      for (const [measure, count] of [
        [row.revenue, row.revenue_reported_rows],
        [row.units, row.units_reported_rows],
      ] as const)
        if (count !== null && (measure !== null) !== (count === 1))
          throw new Error("Invalid response");
    }
  }
  if (
    row.observation_ids !== null &&
    new Set(row.observation_ids).size !== row.observation_ids.length
  )
    throw new Error("Invalid response");
  // The publication sets a product link only when every source row agrees.
  if (
    row.product_id !== null &&
    row.unmatched_product_rows !== null &&
    row.unmatched_product_rows !== 0
  )
    throw new Error("Invalid response");
  return row;
}
export function productRows(
  items: readonly ProductSale[],
  storeId: string,
  period: MonthPeriod,
) {
  const months = calendarMonths(period);
  const seen = new Set<string>();
  for (const row of items) {
    const key = JSON.stringify([row.period, row.source_gtin]);
    if (
      row.store_id !== storeId ||
      !months.includes(row.period.slice(0, 7)) ||
      seen.has(key)
    )
      throw new Error("Invalid response");
    seen.add(key);
  }
  return [...items].sort(
    (a, b) =>
      a.period.localeCompare(b.period) ||
      a.source_gtin.localeCompare(b.source_gtin),
  );
}
export function productGrid(
  items: readonly ProductSale[],
  gtin: string,
  period: MonthPeriod,
) {
  return calendarMonths(period).map((month) => ({
    month,
    row: items.find(
      (row) => row.source_gtin === gtin && row.period === `${month}-01`,
    ),
  }));
}
export function productGeometry(values: readonly (string | null)[]) {
  const points = values.map(plotValue);
  const finite = points.filter((v): v is number => v !== null);
  // Include the zero origin used by bars; finite values may have an infinite span.
  if (
    finite.length &&
    !Number.isFinite(Math.max(0, ...finite) - Math.min(0, ...finite))
  )
    return points.map(() => null);
  return points;
}
