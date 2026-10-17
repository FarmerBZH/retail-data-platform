import { syntheticId, syntheticRow } from "./published-fixture";
import type { TypologyName } from "../src/typology-data";
export const typologyIds = Array.from(
  { length: 6 },
  (_, i) => `00000000-0000-4000-8000-${(i + 2).toString().padStart(12, "0")}`,
);
export function syntheticTypology(
  name: TypologyName,
  overrides: Record<string, unknown> = {},
) {
  return syntheticRow(name, {
    store_id: syntheticId,
    period: "2026-01-01",
    ...(name === "analytics_typology_month"
      ? {
          typology_value_id: typologyIds[0],
          snapshot_id: typologyIds[1],
          category_key: "synthetic-category",
          category_name: "Synthetic category",
          typology_value: "Synthetic <img src=x> value",
          rank_rule_ids: [typologyIds[2], typologyIds[3]],
          rank_candidate_count: 2,
          mapping_issue: true,
        }
      : {
          assortment_id: typologyIds[4],
          product_id: null,
          gtin: "00000000000001",
          typology_rank_rule_id: typologyIds[2],
          typology_value_ids: [typologyIds[0]],
          product_match_status: "unresolved",
          typology_match_status: "ambiguous",
        }),
    ...overrides,
  });
}
export function syntheticTypologyRows(name: TypologyName) {
  return name === "analytics_typology_month"
    ? [
        syntheticTypology(name),
        syntheticTypology(name, {
          typology_value_id: typologyIds[5],
          snapshot_id: typologyIds[4],
          typology_value: "Contradictory value",
        }),
      ]
    : name === "analytics_assortment_candidates"
      ? []
      : [syntheticTypology(name)];
}
