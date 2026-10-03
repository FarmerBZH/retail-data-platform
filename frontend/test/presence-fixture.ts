import { syntheticRow, syntheticId } from "./published-fixture";
import { observationId, secondObservationId } from "./product-sales-fixture";
export const categoryCode = "A<img src=x>";
export function syntheticCategory(overrides: Record<string, unknown> = {}) {
  return syntheticRow("analytics_store_category_month", {
    store_id: syntheticId,
    period: "2026-01-01",
    category_code: categoryCode,
    distribution_product_count: 2,
    distribution_ambiguous_products: 0,
    distribution_unmatched_products: 1,
    present_products: 1,
    inferred_absence_rows: "1",
    observed_presence_rate: "0.5",
    shelf_source_row_count: 1,
    shelf_ambiguous: false,
    shelf_company_value: "3",
    shelf_total_value: "2",
    shelf_share: "1.5",
    exact_assortment_candidate_count: null,
    ...overrides,
  });
}
export function syntheticCategories() {
  return [
    syntheticCategory(),
    syntheticCategory({
      period: "2026-03-01",
      distribution_product_count: 1,
      distribution_ambiguous_products: 1,
      present_products: null,
      observed_presence_rate: null,
      inferred_absence_rows: "0",
      shelf_company_value: "0",
      shelf_total_value: "0",
      shelf_share: null,
    }),
    syntheticCategory({
      category_code: "B",
      observed_presence_rate: "0.25",
      distribution_product_count: 4,
      shelf_share: "0.1",
      shelf_company_value: "1",
      shelf_total_value: "10",
    }),
  ];
}
export function syntheticDistribution(overrides: Record<string, unknown> = {}) {
  return syntheticRow("analytics_distribution_product_month", {
    store_id: syntheticId,
    period: "2026-01-01",
    category_code: categoryCode,
    product_key: `product:${syntheticId}`,
    product_id: syntheticId,
    source_row_count: 1,
    ambiguous: false,
    presence_value: 1,
    inferred_absence_rows: 0,
    observation_ids: [observationId],
    ...overrides,
  });
}
export function syntheticDistributions() {
  return [
    syntheticDistribution(),
    syntheticDistribution({
      product_key: "source:unknown<img src=x>",
      product_id: null,
      presence_value: 0,
      inferred_absence_rows: 1,
    }),
    syntheticDistribution({
      period: "2026-03-01",
      source_row_count: 2,
      ambiguous: true,
      presence_value: null,
      observation_ids: [observationId, secondObservationId],
    }),
  ];
}
export function syntheticShelf(overrides: Record<string, unknown> = {}) {
  return syntheticRow("analytics_shelf_category_month", {
    store_id: syntheticId,
    period: "2026-01-01",
    category_code: categoryCode,
    source_row_count: 1,
    ambiguous: false,
    company_value: "3",
    total_value: "2",
    shelf_share: "1.5",
    observation_ids: [observationId],
    ...overrides,
  });
}
