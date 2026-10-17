import { expect, it } from "vitest";
import { syntheticChange } from "../test/comparison-fixture";
import { syntheticMonth } from "../test/monthly-fixture";
import { monthlySale } from "./monthly-sales";
import {
  comparisonSummary,
  ComparisonConflictError,
  monthlyChange,
  referencePeriod,
  salesVariation,
} from "./sales-comparisons";
import { shiftMonth } from "./month-period";

const id = syntheticChange().store_id;
const period = { from: "2026-01", to: "2026-02", months: 2 };
it("uses the k immediately preceding months or an exact twelve-month shift", () => {
  expect(referencePeriod(period, "previous")).toEqual({
    from: "2025-11",
    to: "2025-12",
    months: 2,
  });
  expect(referencePeriod(period, "year")).toEqual({
    from: "2025-01",
    to: "2025-02",
    months: 2,
  });
  expect(
    referencePeriod({ from: "2026-12", to: "2027-02", months: 3 }, "previous"),
  ).toEqual({ from: "2026-09", to: "2026-11", months: 3 });
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  expect(shiftMonth("0001-01", -1)).toBeUndefined();
  expect(shiftMonth("9999-12", 1)).toBeUndefined();
  expect(
    referencePeriod({ from: "0001-01", to: "0001-02", months: 2 }, "year"),
  ).toBeUndefined();
});
it("sums complete amounts instead of averaging published monthly ratios", () => {
  const result = comparisonSummary(
    [
      monthlyChange(syntheticChange()),
      monthlyChange(
        syntheticChange({
          period: "2026-02-01",
          revenue: "1.1",
          revenue_previous_month: "110",
          revenue_previous_year: "-1",
        }),
      ),
    ],
    [
      monthlySale(syntheticMonth({ period: "2025-11-01", revenue: "100" })),
      monthlySale(syntheticMonth({ period: "2025-12-01", revenue: "1" })),
    ],
    id,
    period,
    "previous",
  );
  expect(result.window).toEqual({
    current: "111.1",
    reference: "101",
    absolute: "10.1",
    relative: "0.1",
    base: "positive",
  });
  expect(result.monthly[1]?.monthVariation.absolute).toBe("-108.9");
});
it("keeps missing intermediate calendar months instead of using the last observed month", () => {
  const result = comparisonSummary(
    [
      monthlyChange(syntheticChange({ revenue_previous_month: null })),
      monthlyChange(
        syntheticChange({
          period: "2026-03-01",
          revenue: "0.3",
          revenue_previous_month: null,
        }),
      ),
    ],
    [],
    id,
    { from: "2026-01", to: "2026-03", months: 3 },
    "previous",
  );
  expect(result.monthly[1]?.missing).toBe(true);
  expect(result.monthly[2]?.previousMonth).toBe("2026-02");
  expect(result.monthly[2]?.monthVariation.absolute).toBeNull();
  expect(result.window.absolute).toBeNull();
  expect(result.current).toEqual({ covered: 2, expected: 3, value: null });
});
it.each([
  ["0.3", "0.1", "0.2", "2", "positive"],
  ["0", "1", "-1", "-1", "positive"],
  ["5", "0", "5", null, "zero"],
  ["5", "-1", "6", null, "negative"],
  [null, "1", null, null, "positive"],
  ["5", null, null, null, "missing"],
] as const)(
  "preserves exact differences and explicitly qualifies the reference base",
  (current, reference, absolute, relative, base) => {
    expect(salesVariation(current, reference)).toEqual({
      current,
      reference,
      absolute,
      relative,
      base,
    });
  },
);
it("does not use a partial reference sum as a comparison base", () => {
  const result = comparisonSummary(
    [
      monthlyChange(syntheticChange()),
      monthlyChange(
        syntheticChange({
          period: "2026-02-01",
          revenue_previous_month: "110",
        }),
      ),
    ],
    [monthlySale(syntheticMonth({ period: "2025-12-01", revenue: "1" }))],
    id,
    period,
    "previous",
  );
  expect(result.current.covered).toBe(2);
  expect(result.referenceTotal.covered).toBe(1);
  expect(result.window.reference).toBeNull();
  expect(result.window.absolute).toBeNull();
});
it.each([
  [syntheticChange(), syntheticChange()],
  [syntheticChange({ store_id: "00000000-0000-4000-8000-000000000002" })],
  [syntheticChange({ period: "2025-12-01" })],
])(
  "rejects duplicate months and inconsistent store/period context",
  (...rows) => {
    expect(() =>
      comparisonSummary(rows.map(monthlyChange), [], id, period, "previous"),
    ).toThrow();
  },
);
it.each([
  { revenue: 1 },
  { revenue_previous_month: "1e999" },
  { period: "2026-01-02" },
])("rejects invalid published decimals and dates", (override) => {
  expect(() => monthlyChange(syntheticChange(override))).toThrow();
});
it("preserves unavailable calendar references at the earliest supported year", () => {
  const early = { from: "0001-01", to: "0001-01", months: 1 };
  const row = monthlyChange(
    syntheticChange({
      period: "0001-01-01",
      revenue_previous_month: null,
      revenue_previous_year: null,
    }),
  );
  const result = comparisonSummary([row], [], id, early, "previous");
  expect(result.reference).toBeUndefined();
  expect(result.window.reference).toBeNull();
  expect(() =>
    comparisonSummary(
      [{ ...row, previousMonth: "1" }],
      [],
      id,
      early,
      "previous",
    ),
  ).toThrow();
});

