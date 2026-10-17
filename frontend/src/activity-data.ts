import { publishedContract } from "./published-contract";
import { rowDecoder, rowKey } from "./published-data";
import type { PublishedRow } from "./published-data";
import type { Resource } from "./read-api";
import { calendarMonths } from "./month-period";
import type { MonthPeriod } from "./month-period";

export const activityTypes = [
  "calls",
  "field_visits",
  "crowdsourced_visits",
] as const;
export type ActivityType = (typeof activityTypes)[number];
export const activityLabels: Record<ActivityType, string> = {
  calls: "Appels",
  field_visits: "Visites terrain",
  crowdsourced_visits: "Visites participatives",
};
function resource(
  name: "analytics_activity_month" | "store_activity_metrics",
): Resource {
  const c = publishedContract[name];
  return {
    name,
    path: `/v1/data/${name}`,
    keys: c.keys,
    filters: c.filters,
    columns: Object.keys(c.fields),
  };
}
export const activityResource = resource("analytics_activity_month");
export const activityObservationResource = resource("store_activity_metrics");
export type ActivityRow = PublishedRow & {
  store_id: string;
  period: string;
  activity_type: ActivityType;
  source_row_count: number | null;
  ambiguous: boolean | null;
  activity_count: number | null;
  observation_ids: readonly string[] | null;
};
const decode = rowDecoder(activityResource);
export function activityRow(value: unknown): ActivityRow {
  const r = decode(value) as ActivityRow;
  if (
    !activityTypes.includes(r.activity_type) ||
    (r.source_row_count !== null &&
      (r.source_row_count < 1 ||
        (r.ambiguous !== null && r.ambiguous !== r.source_row_count > 1))) ||
    (r.activity_count !== null &&
      (r.activity_count < 0 || r.ambiguous !== false)) ||
    (r.observation_ids !== null &&
      (new Set(r.observation_ids).size !== r.observation_ids.length ||
        (r.source_row_count !== null &&
          r.observation_ids.length !== r.source_row_count)))
  )
    throw new Error("Invalid response");
  return r;
}
export function activityGrid(
  items: readonly ActivityRow[],
  storeId: string,
  period: MonthPeriod,
) {
  const months = calendarMonths(period),
    seen = new Set<string>();
  for (const r of items) {
    const key = rowKey(activityResource, r);
    if (
      r.store_id !== storeId ||
      !months.includes(r.period.slice(0, 7)) ||
      seen.has(key)
    )
      throw new Error("Invalid response");
    seen.add(key);
  }
  return months.map((month) => ({
    month,
    rows: Object.fromEntries(
      activityTypes.map((type) => [
        type,
        items.find(
          (r) => r.period === `${month}-01` && r.activity_type === type,
        ),
      ]),
    ) as Record<ActivityType, ActivityRow | undefined>,
  }));
}
export type ActivityCell = ReturnType<typeof activityGrid>[number];
const decodeObservation = rowDecoder(activityObservationResource);
export function activityObservation(value: unknown): PublishedRow {
  const r = decodeObservation(value);
  if (
    !activityTypes.includes(r.activity_type as ActivityType) ||
    (r.activity_count as number) < 0
  )
    throw new Error("Invalid response");
  return r;
}
export function verifyActivityObservation(
  row: PublishedRow,
  id: string,
  cell: ActivityRow,
) {
  if (
    row.id !== id ||
    row.store_id !== cell.store_id ||
    row.period !== cell.period ||
    row.activity_type !== cell.activity_type ||
    row.store_match_status !== "matched" ||
    (cell.ambiguous === false &&
      cell.activity_count !== null &&
      row.activity_count !== cell.activity_count)
  )
    throw new Error("Invalid response");
}
