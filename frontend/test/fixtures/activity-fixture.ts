import { syntheticRow, syntheticId } from "./published-fixture";
export const activityObservationIds = [
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
export function syntheticActivity(overrides: Record<string, unknown> = {}) {
  return syntheticRow("analytics_activity_month", {
    store_id: syntheticId,
    period: "2026-01-01",
    activity_type: "calls",
    activity_count: 0,
    source_row_count: 1,
    ambiguous: false,
    observation_ids: [activityObservationIds[0]],
    ...overrides,
  });
}
export function syntheticActivities() {
  return [
    syntheticActivity(),
    syntheticActivity({ activity_type: "field_visits", activity_count: 3 }),
    syntheticActivity({
      period: "2026-03-01",
      activity_type: "calls",
      activity_count: null,
      source_row_count: 2,
      ambiguous: true,
      observation_ids: activityObservationIds,
    }),
    syntheticActivity({
      period: "2026-03-01",
      activity_type: "crowdsourced_visits",
      activity_count: 4,
    }),
  ];
}
export function syntheticActivityObservation(
  overrides: Record<string, unknown> = {},
) {
  return syntheticRow("store_activity_metrics", {
    id: activityObservationIds[0],
    source_key: "a".repeat(64),
    store_id: syntheticId,
    period: "2026-01-01",
    store_match_status: "matched",
    store_match_method: "synthetic-exact",
    activity_type: "calls",
    activity_count: 0,
    source_store_reference: "synthetic-store",
    source_store_label: "Synthetic <img src=x> activity",
    ...overrides,
  });
}
