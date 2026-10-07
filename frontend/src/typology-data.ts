import { publishedContract } from "./published-contract";
import { rowDecoder, rowKey } from "./published-data";
import type { PublishedRow } from "./published-data";
import type { Resource, ResourceName } from "./read-api";
import { calendarMonths } from "./month-period";
import type { MonthPeriod } from "./month-period";

export const typologyNames = [
  "analytics_typology_month",
  "analytics_assortment_candidates",
  "analytics_retailer_assortment_month",
] as const;
export type TypologyName = (typeof typologyNames)[number];
export function typologyResource(name: ResourceName): Resource {
  const c = publishedContract[name];
  return {
    name,
    path: `/v1/data/${name}`,
    keys: c.keys,
    filters: c.filters,
    columns: Object.keys(c.fields),
  };
}
export function typologyDecoder(resource: Resource) {
  const decode = rowDecoder(resource);
  return (value: unknown) => {
    const row = decode(value);
    if (resource.name === "analytics_typology_month") {
      const ids = row.rank_rule_ids as string[] | null;
      const count = row.rank_candidate_count as number | null;
      if (
        (count !== null && count < 0) ||
        (ids !== null &&
          (new Set(ids).size !== ids.length ||
            (count !== null && ids.length !== count)))
      )
        throw new Error("Invalid response");
    }
    const ids = row.typology_value_ids as string[] | null | undefined;
    if (ids && new Set(ids).size !== ids.length)
      throw new Error("Invalid response");
    return row;
  };
}
export function typologyCalendar(
  resource: Resource,
  rows: readonly PublishedRow[],
  storeId: string,
  period: MonthPeriod,
) {
  const months = calendarMonths(period),
    keys = new Set<string>();
  for (const row of rows) {
    const key = rowKey(resource, row);
    if (
      row.store_id !== storeId ||
      typeof row.period !== "string" ||
      !months.includes(row.period.slice(0, 7)) ||
      keys.has(key)
    )
      throw new Error("Invalid response");
    keys.add(key);
  }
  return months.map((month) => ({
    month,
    rows: rows.filter((row) => row.period === `${month}-01`),
  }));
}
export function typologyConflict(
  row: PublishedRow,
  rows: readonly PublishedRow[],
) {
  if (typeof row.category_key !== "string" || row.typology_value === null)
    return false;
  return rows.some(
    (other) =>
      other !== row &&
      other.typology_value !== null &&
      other.period === row.period &&
      other.category_key === row.category_key &&
      other.typology_value !== row.typology_value,
  );
}
export type TypologyLink = {
  name: ResourceName;
  id: string;
  owner: PublishedRow;
};
export function typologyLinks(
  name: ResourceName,
  row: PublishedRow,
): TypologyLink[] {
  const links: TypologyLink[] = [];
  const one = (field: string, target: ResourceName) => {
    if (typeof row[field] === "string")
      links.push({ name: target, id: row[field], owner: row });
  };
  const many = (field: string, target: ResourceName) => {
    if (Array.isArray(row[field]))
      for (const id of row[field])
        if (typeof id === "string")
          links.push({ name: target, id, owner: row });
  };
  if (name === "analytics_typology_month") {
    one("typology_value_id", "store_typology_values");
    one("snapshot_id", "typology_snapshots");
    many("rank_rule_ids", "typology_rank_rules");
  } else if (
    name === "analytics_assortment_candidates" ||
    name === "analytics_retailer_assortment_month"
  ) {
    one("assortment_id", "assortments");
    one("product_id", "products");
    if (name === "analytics_assortment_candidates") {
      one("typology_rank_rule_id", "typology_rank_rules");
      many("typology_value_ids", "store_typology_values");
    }
  } else if (name === "assortments") {
    one("typology_mapping_rule_id", "typology_mapping_rules");
    one("typology_rank_rule_id", "typology_rank_rules");
  }
  return links;
}
export function verifyTypologyLink(link: TypologyLink, source: PublishedRow) {
  const owner = link.owner;
  if (source.id !== link.id) throw new Error("Invalid response");
  const fields =
    link.name === "typology_snapshots"
      ? ["store_id", "period"]
      : link.name === "assortments"
        ? ["period", "product_id", "gtin"]
        : link.name === "store_typology_values" &&
            owner.typology_value_id === link.id
          ? ["snapshot_id", "category_key", "category_name", "typology_value"]
          : [];
  if (
    fields.some(
      (field) =>
        owner[field] !== null &&
        owner[field] !== undefined &&
        source[field] !== owner[field],
    )
  )
    throw new Error("Invalid response");
  if (
    link.name === "typology_snapshots" &&
    source.store_match_status !== "matched"
  )
    throw new Error("Invalid response");
}
