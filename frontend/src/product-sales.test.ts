import { expect, it } from "vitest";
import {
  productSale,
  productRows,
  productGrid,
  productGeometry,
} from "./product-sales";
import {
  syntheticProductSale,
  syntheticProductRows,
} from "../test/product-sales-fixture";
import { syntheticId } from "../test/published-fixture";
const period = { from: "2026-01", to: "2026-03", months: 3 };
it("keeps unresolved GTINs distinct, exact returns, zero units and heterogeneous volumes", () => {
  const rows = productRows(
    syntheticProductRows().map(productSale),
    syntheticId,
    period,
  );
  expect(rows).toHaveLength(4);
  expect(rows[0]?.revenue).toBe("0.1");
  expect(rows[0]?.units).toBe(0);
  expect(rows[1]?.revenue).toBe("-0.2");
  expect(rows[1]?.volume).toBe("-7");
  expect(rows[0]?.product_id).toBeNull();
  expect(rows[1]?.product_id).toBeNull();
  expect(
    productGrid(rows, "00000000000001", period).map((c) => c.row?.revenue),
  ).toEqual(["0.1", undefined, null]);
});
it.each([
  { ambiguous: true },
  { ambiguous: null },
  { source_row_count: -1 },
  { period: "2026-01-02" },
  { revenue: 0.1 },
  { units: 1.2 },
  { source_gtin: "123456789012345" },
  { observation_ids: [] },
  { observation_ids: [syntheticId, syntheticId] },
  { revenue_reported_rows: 0 },
  { units_reported_rows: 0 },
  { product_id: syntheticId },
])("rejects contradictory or malformed published cells %j", (override) => {
  expect(() => productSale(syntheticProductSale(override))).toThrow();
});
it("preserves conflicting product links without claiming unmatched source rows", () => {
  const row = productSale(
    syntheticProductSale({
      source_row_count: 2,
      ambiguous: true,
      product_id: null,
      unmatched_product_rows: 0,
      revenue: null,
      units: null,
      volume: null,
      revenue_reported_rows: 2,
      units_reported_rows: 2,
      observation_ids: [syntheticId, "00000000-0000-4000-8000-000000000002"],
    }),
  );
  expect(row.product_id).toBeNull();
  expect(row.unmatched_product_rows).toBe(0);
});
it("rejects duplicated grains, wrong stores and out-of-range months", () => {
  const row = productSale(syntheticProductSale());
  expect(() => productRows([row, row], syntheticId, period)).toThrow();
  expect(() =>
    productRows(
      [{ ...row, store_id: "00000000-0000-4000-8000-000000000009" }],
      syntheticId,
      period,
    ),
  ).toThrow();
  expect(() =>
    productRows([{ ...row, period: "2026-04-01" }], syntheticId, period),
  ).toThrow();
});
it("omits unsafe chart geometry while retaining exact source values", () => {
  expect(productGeometry(["-1e308", "1e308"])).toEqual([null, null]);
  expect(productGeometry(["1e400", "1e-400", "0", "-0.1"])).toEqual([
    null,
    null,
    0,
    -0.1,
  ]);
});
