import {
  boolean,
  date,
  decimal,
  nullable,
  object,
  uuid,
} from "./api-validation";
import { addExact, formatExact, ratioExact } from "./exact-values";
import { calendarMonths } from "./month-period";
import type { MonthPeriod } from "./month-period";

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid response");
  return value;
}
function exactDecimal(value: unknown): string {
  const result = decimal(value);
  formatExact(result);
  return result;
}
export const measures = [
  "revenue",
  "units",
  "calls",
  "field_visits",
  "crowdsourced_visits",
] as const;
export type Measure = (typeof measures)[number];
export function monthlySale(value: unknown) {
  const row = object(value);
  const period = date(row.period);
  if (!period.endsWith("-01")) throw new Error("Invalid response");
  return {
    storeId: uuid(row.store_id),
    month: period.slice(0, 7),
    revenue: nullable(exactDecimal)(row.revenue),
    units: nullable(exactDecimal)(row.units),
    calls: nullable((v) => String(count(v)))(row.calls),
    field_visits: nullable((v) => String(count(v)))(row.field_visits),
    crowdsourced_visits: nullable((v) => String(count(v)))(
      row.crowdsourced_visits,
    ),
    reportedRevenue: nullable(exactDecimal)(row.unambiguous_reported_revenue),
    reportedUnits: nullable(exactDecimal)(row.unambiguous_reported_units),
    products: nullable(count)(row.register_product_count),
    ambiguous: nullable(count)(row.register_ambiguous_products),
    revenueProducts: nullable(count)(row.register_revenue_product_count),
    unitsProducts: nullable(count)(row.register_units_product_count),
    hasRegister: boolean(row.has_register),
  };
}
export type MonthlySale = ReturnType<typeof monthlySale>;
export function monthlyGrid(
  items: readonly MonthlySale[],
  storeId: string,
  period: MonthPeriod,
) {
  const months = calendarMonths(period);
  const rows = new Map<string, MonthlySale>();
  for (const row of items) {
    if (
      row.storeId !== storeId ||
      !months.includes(row.month) ||
      rows.has(row.month)
    )
      throw new Error("Invalid response");
    if (row.ambiguous !== 0 && (row.revenue !== null || row.units !== null))
      throw new Error("Invalid response");
    if (
      !row.hasRegister &&
      [row.revenue, row.units, row.reportedRevenue, row.reportedUnits].some(
        (value) => value !== null,
      )
    )
      throw new Error("Invalid response");
    if (
      row.revenue !== null &&
      (!(row.products && row.products > 0) ||
        row.revenueProducts !== row.products)
    )
      throw new Error("Invalid response");
    if (
      row.units !== null &&
      (!(row.products && row.products > 0) ||
        row.unitsProducts !== row.products)
    )
      throw new Error("Invalid response");
    rows.set(row.month, row);
  }
  return months.map((month) => ({ month, row: rows.get(month) }));
}
export type MonthCell = ReturnType<typeof monthlyGrid>[number];
export function totalFor(grid: readonly MonthCell[], measure: Measure) {
  const values = grid
    .map(({ row }) => row?.[measure] ?? null)
    .filter((v): v is string => v !== null);
  return {
    value: values.length
      ? values.reduce<string>((total, value) => addExact(total, value)!, "0")
      : null,
    covered: values.length,
    expected: grid.length,
  };
}
export function periodUnitRevenue(grid: readonly MonthCell[]): string | null {
  if (
    !grid.length ||
    grid.some(({ row }) => !row || row.revenue === null || row.units === null)
  )
    return null;
  return ratioExact(
    totalFor(grid, "revenue").value,
    totalFor(grid, "units").value,
  );
}
export function plotValue(value: string | null): number | null {
  if (value === null) return null;
  // Only geometry uses binary numbers. Exact labels come from the source string.
  formatExact(value);
  const numeric = Number(value);
  if (
    !Number.isFinite(numeric) ||
    (numeric === 0 && /[1-9]/.test(value.split(/[eE]/)[0]!))
  )
    return null;
  return numeric;
}

// Prepare arithmetic before publishing UI state so failures remain local and retryable.
export function monthlySummary(grid: readonly MonthCell[]) {
  const totals = measures.map((measure) => ({
    measure,
    ...totalFor(grid, measure),
  }));
  const unitRevenue = periodUnitRevenue(grid);
  let geometry = grid.map(({ row }) => plotValue(row?.revenue ?? null));
  const points = geometry.filter((v): v is number => v !== null);
  // Finite endpoints can still have an infinite axis span.
  if (
    points.length &&
    !Number.isFinite(Math.max(...points) - Math.min(...points))
  )
    geometry = geometry.map(() => null);
  return { totals, unitRevenue, geometry };
}
