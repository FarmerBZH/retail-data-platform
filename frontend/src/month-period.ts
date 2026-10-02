export const MAX_PERIOD_MONTHS = 120;
export type MonthPeriod = Readonly<{
  from: string;
  to: string;
  months: number;
}>;
export type PeriodValidation =
  { valid: true; period: MonthPeriod } | { valid: false; message: string };

function monthIndex(value: string): number | undefined {
  if (!/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) return undefined;
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
}

export function validatePeriod(from: string, to: string): PeriodValidation {
  const start = monthIndex(from);
  const end = monthIndex(to);
  if (start === undefined || end === undefined)
    return {
      valid: false,
      message: "Renseignez deux mois valides au format AAAA-MM.",
    };
  if (start > end)
    return {
      valid: false,
      message: "Le mois de début doit précéder ou égaler le mois de fin.",
    };
  const months = end - start + 1;
  if (months > MAX_PERIOD_MONTHS)
    return {
      valid: false,
      message: `La période ne peut pas dépasser ${MAX_PERIOD_MONTHS} mois inclusifs.`,
    };
  return { valid: true, period: { from, to, months } };
}

// API bounds are calendar month strings; never parse them through a timezone.
export function periodQuery(period: MonthPeriod) {
  const checked = validatePeriod(period.from, period.to);
  if (!checked.valid || checked.period.months !== period.months)
    throw new Error("Invalid month period");
  return { period_from: `${period.from}-01`, period_to: `${period.to}-01` };
}

export function shiftMonth(month: string, offset: number): string | undefined {
  const start = monthIndex(month);
  if (start === undefined || !Number.isSafeInteger(offset))
    throw new Error("Invalid month shift");
  const index = start + offset;
  if (index < 12 || index > 9999 * 12 + 11) return undefined;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function calendarMonths(period: MonthPeriod): string[] {
  periodQuery(period);
  return Array.from({ length: period.months }, (_, i) =>
    shiftMonth(period.from, i)!,
  );
}

export type StoreContext = Readonly<{
  from: string;
  to: string;
  applied?: MonthPeriod;
  tab: number;
}>;
export const initialStoreContext: StoreContext = { from: "", to: "", tab: 0 };
