// Synthetic monthly publication; never imported by application code.
export function syntheticMonth(overrides: Record<string, unknown> = {}) {
  return {
    store_id: "00000000-0000-4000-8000-000000000001",
    period: "2026-01-01",
    revenue: "0.1",
    units: "2",
    calls: null,
    field_visits: 0,
    crowdsourced_visits: null,
    unambiguous_reported_revenue: "0.1",
    unambiguous_reported_units: "2",
    register_product_count: 2,
    register_ambiguous_products: 0,
    register_revenue_product_count: 2,
    register_units_product_count: 2,
    has_register: true,
    ...overrides,
  };
}
