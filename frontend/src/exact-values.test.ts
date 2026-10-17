import { expect, it } from "vitest";
import {
  addExact,
  subtractExact,
  ratioExact,
  formatExact,
  formatPercent,
  formatMonth,
  formatPublicationTime,
} from "./exact-values";

it("adds and subtracts exact decimal fractions with high precision", () => {
  expect(addExact("0.1", "0.2")).toBe("0.3");
  expect(subtractExact("0.1", "0.2")).toBe("-0.1");
  expect(addExact("999999999999999999999999.999999999", "0.000000001")).toBe(
    "1000000000000000000000000",
  );
  expect(addExact("1e-3", "2E+2")).toBe("200.001");
  expect(addExact("-0.1", "0.1")).toBe("0");
  expect(addExact(null, "0")).toBeNull();
});
it.each([
  ["12", "100", 6, "0.12"],
  ["1", "8", 2, "0.13"],
  ["-1", "-8", 2, "0.13"],
  ["1", "2", 0, "1"],
  ["0.123456789123456789", "0.000000001", 18, "123456789.123456789"],
  ["1", "3", 6, "0.333333"],
  ["2", "3", 6, "0.666667"],
  ["-1", "8", 2, "-0.13"],
  ["1", "-8", 2, "-0.13"],
  ["0", "2", 6, "0"],
  ["1", "0", 6, null],
  ["0", "0", 6, null],
  [null, "1", 6, null],
])(
  "divides %s by %s with explicit decimal precision",
  (a, b, precision, result) => {
    expect(ratioExact(a, b, precision)).toBe(result);
  },
);
it("formats exact French values without binary conversion or currency assumptions", () => {
  expect(formatExact("12345678901234567890.123456789")).toBe(
    "12\u202f345\u202f678\u202f901\u202f234\u202f567\u202f890,123456789",
  );
  expect(formatExact("-1234.50")).toBe("-1\u202f234,5");
  expect(formatExact("-0.00")).toBe("0");
  expect(formatExact(null)).toBe("Indisponible");
  expect(formatPercent("0.12")).toBe("12\u00a0%");
  expect(formatPercent("0.00123456789")).toBe("0,123456789\u00a0%");
  expect(formatPercent(null)).toBe("Indisponible");
});
it.each(["NaN", "Infinity", "0,1", "1e999999", "1e-999999", ""])(
  "rejects malformed or excessive decimal %s",
  (value) => {
    expect(() => formatExact(value)).toThrow();
  },
);
it("validates division precision", () => {
  expect(() => ratioExact("1", "2", -1)).toThrow();
  expect(() => ratioExact("1", "2", 19)).toThrow();
});
it("formats months as calendars without timezone shifts", () => {
  expect(formatMonth("2025-12")).toBe("décembre 2025");
  expect(formatMonth("0001-01")).toBe("janvier 0001");
  expect(() => formatMonth("2026-13")).toThrow();
  expect(formatPublicationTime("2026-01-01T00:30:00+02:00")).toBe(
    "31/12/2025 22:30:00 UTC",
  );
});

it("allows formatted arithmetic results beyond the API input length while bounding output", () => {
  const result = addExact("1e300", "0.1");
  expect(result?.endsWith(".1")).toBe(true);
  expect(formatExact(result)).toContain(",1");
  expect(formatPercent("1e300")).toContain("%");
  expect(() => formatExact("1".repeat(1025))).toThrow();
  expect(() => addExact("9".repeat(1024), "1")).toThrow();
});
