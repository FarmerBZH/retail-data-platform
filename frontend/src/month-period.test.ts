import { describe, expect, it } from "vitest";
import { periodQuery, validatePeriod } from "./month-period";

describe("inclusive calendar months", () => {
  it("crosses a year without timezone conversion", () => {
    const result = validatePeriod("2025-12", "2026-02");
    expect(result).toEqual({
      valid: true,
      period: { from: "2025-12", to: "2026-02", months: 3 },
    });
    if (!result.valid) throw new Error("Synthetic period rejected");
    expect(periodQuery(result.period)).toEqual({
      period_from: "2025-12-01",
      period_to: "2026-02-01",
    });
  });
  it.each([
    ["2026-01", "2026-01", 1],
    ["2016-01", "2025-12", 120],
    ["0001-01", "0001-01", 1],
    ["9999-12", "9999-12", 1],
  ])("accepts inclusive bounds %s to %s", (from, to, months) => {
    expect(validatePeriod(from, to)).toEqual({
      valid: true,
      period: { from, to, months },
    });
  });
  it.each([
    ["", "2026-01"],
    ["2026-01", ""],
    ["2026-13", "2026-12"],
    ["0000-01", "0001-01"],
    ["2026-1", "2026-02"],
    ["2026-02", "2026-01"],
    ["2015-12", "2025-12"],
    ["2026-01-01", "2026-02"],
  ])("rejects invalid or excessive bounds %s to %s", (from, to) => {
    expect(validatePeriod(from, to).valid).toBe(false);
  });
  it("rejects a forged inclusive length when building API bounds", () => {
    expect(() =>
      periodQuery({ from: "2026-01", to: "2026-02", months: 1 }),
    ).toThrow();
  });
});
