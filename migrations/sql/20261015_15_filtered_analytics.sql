CREATE MATERIALIZED VIEW analytics_store_scope AS
SELECT id AS store_id, name, city, retailer_name, region_code, store_format, is_active
FROM stores
WITH NO DATA;

CREATE MATERIALIZED VIEW analytics_store_dataset_month AS
WITH observations AS (
    SELECT store_id, period, 'register'::text AS dataset,
           false AS inferred_absence
    FROM register_observations WHERE store_match_status = 'matched' AND store_id IS NOT NULL
    UNION ALL
    SELECT store_id, period, 'activity', false
    FROM store_activity_metrics WHERE store_match_status = 'matched' AND store_id IS NOT NULL
    UNION ALL
    SELECT store_id, period, 'distribution', value_origin = 'inferred_absence'
    FROM numeric_distribution_observations
    WHERE store_match_status = 'matched' AND store_id IS NOT NULL
    UNION ALL
    SELECT store_id, period, 'shelf', false
    FROM shelf_share_observations WHERE store_match_status = 'matched' AND store_id IS NOT NULL
    UNION ALL
    SELECT store_id, date_trunc('month', period)::date, 'typology', false
    FROM typology_snapshots WHERE store_match_status = 'matched' AND store_id IS NOT NULL
)
SELECT store_id, period, dataset, count(*) AS source_row_count,
       count(*) FILTER (WHERE NOT inferred_absence) AS observed_row_count,
       count(*) FILTER (WHERE inferred_absence) AS inferred_absence_row_count
FROM observations
GROUP BY store_id, period, dataset
WITH NO DATA;
