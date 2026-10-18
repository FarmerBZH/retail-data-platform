import { expect, it } from "vitest";
import {
  productSale,
  productRows,
  productGrid,
  productGeometry,
  hasSupplementaryRevision,
  hasConventionZero,
} from "../../../src/features/sales/product-sales";
import {
  syntheticProductSale,
  syntheticProductRows,
} from "../../fixtures/product-sales-fixture";
import { syntheticId } from "../../fixtures/published-fixture";
import {
  observationId,
  secondObservationId,
} from "../../fixtures/product-sales-fixture";
const period = { from: "2026-01", to: "2026-03", months: 3 };
it("accepts a supplementary revision while retaining both observations", () => {
  const row = productSale(
    syntheticProductSale({
      source_row_count: 2,
      source_kinds: ["monthly", "supplement"],
      observation_ids: [observationId, secondObservationId],
      revenue_reported_rows: 2,
      units_reported_rows: 2,
      unmatched_product_rows: 2,
    }),
  );
  expect(hasSupplementaryRevision(row)).toBe(true);
  expect(row.revenue).toBe("0.1");
  expect(row.observation_ids).toHaveLength(2);
});
it.each([["monthly"], ["supplement"]])(
  "rejects multiple unambiguous rows without revision evidence %j",
  (kind) => {
    expect(() =>
      productSale(
        syntheticProductSale({
          source_row_count: 2,
          source_kinds: [kind],
          observation_ids: [observationId, secondObservationId],
        }),
      ),
    ).toThrow();
  },
);
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
  { units_reported_rows: 0, units: 5 },
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

it.each(["0", "-0.000", "0e-100"])(
  "labels convention zero %s while retaining raw reporting counts",
  (revenue) => {
    const row = productSale(
      syntheticProductSale({
        revenue,
        revenue_reported_rows: 0,
        units_reported_rows: 0,
      }),
    );
    expect(hasConventionZero(row, "revenue")).toBe(true);
    expect(hasConventionZero(row, "units")).toBe(true);
    expect(row.revenue_reported_rows).toBe(0);
  },
);
it("keeps ordinary blanks and reported zero distinct from convention zero", () => {
  const blank = productSale(
    syntheticProductSale({ revenue: null, revenue_reported_rows: 0 }),
  );
  expect(hasConventionZero(blank, "revenue")).toBe(false);
  expect(hasConventionZero(productSale(syntheticProductSale()), "units")).toBe(
    false,
  );
});
it.each([
  { source_kinds: [] },
  { source_kinds: ["supplement"] },
  { source_kinds: ["monthly", "supplement"] },
])(
  "rejects unreported zero without unique monthly evidence %j",
  ({ source_kinds }) => {
    expect(() =>
      productSale(
        syntheticProductSale({
          revenue: "0",
          revenue_reported_rows: 0,
          source_kinds,
        }),
      ),
    ).toThrow();
  },
);
