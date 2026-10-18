-- The recognized supplementary source is an authoritative row revision.
-- Aggregate evidence once at the source grain before selecting its measures.
CREATE VIEW analytics_register_product_month AS
WITH evidence AS (
    SELECT store_id, period, source_gtin,
           CASE WHEN count(product_id) = count(*) AND count(DISTINCT product_id) = 1
                THEN min(product_id::text)::uuid END AS product_id,
           count(*) AS source_row_count,
           count(*) FILTER (WHERE source_kind = 'supplement') AS revision_rows,
           count(*) FILTER (WHERE product_id IS NULL) AS unmatched_product_rows,
           array_agg(id ORDER BY id) AS observation_ids,
           array_agg(DISTINCT source_kind ORDER BY source_kind) AS source_kinds,
           min(CASE WHEN revenue_value IS NULL AND revenue_change_ratio = -1
                    THEN 0 ELSE revenue_value END)
               FILTER (WHERE source_kind = 'monthly') AS monthly_revenue,
           min(CASE WHEN units_sold IS NULL AND units_change_ratio = -1
                    THEN 0 ELSE units_sold END)
               FILTER (WHERE source_kind = 'monthly') AS monthly_units,
           min(volume_value) FILTER (WHERE source_kind = 'monthly') AS monthly_volume,
           min(revenue_value) FILTER (WHERE source_kind = 'supplement') AS revision_revenue,
           min(units_sold) FILTER (WHERE source_kind = 'supplement') AS revision_units,
           min(volume_value) FILTER (WHERE source_kind = 'supplement') AS revision_volume,
           count(revenue_value) AS revenue_reported_rows,
           count(units_sold) AS units_reported_rows
    FROM register_observations
    WHERE store_id IS NOT NULL AND store_match_status = 'matched'
    GROUP BY store_id, period, source_gtin
)
SELECT store_id, period, source_gtin, product_id, source_row_count,
       CASE WHEN revision_rows > 0 THEN revision_rows > 1
            ELSE source_row_count > 1 END AS ambiguous,
       unmatched_product_rows, observation_ids, source_kinds,
       CASE WHEN revision_rows = 1 THEN revision_revenue
            WHEN revision_rows = 0 AND source_row_count = 1 THEN monthly_revenue END AS revenue,
       CASE WHEN revision_rows = 1 THEN revision_units
            WHEN revision_rows = 0 AND source_row_count = 1 THEN monthly_units END AS units,
       CASE WHEN revision_rows = 1 THEN revision_volume
            WHEN revision_rows = 0 AND source_row_count = 1 THEN monthly_volume END AS volume,
       revenue_reported_rows, units_reported_rows
FROM evidence;
