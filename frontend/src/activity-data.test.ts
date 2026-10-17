import { expect, it } from "vitest";
import {
  activityRow,
  activityGrid,
  activityObservation,
  verifyActivityObservation,
} from "./activity-data";
import {
  syntheticActivities,
  syntheticActivity,
  syntheticActivityObservation,
  activityObservationIds,
} from "../test/activity-fixture";
import { syntheticId } from "../test/published-fixture";
const period = { from: "2026-01", to: "2026-03", months: 3 };
it("preserves three independent types, zero, missing months and multiple ambiguous proofs", () => {
  const grid = activityGrid(
    syntheticActivities().map(activityRow),
    syntheticId,
    period,
  );
  expect(grid[0]!.rows.calls?.activity_count).toBe(0);
  expect(grid[0]!.rows.field_visits?.activity_count).toBe(3);
  expect(grid[0]!.rows.crowdsourced_visits).toBeUndefined();
  expect(Object.values(grid[1]!.rows)).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(grid[2]!.rows.calls?.activity_count).toBeNull();
  expect(grid[2]!.rows.calls?.observation_ids).toEqual(activityObservationIds);
});
it.each([
  { activity_type: "unknown" },
  { activity_count: -1 },
  { activity_count: 0.5 },
  { activity_count: "1" },
  { source_row_count: 0 },
  { source_row_count: 2 },
  { ambiguous: true },
  { ambiguous: null },
  { observation_ids: [] },
  { observation_ids: [syntheticId, syntheticId] },
  { period: "2026-01-02" },
])("rejects contradictory or malformed activity cells %j", (overrides) => {
  expect(() => activityRow(syntheticActivity(overrides))).toThrow();
});
it("permits a null measure with unknown ambiguity and source metadata", () => {
  expect(
    activityRow(
      syntheticActivity({
        source_row_count: null,
        ambiguous: null,
        activity_count: null,
        observation_ids: null,
      }),
    ).activity_count,
  ).toBeNull();
});
it("rejects duplicate or out-of-scope cells", () => {
  const row = activityRow(syntheticActivity());
  for (const items of [
    [row, row],
    [{ ...row, store_id: activityObservationIds[0]! }],
    [{ ...row, period: "2026-04-01" }],
  ])
    expect(() => activityGrid(items, syntheticId, period)).toThrow();
});
it.each([
  { id: activityObservationIds[1] },
  { store_id: null },
  { period: "2026-03-01" },
  { activity_type: "field_visits" },
  { activity_count: 1 },
  { store_match_status: "unresolved" },
])("rejects changed live evidence identity/grain/value %j", (overrides) => {
  expect(() =>
    verifyActivityObservation(
      activityObservation(syntheticActivityObservation(overrides)),
      activityObservationIds[0]!,
      activityRow(syntheticActivity()),
    ),
  ).toThrow();
});
it("keeps individual ambiguous sources independent without requiring their sum", () => {
  const cell = activityRow(syntheticActivities()[2]);
  expect(() =>
    verifyActivityObservation(
      activityObservation(
        syntheticActivityObservation({
          period: "2026-03-01",
          activity_count: 9,
        }),
      ),
      activityObservationIds[0]!,
      cell,
    ),
  ).not.toThrow();
});
