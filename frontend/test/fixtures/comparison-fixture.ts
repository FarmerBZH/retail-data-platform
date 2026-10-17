// Fully synthetic values; application code never imports this fixture.
export function syntheticChange(overrides: Record<string, unknown> = {}) {
  return {
    store_id: "00000000-0000-4000-8000-000000000001",
    period: "2026-01-01",
    revenue: "110",
    revenue_previous_month: "1",
    revenue_previous_year: "0",
    revenue_month_change_ratio: "999",
    revenue_year_change_ratio: "999",
    ...overrides,
  };
}
