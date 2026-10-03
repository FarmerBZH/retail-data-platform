import { publishedContract } from "./published-contract";
import { rowDecoder, rowKey } from "./published-data";
import type { PublishedRow } from "./published-data";
import type { Resource } from "./read-api";
import { calendarMonths } from "./month-period";
import type { MonthPeriod } from "./month-period";
import { formatExact, subtractExact } from "./exact-values";

export const presenceNames = [
  "analytics_store_category_month",
  "analytics_distribution_product_month",
  "analytics_shelf_category_month",
] as const;
export type PresenceName = (typeof presenceNames)[number];
function resource(name: PresenceName): Resource {
  const contract = publishedContract[name];
  return {
    name,
    path: `/v1/data/${name}`,
    keys: contract.keys,
    filters: contract.filters,
    columns: Object.keys(contract.fields),
  };
}
export const presenceResources = {
  analytics_store_category_month: resource("analytics_store_category_month"),
  analytics_distribution_product_month: resource(
    "analytics_distribution_product_month",
  ),
  analytics_shelf_category_month: resource("analytics_shelf_category_month"),
};
export type PresenceRow = PublishedRow & {
  store_id: string;
  period: string;
  category_code: string;
};
function emptyMeasures(row: PublishedRow, fields: string[]) {
  if (fields.some((f) => row[f] !== null)) throw new Error("Invalid response");
}
function sourceGrain(row: PublishedRow, prefix = "") {
  const count = row[`${prefix}source_row_count`] as number | null;
  const ambiguous = row[`${prefix}ambiguous`];
  if (
    count !== null &&
    (count < 1 || (ambiguous !== null && ambiguous !== count > 1))
  )
    throw new Error("Invalid response");
  const ids = row.observation_ids as readonly string[] | null | undefined;
  if (
    ids &&
    (new Set(ids).size !== ids.length ||
      (count !== null && ids.length !== count))
  )
    throw new Error("Invalid response");
}
function shelf(row: PublishedRow, prefix = "") {
  sourceGrain(row, prefix);
  for (const field of [
    `${prefix}company_value`,
    `${prefix}total_value`,
    "shelf_share",
  ]) {
    if (
      typeof row[field] === "string" &&
      formatExact(row[field]).startsWith("-")
    )
      throw new Error("Invalid response");
  }
  if (row[`${prefix}ambiguous`] !== false)
    emptyMeasures(row, [
      `${prefix}company_value`,
      `${prefix}total_value`,
      "shelf_share",
    ]);
  const total = row[`${prefix}total_value`] as string | null;
  if (
    (total === null ||
      formatExact(total) === "0" ||
      row[`${prefix}company_value`] === null) &&
    row.shelf_share !== null
  )
    throw new Error("Invalid response");
}
export function presenceDecoder(name: PresenceName) {
  const decode = rowDecoder(presenceResources[name]);
  return (value: unknown): PresenceRow => {
    const row = decode(value) as PresenceRow;
    for (const field of presenceResources[name].columns) {
      if (
        (field.endsWith("_count") ||
          field.endsWith("_products") ||
          field.endsWith("_rows")) &&
        typeof row[field] === "number" &&
        row[field] < 0
      )
        throw new Error("Invalid response");
    }
    if (typeof row.inferred_absence_rows === "string") {
      const count = formatExact(row.inferred_absence_rows);
      if (count.startsWith("-") || count.includes(","))
        throw new Error("Invalid response");
    }
    if (name === "analytics_store_category_month") {
      const count = row.distribution_product_count as number | null;
      for (const f of [
        "distribution_ambiguous_products",
        "distribution_unmatched_products",
        "present_products",
      ]) {
        const value = row[f] as number | null;
        if (count !== null && value !== null && value > count)
          throw new Error("Invalid response");
      }
      if (row.distribution_ambiguous_products !== 0)
        emptyMeasures(row, ["present_products", "observed_presence_rate"]);
      if (
        (count === null || count === 0 || row.present_products === null) &&
        row.observed_presence_rate !== null
      )
        throw new Error("Invalid response");
      const rate = row.observed_presence_rate as string | null;
      if (
        rate !== null &&
        (formatExact(rate).startsWith("-") ||
          formatExact(subtractExact("1", rate)).startsWith("-"))
      )
        throw new Error("Invalid response");
      shelf(row, "shelf_");
    } else if (name === "analytics_distribution_product_month") {
      sourceGrain(row);
      const productId = row.product_id as string | null;
      const key = row.product_key as string;
      if (
        productId === null
          ? !key.startsWith("source:")
          : key !== `product:${productId.toLowerCase()}`
      )
        throw new Error("Invalid response");
      if (
        row.presence_value === 1 &&
        row.inferred_absence_rows !== null &&
        row.inferred_absence_rows !== 0
      )
        throw new Error("Invalid response");
      if (row.ambiguous !== false && row.presence_value !== null)
        throw new Error("Invalid response");
      if (
        row.presence_value !== null &&
        row.presence_value !== 0 &&
        row.presence_value !== 1
      )
        throw new Error("Invalid response");
      if (
        row.source_row_count !== null &&
        row.inferred_absence_rows !== null &&
        (row.inferred_absence_rows as number) > (row.source_row_count as number)
      )
        throw new Error("Invalid response");
    } else shelf(row);
    return row;
  };
}
export const presenceDecoders = Object.fromEntries(
  presenceNames.map((name) => [name, presenceDecoder(name)]),
) as Record<PresenceName, ReturnType<typeof presenceDecoder>>;
export function presenceRows(
  name: PresenceName,
  items: readonly PresenceRow[],
  storeId: string,
  period: MonthPeriod,
  category?: string,
) {
  const months = calendarMonths(period),
    seen = new Set<string>();
  for (const row of items) {
    const key = rowKey(presenceResources[name], row);
    if (
      row.store_id !== storeId ||
      !months.includes(row.period.slice(0, 7)) ||
      (category !== undefined && row.category_code !== category) ||
      seen.has(key)
    )
      throw new Error("Invalid response");
    seen.add(key);
  }
  return [...items].sort((a, b) =>
    rowKey(presenceResources[name], a).localeCompare(
      rowKey(presenceResources[name], b),
    ),
  );
}
export function categoryGrid(
  rows: readonly PresenceRow[],
  category: string,
  period: MonthPeriod,
) {
  return calendarMonths(period).map((month) => ({
    month,
    row: rows.find(
      (r) => r.category_code === category && r.period === `${month}-01`,
    ),
  }));
}