it.each(["2", null] as const)(
  "rejects conflicting M-1 amounts including null versus zero",
  (referenceAmount) => {
    const current = monthlyChange(
      syntheticChange({ revenue_previous_month: "0" }),
    );
    const baseline = monthlySale(
      syntheticMonth({ period: "2025-12-01", revenue: referenceAmount }),
    );
    expect(() =>
      comparisonSummary(
        [current],
        [baseline],
        id,
        { from: "2026-01", to: "2026-01", months: 1 },
        "previous",
      ),
    ).toThrow(ComparisonConflictError);
  },
);
it("rejects a last-observed-month lag when the actual previous calendar month is absent", () => {
  const items = [
    monthlyChange(syntheticChange()),
    monthlyChange(
      syntheticChange({
        period: "2026-03-01",
        revenue: "200",
        revenue_previous_month: "110",
      }),
    ),
  ];
  const baseline = monthlySale(
    syntheticMonth({ period: "2025-12-01", revenue: "1" }),
  );
  expect(() =>
    comparisonSummary(
      items,
      [baseline],
      id,
      { from: "2026-01", to: "2026-03", months: 3 },
      "previous",
    ),
  ).toThrow(ComparisonConflictError);
});
it("rejects a contradictory published N-1 amount", () => {
  expect(() =>
    comparisonSummary(
      [monthlyChange(syntheticChange({ revenue_previous_year: "1" }))],
      [monthlySale(syntheticMonth({ period: "2025-01-01", revenue: "2" }))],
      id,
      { from: "2026-01", to: "2026-01", months: 1 },
      "year",
    ),
  ).toThrow(ComparisonConflictError);
});
it("checks overlapping current/reference months in windows longer than a year", () => {
  const items = [
    monthlyChange(syntheticChange({ revenue_previous_month: null })),
    monthlyChange(
      syntheticChange({
        period: "2027-01-01",
        revenue: "120",
        revenue_previous_month: null,
        revenue_previous_year: "110",
      }),
    ),
  ];
  const baseline = [
    monthlySale(syntheticMonth({ period: "2025-01-01", revenue: "0" })),
    monthlySale(syntheticMonth({ period: "2026-01-01", revenue: "111" })),
  ];
  expect(() =>
    comparisonSummary(
      items,
      baseline,
      id,
      { from: "2026-01", to: "2027-01", months: 13 },
      "year",
    ),
  ).toThrow(ComparisonConflictError);
});
it("accepts equivalent decimal encodings across collections", () => {
  const result = comparisonSummary(
    [
      monthlyChange(
        syntheticChange({ revenue: "0.1", revenue_previous_month: "0.10" }),
      ),
    ],
    [monthlySale(syntheticMonth({ period: "2025-12-01", revenue: "1e-1" }))],
    id,
    { from: "2026-01", to: "2026-01", months: 1 },
    "previous",
  );
  expect(result.window.absolute).toBe("0");
});
