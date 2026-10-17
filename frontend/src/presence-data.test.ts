import { expect, it } from "vitest";
import { presenceDecoders, presenceRows, categoryGrid } from "./presence-data";
import {
  syntheticCategory,
  syntheticCategories,
  syntheticDistribution,
  syntheticDistributions,
  syntheticShelf,
  categoryCode,
} from "../test/presence-fixture";
import { syntheticId } from "../test/published-fixture";
const period = { from: "2026-01", to: "2026-03", months: 3 };
it("preserves ratios above 100%, unknown categories, inferred absence and missing calendar cells", () => {
  const rows = syntheticCategories().map(
    presenceDecoders.analytics_store_category_month,
  );
  expect(
    categoryGrid(rows, categoryCode, period).map((c) => c.row?.shelf_share),
  ).toEqual(["1.5", undefined, null]);
  expect(rows[0]!.inferred_absence_rows).toBe("1");
  const products = syntheticDistributions().map(
    presenceDecoders.analytics_distribution_product_month,
  );
  expect(products[1]!.presence_value).toBe(0);
  expect(products[2]!.presence_value).toBeNull();
  expect(products[0]!.product_key).not.toBe(products[1]!.product_key);
});
it.each([
  { distribution_product_count: -1 },
  { present_products: 3 },
  { distribution_ambiguous_products: 1 },
  { distribution_ambiguous_products: null },
  { shelf_total_value: "0" },
  { shelf_ambiguous: true },
  { inferred_absence_rows: "-1" },
  { period: "2026-01-02" },
  { observed_presence_rate: 0.5 },
  { observed_presence_rate: "-0.000000000000000001" },
  { observed_presence_rate: "1.000000000000000001" },
  { inferred_absence_rows: "0.5" },
])("rejects contradictory category summaries %j", (overrides) => {
  expect(() =>
    presenceDecoders.analytics_store_category_month(
      syntheticCategory(overrides),
    ),
  ).toThrow();
});
it.each([
  { presence_value: 2 },
  { inferred_absence_rows: 1 },
  { product_key: "source:unknown" },
  { product_key: "product:00000000-0000-4000-8000-000000000009" },
  { product_id: null },
  { ambiguous: true },
  { source_row_count: 2 },
  { inferred_absence_rows: 2 },
  { observation_ids: [] },
  { observation_ids: [syntheticId, syntheticId] },
])("rejects contradictory product evidence %j", (overrides) => {
  expect(() =>
    presenceDecoders.analytics_distribution_product_month(
      syntheticDistribution(overrides),
    ),
  ).toThrow();
});
it.each([
  { total_value: "0" },
  { total_value: "-1" },
  { company_value: "-1" },
  { shelf_share: "-0.5" },
  { total_value: null },
  { company_value: null },
  { ambiguous: true },
])("rejects invalid shelf denominators or ambiguous values %j", (overrides) => {
  expect(() =>
    presenceDecoders.analytics_shelf_category_month(syntheticShelf(overrides)),
  ).toThrow();
});
it("keeps a genuine zero ratio and permits null for a zero denominator", () => {
  expect(
    presenceDecoders.analytics_shelf_category_month(
      syntheticShelf({ company_value: "0", shelf_share: "0" }),
    ).shelf_share,
  ).toBe("0");
  expect(
    presenceDecoders.analytics_shelf_category_month(
      syntheticShelf({ total_value: "0.00", shelf_share: null }),
    ).shelf_share,
  ).toBeNull();
});
it("rejects duplicate keys, unexpected stores, categories and months", () => {
  const row =
    presenceDecoders.analytics_store_category_month(syntheticCategory());
  for (const rows of [
    [row, row],
    [{ ...row, store_id: "00000000-0000-4000-8000-000000000009" }],
    [{ ...row, category_code: "B" }],
    [{ ...row, period: "2026-04-01" }],
  ]) {
    expect(() =>
      presenceRows(
        "analytics_store_category_month",
        rows,
        syntheticId,
        period,
        categoryCode,
      ),
    ).toThrow();
  }
});

it("accepts assortment-only categories without inventing presence or shelf values", () => {
  const row = presenceDecoders.analytics_store_category_month(
    syntheticCategory({
      distribution_product_count: null,
      distribution_ambiguous_products: null,
      distribution_unmatched_products: null,
      inferred_absence_rows: null,
      present_products: null,
      observed_presence_rate: null,
      shelf_source_row_count: null,
      shelf_ambiguous: null,
      shelf_company_value: null,
      shelf_total_value: null,
      shelf_share: null,
      exact_assortment_candidate_count: 2,
    }),
  );
  expect(row.exact_assortment_candidate_count).toBe(2);
  expect(row.observed_presence_rate).toBeNull();
  expect(row.shelf_share).toBeNull();
});
it("keeps exact endpoint presence rates and integral serialized absence counts", () => {
  for (const [present_products, observed_presence_rate] of [
    [0, "0"],
    [2, "1"],
  ] as const) {
    expect(
      presenceDecoders.analytics_store_category_month(
        syntheticCategory({
          present_products,
          observed_presence_rate,
          inferred_absence_rows: "1.00",
        }),
      ).observed_presence_rate,
    ).toBe(observed_presence_rate);
  }
});
