import type { PublishedRow } from "./published-data";
import { expect, it } from "vitest";
import {
  typologyCalendar,
  typologyConflict,
  typologyDecoder,
  typologyLinks,
  typologyResource,
  verifyTypologyLink,
} from "./typology-data";
import {
  syntheticTypology,
  syntheticTypologyRows,
  typologyIds,
} from "../test/typology-fixture";
import { syntheticId, syntheticRow } from "../test/published-fixture";
const resource = typologyResource("analytics_typology_month"),
  decode = typologyDecoder(resource),
  period = { from: "2026-01", to: "2026-03", months: 3 };
it("keeps conflicting snapshots and absent months without carrying values", () => {
  const rows = syntheticTypologyRows("analytics_typology_month").map(decode),
    grid = typologyCalendar(resource, rows, syntheticId, period);
  expect(grid.map((c) => c.rows.length)).toEqual([2, 0, 0]);
  expect(typologyConflict(rows[0]!, rows)).toBe(true);
  expect(typologyLinks(resource.name, rows[0]!)).toHaveLength(4);
});
it.each([
  { rank_candidate_count: -1 },
  { rank_candidate_count: 1 },
  { rank_rule_ids: [typologyIds[2], typologyIds[2]] },
  { period: "2026-01-02" },
])("rejects malformed source metadata %j", (overrides) =>
  expect(() =>
    decode(
      syntheticTypology(resource.name as "analytics_typology_month", overrides),
    ),
  ).toThrow(),
);
it.each([
  { store_id: null },
  { store_id: typologyIds[0] },
  { period: null },
  { period: "2026-04-01" },
])("rejects out-of-scope rows %j", (overrides) =>
  expect(() =>
    typologyCalendar(
      resource,
      [decode(syntheticTypology("analytics_typology_month", overrides))],
      syntheticId,
      period,
    ),
  ).toThrow(),
);
it("rejects duplicate IDs without treating multiple snapshots as duplicates", () => {
  const r = decode(syntheticTypology("analytics_typology_month"));
  expect(() =>
    typologyCalendar(resource, [r, r], syntheticId, period),
  ).toThrow();
});
it("retains unknown rank metadata and null values independently of zero", () =>
  expect(
    decode(
      syntheticTypology("analytics_typology_month", {
        rank_rule_ids: null,
        rank_candidate_count: null,
        typology_value: null,
        mapping_issue: null,
      }),
    ).typology_value,
  ).toBeNull());
it("binds live snapshot to selected store/month and matched attribution", () => {
  const row = decode(syntheticTypology("analytics_typology_month")),
    link = typologyLinks(resource.name, row).find(
      (l) => l.name === "typology_snapshots",
    )!;
  const source = syntheticRow("typology_snapshots", {
    id: link.id,
    store_id: syntheticId,
    period: "2026-01-01",
    store_match_status: "matched",
  }) as PublishedRow;
  expect(() => verifyTypologyLink(link, source)).not.toThrow();
  for (const changes of [
    { id: typologyIds[0]! },
    { store_id: null },
    { period: "2026-03-01" },
    { store_match_status: "unresolved" },
  ])
    expect(() => verifyTypologyLink(link, { ...source, ...changes })).toThrow();
});
it("shows mapping and rank links only after opening a live assortment", () =>
  expect(
    typologyLinks(
      "assortments",
      syntheticRow("assortments", {
        typology_mapping_rule_id: typologyIds[0],
        typology_rank_rule_id: typologyIds[1],
      }) as PublishedRow,
    ).map((l) => l.name),
  ).toEqual(["typology_mapping_rules", "typology_rank_rules"]));

it("does not call an unknown category or missing value a contradiction", () => {
  const rows = syntheticTypologyRows("analytics_typology_month").map(decode);
  expect(typologyConflict({ ...rows[0]!, typology_value: null }, rows)).toBe(
    false,
  );
  expect(typologyConflict({ ...rows[0]!, category_key: null }, rows)).toBe(
    false,
  );
});
