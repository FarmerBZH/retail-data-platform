import { text } from "./api-validation";
import { validatePeriod } from "./month-period";

type Exact = { coefficient: bigint; scale: number };
function parse(value: string): Exact {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(
    text(value, 1024),
  );
  if (!match) throw new Error("Invalid decimal");
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  let scale = fraction.length - exponent;
  if (
    !Number.isSafeInteger(exponent) ||
    Math.abs(exponent) > 512 ||
    Math.abs(scale) > 512
  )
    throw new Error("Decimal size exceeded");
  let coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}
function serialize({ coefficient, scale }: Exact): string {
  if (coefficient === 0n) return "0";
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient)
    .toString()
    .padStart(scale + 1, "0");
  if (scale)
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(
      /\.?0+$/,
      "",
    );
  const result = `${negative ? "-" : ""}${digits}`;
  if (result.length > 1024) throw new Error("Decimal size exceeded");
  return result;
}
function combine(
  a: string | null,
  b: string | null,
  subtract: boolean,
): string | null {
  if (a === null || b === null) return null;
  const left = parse(a),
    right = parse(b);
  const scale = Math.max(left.scale, right.scale);
  return serialize({
    coefficient:
      left.coefficient * 10n ** BigInt(scale - left.scale) +
      (subtract ? -1n : 1n) *
        right.coefficient *
        10n ** BigInt(scale - right.scale),
    scale,
  });
}
export const addExact = (a: string | null, b: string | null) =>
  combine(a, b, false);
export const subtractExact = (a: string | null, b: string | null) =>
  combine(a, b, true);

// Explicit decimal precision, half away from zero. Zero denominator is unavailable.
export function ratioExact(
  numerator: string | null,
  denominator: string | null,
  places = 6,
): string | null {
  if (!Number.isInteger(places) || places < 0 || places > 18)
    throw new Error("Invalid precision");
  if (numerator === null || denominator === null) return null;
  const a = parse(numerator),
    b = parse(denominator);
  if (b.coefficient === 0n) return null;
  const negative = a.coefficient < 0n !== b.coefficient < 0n;
  const top =
    (a.coefficient < 0n ? -a.coefficient : a.coefficient) *
    10n ** BigInt(b.scale + places);
  const bottom =
    (b.coefficient < 0n ? -b.coefficient : b.coefficient) *
    10n ** BigInt(a.scale);
  const rounded = top / bottom + ((top % bottom) * 2n >= bottom ? 1n : 0n);
  return serialize({
    coefficient: negative ? -rounded : rounded,
    scale: places,
  });
}
export function formatExact(value: string | null): string {
  if (value === null) return "Indisponible";
  const canonical = serialize(parse(value));
  const [integer = "0", fraction] = canonical.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f")}${fraction ? `,${fraction}` : ""}`;
}
export function formatPercent(value: string | null): string {
  if (value === null) return "Indisponible";
  const parsed = parse(value);
  return `${formatExact(serialize({ ...parsed, coefficient: parsed.coefficient * 100n }))}\u00a0%`;
}
const months = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
export function formatMonth(value: string): string {
  if (!validatePeriod(value, value).valid) throw new Error("Invalid month");
  return `${months[Number(value.slice(5)) - 1]} ${value.slice(0, 4)}`;
}
export function formatPublicationTime(value: string): string {
  return (
    new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(value)) + " UTC"
  );
}
