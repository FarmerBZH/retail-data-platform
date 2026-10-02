import { syntheticRow, syntheticId } from "./published-fixture";
export const observationId = "00000000-0000-4000-8000-000000000002";
export const secondObservationId = "00000000-0000-4000-8000-000000000003";
// Fully synthetic product cells, including distinct unresolved source identities.
export function syntheticProductSale(overrides: Record<string, unknown> = {}) {
  return syntheticRow("analytics_register_product_month", {
    store_id: syntheticId,
    period: "2026-01-01",
    source_gtin: "00000000000001",
    product_id: null,
    source_row_count: 1,
    ambiguous: false,
    unmatched_product_rows: 1,
    observation_ids: [observationId],
    source_kinds: ["monthly"],
    revenue: "0.1",
    units: 0,
    volume: "0.2",
    revenue_reported_rows: 1,
    units_reported_rows: 1,
    ...overrides,
  });
}
export function syntheticProductRows() {
  return [
    syntheticProductSale(),
    syntheticProductSale({
      source_gtin: "00000000000002",
      revenue: "-0.2",
      units: -2,
      volume: "-7",
    }),
    syntheticProductSale({
      source_gtin: "00000000000003",
      product_id: syntheticId,
      unmatched_product_rows: 0,
    }),
    syntheticProductSale({
      period: "2026-03-01",
      revenue: null,
      units: null,
      volume: null,
      source_row_count: 2,
      ambiguous: true,
      revenue_reported_rows: 2,
      units_reported_rows: 2,
      unmatched_product_rows: 2,
      observation_ids: [observationId, secondObservationId],
    }),
  ];
}
