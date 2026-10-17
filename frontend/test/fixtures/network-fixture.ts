import { syntheticRow } from "./published-fixture";
import type { ResourceName } from "../../src/api/read-api";
export function syntheticNetwork(
  name: ResourceName = "analytics_network_month",
  overrides: Record<string, unknown> = {},
) {
  return syntheticRow(name, {
    scope: "network",
    period: "2026-01-01",
    first_period: "2026-01-01",
    last_period: "2026-01-01",
    month_count: 1,
    store_count: 2,
    expected_cell_count: 2,
    revenue: null,
    revenue_partial: "0.3",
    revenue_covered_cell_count: 1,
    units: "0",
    units_partial: "0",
    units_covered_cell_count: 2,
    calls: null,
    calls_partial: null,
    calls_covered_cell_count: 0,
    field_visits: "-2",
    field_visits_partial: "-2",
    field_visits_covered_cell_count: 2,
    crowdsourced_visits: "1",
    crowdsourced_visits_partial: "1",
    crowdsourced_visits_covered_cell_count: 2,
    revenue_per_unit: null,
    ...overrides,
  });
}
