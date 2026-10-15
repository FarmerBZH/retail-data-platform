-- Network measures over the canonical store-month grain.

CREATE MATERIALIZED VIEW analytics_network_month AS
SELECT period,
    min(period) AS first_period,
    max(period) AS last_period,
    count(*) AS expected_cell_count,
    count(DISTINCT store_id) AS store_count,
    count(DISTINCT store_id) FILTER (WHERE has_register) AS stores_with_register,
    count(DISTINCT period) AS month_count,
    count(revenue) AS revenue_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(revenue) = count(*) THEN sum(revenue) END AS revenue,
    sum(revenue) AS revenue_partial,
    count(units) AS units_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(units) = count(*) THEN sum(units) END AS units,
    sum(units) AS units_partial,
    count(calls) AS calls_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(calls) = count(*) THEN sum(calls)::numeric END AS calls,
    sum(calls)::numeric AS calls_partial,
    count(field_visits) AS field_visits_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(field_visits) = count(*) THEN sum(field_visits)::numeric END AS field_visits,
    sum(field_visits)::numeric AS field_visits_partial,
    count(crowdsourced_visits) AS crowdsourced_visits_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(crowdsourced_visits) = count(*) THEN sum(crowdsourced_visits)::numeric END AS crowdsourced_visits,
    sum(crowdsourced_visits)::numeric AS crowdsourced_visits_partial,
    CASE WHEN count(*) > 0 AND count(revenue) = count(*) AND count(units) = count(*) THEN sum(revenue) / nullif(sum(units), 0) END AS revenue_per_unit,
    sum(unambiguous_reported_revenue) AS unambiguous_reported_revenue,
    sum(unambiguous_reported_units) AS unambiguous_reported_units,
    sum(register_product_count) AS register_product_count,
    sum(register_ambiguous_products) AS register_ambiguous_products,
    sum(register_unmatched_product_rows) AS register_unmatched_product_rows,
    count(DISTINCT store_id) FILTER (WHERE has_activity) AS stores_with_activity,
    count(DISTINCT store_id) FILTER (WHERE has_category_data) AS stores_with_category_data,
    count(DISTINCT store_id) FILTER (WHERE has_typology) AS stores_with_typology
FROM analytics_store_month
GROUP BY period
WITH NO DATA;

CREATE MATERIALIZED VIEW analytics_network_year AS
SELECT date_trunc('year', period)::date AS period,
    min(period) AS first_period,
    max(period) AS last_period,
    count(*) AS expected_cell_count,
    count(DISTINCT store_id) AS store_count,
    count(DISTINCT store_id) FILTER (WHERE has_register) AS stores_with_register,
    count(DISTINCT period) AS month_count,
    count(revenue) AS revenue_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(revenue) = count(*) THEN sum(revenue) END AS revenue,
    sum(revenue) AS revenue_partial,
    count(units) AS units_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(units) = count(*) THEN sum(units) END AS units,
    sum(units) AS units_partial,
    count(calls) AS calls_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(calls) = count(*) THEN sum(calls)::numeric END AS calls,
    sum(calls)::numeric AS calls_partial,
    count(field_visits) AS field_visits_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(field_visits) = count(*) THEN sum(field_visits)::numeric END AS field_visits,
    sum(field_visits)::numeric AS field_visits_partial,
    count(crowdsourced_visits) AS crowdsourced_visits_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(crowdsourced_visits) = count(*) THEN sum(crowdsourced_visits)::numeric END AS crowdsourced_visits,
    sum(crowdsourced_visits)::numeric AS crowdsourced_visits_partial,
    CASE WHEN count(*) > 0 AND count(revenue) = count(*) AND count(units) = count(*) THEN sum(revenue) / nullif(sum(units), 0) END AS revenue_per_unit,
    sum(unambiguous_reported_revenue) AS unambiguous_reported_revenue,
    sum(unambiguous_reported_units) AS unambiguous_reported_units,
    sum(register_product_count) AS register_product_count,
    sum(register_ambiguous_products) AS register_ambiguous_products,
    sum(register_unmatched_product_rows) AS register_unmatched_product_rows,
    count(DISTINCT store_id) FILTER (WHERE has_activity) AS stores_with_activity,
    count(DISTINCT store_id) FILTER (WHERE has_category_data) AS stores_with_category_data,
    count(DISTINCT store_id) FILTER (WHERE has_typology) AS stores_with_typology
FROM analytics_store_month
GROUP BY date_trunc('year', period)::date
WITH NO DATA;

CREATE MATERIALIZED VIEW analytics_network_overview AS
SELECT 'network'::text AS scope,
    min(period) AS first_period,
    max(period) AS last_period,
    count(*) AS expected_cell_count,
    count(DISTINCT store_id) AS store_count,
    count(DISTINCT store_id) FILTER (WHERE has_register) AS stores_with_register,
    count(DISTINCT period) AS month_count,
    count(revenue) AS revenue_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(revenue) = count(*) THEN sum(revenue) END AS revenue,
    sum(revenue) AS revenue_partial,
    count(units) AS units_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(units) = count(*) THEN sum(units) END AS units,
    sum(units) AS units_partial,
    count(calls) AS calls_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(calls) = count(*) THEN sum(calls)::numeric END AS calls,
    sum(calls)::numeric AS calls_partial,
    count(field_visits) AS field_visits_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(field_visits) = count(*) THEN sum(field_visits)::numeric END AS field_visits,
    sum(field_visits)::numeric AS field_visits_partial,
    count(crowdsourced_visits) AS crowdsourced_visits_covered_cell_count,
    CASE WHEN count(*) > 0 AND count(crowdsourced_visits) = count(*) THEN sum(crowdsourced_visits)::numeric END AS crowdsourced_visits,
    sum(crowdsourced_visits)::numeric AS crowdsourced_visits_partial,
    CASE WHEN count(*) > 0 AND count(revenue) = count(*) AND count(units) = count(*) THEN sum(revenue) / nullif(sum(units), 0) END AS revenue_per_unit,
    sum(unambiguous_reported_revenue) AS unambiguous_reported_revenue,
    sum(unambiguous_reported_units) AS unambiguous_reported_units,
    sum(register_product_count) AS register_product_count,
    sum(register_ambiguous_products) AS register_ambiguous_products,
    sum(register_unmatched_product_rows) AS register_unmatched_product_rows,
    count(DISTINCT store_id) FILTER (WHERE has_activity) AS stores_with_activity,
    count(DISTINCT store_id) FILTER (WHERE has_category_data) AS stores_with_category_data,
    count(DISTINCT store_id) FILTER (WHERE has_typology) AS stores_with_typology
FROM analytics_store_month
WITH NO DATA;

CREATE MATERIALIZED VIEW analytics_network_month_changes AS
WITH history AS (
    SELECT period, revenue,
           lag(revenue) OVER (ORDER BY period) AS revenue_previous_month,
           lag(revenue, 12) OVER (ORDER BY period) AS revenue_previous_year
    FROM analytics_network_month
)
SELECT period, revenue, revenue_previous_month, revenue_previous_year,
       revenue - revenue_previous_month AS revenue_month_change,
       (revenue - revenue_previous_month) / nullif(revenue_previous_month, 0)
           AS revenue_month_change_ratio,
       revenue - revenue_previous_year AS revenue_year_change,
       (revenue - revenue_previous_year) / nullif(revenue_previous_year, 0)
           AS revenue_year_change_ratio
FROM history
WITH NO DATA;
