import { expect, it } from "vitest";
import { syntheticMonth } from "../test/monthly-fixture";
import {
  monthlySale,
  monthlyGrid,
  totalFor,
  periodUnitRevenue,
  plotValue,
  monthlySummary,
} from "./monthly-sales";
const id = syntheticMonth().store_id;
const period = { from: "2026-01", to: "2026-03", months: 3 };
it("builds explicit holes and separate exact measure coverage without joining nested data", () => {
  const grid = monthlyGrid(
    [
      monthlySale(
        syntheticMonth({
          category_details: [{ revenue: "999" }],
          revenue: "0.1",
        }),
      ),
      monthlySale(
        syntheticMonth({ period: "2026-03-01", revenue: "0.2", units: null }),
      ),
    ],
    id,
    period,
  );
  expect(grid[1]?.row).toBeUndefined();
  expect(totalFor(grid, "revenue")).toEqual({
    value: "0.3",
    covered: 2,
    expected: 3,
  });
  expect(totalFor(grid, "units")).toEqual({
    value: "2",
    covered: 1,
    expected: 3,
  });
  expect(totalFor(grid, "calls").value).toBeNull();
  expect(totalFor(grid, "field_visits").value).toBe("0");
  expect(periodUnitRevenue(grid)).toBeNull();
});
it("preserves zero, negative values, partial diagnostics and unavailable ratios", () => {
  const grid = monthlyGrid(
    [monthlySale(syntheticMonth({ revenue: "-0.1", units: "0" }))],
    id,
    { ...period, to: period.from, months: 1 },
  );
  expect(totalFor(grid, "revenue").value).toBe("-0.1");
  expect(periodUnitRevenue(grid)).toBeNull();
  const ambiguous = monthlySale(
    syntheticMonth({
      revenue: null,
      units: null,
      register_ambiguous_products: 1,
    }),
  );
  expect(
    totalFor(monthlyGrid([ambiguous], id, period), "revenue").value,
  ).toBeNull();
  expect(ambiguous.reportedRevenue).toBe("0.1");
});
it("calculates a ratio from complete matching months only", () => {
  const grid = monthlyGrid([monthlySale(syntheticMonth())], id, {
    ...period,
    to: period.from,
    months: 1,
  });
  expect(periodUnitRevenue(grid)).toBe("0.05");
});
it.each([
  [syntheticMonth(), syntheticMonth()],
  [syntheticMonth({ store_id: "00000000-0000-4000-8000-000000000002" })],
  [syntheticMonth({ period: "2025-12-01" })],
  [syntheticMonth({ register_ambiguous_products: 1 })],
  [syntheticMonth({ register_ambiguous_products: null })],
  [syntheticMonth({ has_register: false })],
  [syntheticMonth({ register_revenue_product_count: 1 })],
])(
  "rejects inconsistent context, duplicate months or ambiguous complete measures",
  (...rows) => {
    expect(() => monthlyGrid(rows.map(monthlySale), id, period)).toThrow();
  },
);
it.each([
  { revenue: 0.1 },
  { revenue: "1e999" },
  { unambiguous_reported_revenue: "1e-999" },
  { period: "2026-01-02" },
  { register_product_count: -1 },
  { has_register: "true" },
])("validates untrusted month rows", (row) => {
  expect(() => monthlySale(syntheticMonth(row))).toThrow();
});
it("uses only finite chart coordinates and keeps zero distinct from missing", () => {
  expect(plotValue("0")).toBe(0);
  expect(plotValue("-0.1")).toBe(-0.1);
  expect(plotValue(null)).toBeNull();
  expect(plotValue("1e400")).toBeNull();
  expect(plotValue("1e-400")).toBeNull();
});
it("generates a month grid across a year", () => {
  expect(
    monthlyGrid([], id, { from: "2025-12", to: "2026-02", months: 3 }).map(
      (cell) => cell.month,
    ),
  ).toEqual(["2025-12", "2026-01", "2026-02"]);
});

it("omits chart points when finite endpoints have an infinite span", () => {
  const grid = monthlyGrid(
    [
      monthlySale(syntheticMonth({ revenue: "1e308" })),
      monthlySale(syntheticMonth({ period: "2026-02-01", revenue: "-1e308" })),
    ],
    id,
    { from: "2026-01", to: "2026-02", months: 2 },
  );
  expect(monthlySummary(grid).geometry).toEqual([null, null]);
  expect(monthlySummary(grid).totals[0]?.value).toBe("0");
});
