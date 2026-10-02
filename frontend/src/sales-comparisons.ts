import { date, decimal, nullable, object, uuid } from "./api-validation";
import {
  addExact,
  formatExact,
  formatPercent,
  ratioExact,
  subtractExact,
} from "./exact-values";
import { calendarMonths, periodQuery, shiftMonth } from "./month-period";
import type { MonthPeriod } from "./month-period";
import { monthlyGrid, totalFor } from "./monthly-sales";
import type { MonthlySale } from "./monthly-sales";

function exactDecimal(value: unknown): string {
  const result = decimal(value);
  formatExact(result);
  return result;
}
// Only published complete revenue amounts are used; published ratios are never aggregated.
export function monthlyChange(value: unknown) {
  const row = object(value);
  const period = date(row.period);
  if (!period.endsWith("-01")) throw new Error("Invalid response");
  return {
    storeId: uuid(row.store_id),
    month: period.slice(0, 7),
    revenue: nullable(exactDecimal)(row.revenue),
    previousMonth: nullable(exactDecimal)(row.revenue_previous_month),
    previousYear: nullable(exactDecimal)(row.revenue_previous_year),
  };
}
export type MonthlyChange = ReturnType<typeof monthlyChange>;
export type ComparisonMode = "previous" | "year";
export class ComparisonConflictError extends Error {}

function sameAmount(a: string | null, b: string | null) {
  return a === null || b === null ? a === b : subtractExact(a, b) === "0";
}

export function referencePeriod(period: MonthPeriod, mode: ComparisonMode) {
  periodQuery(period);
  const offset = mode === "previous" ? -period.months : -12;
  const from = shiftMonth(period.from, offset);
  const to = shiftMonth(period.to, offset);
  return from && to ? { from, to, months: period.months } : undefined;
}

export function salesVariation(
  current: string | null,
  reference: string | null,
) {
  const canonical = reference === null ? null : addExact(reference, "0")!;
  const base =
    canonical === null
      ? "missing"
      : canonical === "0"
        ? "zero"
        : canonical.startsWith("-")
          ? "negative"
          : "positive";
  const absolute = subtractExact(current, reference);
  const relative = base === "positive" ? ratioExact(absolute, reference) : null;
  formatPercent(relative);
  return { current, reference, absolute, relative, base };
}

export function comparisonSummary(
  items: readonly MonthlyChange[],
  referenceItems: readonly MonthlySale[],
  storeId: string,
  period: MonthPeriod,
  mode: ComparisonMode,
) {
  const months = calendarMonths(period);
  const rows = new Map<string, MonthlyChange>();
  for (const row of items) {
    if (
      row.storeId !== storeId ||
      !months.includes(row.month) ||
      rows.has(row.month)
    )
      throw new Error("Invalid response");
    if (
      (!shiftMonth(row.month, -1) && row.previousMonth !== null) ||
      (!shiftMonth(row.month, -12) && row.previousYear !== null)
    )
      throw new Error("Invalid response");
    rows.set(row.month, row);
  }
  const reference = referencePeriod(period, mode);
  if (!reference && referenceItems.length) throw new Error("Invalid response");
  const referenceGrid = reference
    ? monthlyGrid(referenceItems, storeId, reference)
    : [];
  // Check only months covered by these reads. Equality is decimal, and null is not zero.
  const known = new Map<string, string | null>(
    months.map((month) => [month, rows.get(month)?.revenue ?? null]),
  );
  for (const cell of referenceGrid) {
    const amount = cell.row?.revenue ?? null;
    if (known.has(cell.month) && !sameAmount(known.get(cell.month)!, amount))
      throw new ComparisonConflictError("Inconsistent comparison");
    known.set(cell.month, amount);
  }
  for (const row of items) {
    for (const [month, amount] of [
      [shiftMonth(row.month, -1), row.previousMonth],
      [shiftMonth(row.month, -12), row.previousYear],
    ] as const) {
      if (month && known.has(month) && !sameAmount(known.get(month)!, amount))
        throw new ComparisonConflictError("Inconsistent comparison");
    }
  }
  const monthly = months.map((month) => {
    const row = rows.get(month);
    return {
      month,
      missing: !row,
      previousMonth: shiftMonth(month, -1),
      previousYear: shiftMonth(month, -12),
      monthVariation: salesVariation(
        row?.revenue ?? null,
        row?.previousMonth ?? null,
      ),
      yearVariation: salesVariation(
        row?.revenue ?? null,
        row?.previousYear ?? null,
      ),
    };
  });
  const referenceTotal = reference
    ? totalFor(referenceGrid, "revenue")
    : { value: null, covered: 0, expected: period.months };
  const currentValues = items
    .map((row) => row.revenue)
    .filter((value): value is string => value !== null);
  const current = {
    covered: currentValues.length,
    expected: period.months,
    value:
      currentValues.length === period.months
        ? currentValues.reduce<string>(
            (sum, value) => addExact(sum, value)!,
            "0",
          )
        : null,
  };
  const baseline =
    referenceTotal.covered === referenceTotal.expected
      ? referenceTotal.value
      : null;
  return {
    monthly,
    reference,
    current,
    referenceTotal,
    window: salesVariation(current.value, baseline),
  };
}
