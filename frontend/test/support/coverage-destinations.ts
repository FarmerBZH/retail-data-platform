import type { ResourceName } from "../../src/api/read-api";

// Native consultation is always available; these are additional business destinations.
export const businessDestinations: Record<ResourceName, readonly string[]> = {
  analytics_network_month: ["R"],
  analytics_network_year: ["R"],
  analytics_network_overview: ["R"],
  analytics_network_month_changes: ["R"],

  analytics_activity_month: ["M-ACT"],
  analytics_assortment_candidates: ["M-TYP"],
  analytics_distribution_product_month: ["M-PRE"],
  analytics_monthly_link_quality: ["Q"],
  analytics_refresh_runs: ["OPS"],
  analytics_register_product_month: ["M-VEN"],
  analytics_retailer_assortment_month: ["M-TYP"],
  analytics_shelf_category_month: ["M-PRE"],
  analytics_store_category_month: ["M-PRE"],
  analytics_store_month: ["M-SYN", "M-REF", "M-ACT", "M-PRE", "M-TYP"],
  analytics_store_month_changes: ["M-SYN"],
  analytics_typology_month: ["M-TYP"],
  assortments: ["D-REF"],
  import_runs: ["OPS"],
  numeric_distribution_observations: ["D-OBS"],
  products: ["D-REF"],
  register_observations: ["D-OBS"],
  shelf_share_observations: ["D-OBS"],
  store_activity_metrics: ["D-OBS"],
  store_typology_values: ["D-OBS"],
  stores: ["M-REF"],
  typology_mapping_rules: ["D-REF"],
  typology_rank_rules: ["D-REF"],
  typology_snapshots: ["D-OBS"],
};
export const deferredDestinations = ["R", "S"] as const;
