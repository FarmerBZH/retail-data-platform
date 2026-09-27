-- Reconciliation is deliberately conservative: source aliases do not establish
-- additivity, source precedence, or cumulative assortment membership.
CREATE VIEW analytics_register_product_month AS
SELECT store_id, period, source_gtin,
       CASE WHEN count(product_id) = count(*) AND count(DISTINCT product_id) = 1
            THEN min(product_id::text)::uuid END AS product_id,
       count(*) AS source_row_count,
       count(*) > 1 AS ambiguous,
       count(*) FILTER (WHERE product_id IS NULL) AS unmatched_product_rows,
       array_agg(id ORDER BY id) AS observation_ids,
       array_agg(DISTINCT source_kind ORDER BY source_kind) AS source_kinds,
       CASE WHEN count(*) = 1 THEN min(revenue_value) END AS revenue,
       CASE WHEN count(*) = 1 THEN min(units_sold) END AS units,
       CASE WHEN count(*) = 1 THEN min(volume_value) END AS volume,
       count(revenue_value) AS revenue_reported_rows,
       count(units_sold) AS units_reported_rows
FROM register_observations
WHERE store_id IS NOT NULL AND store_match_status = 'matched'
GROUP BY store_id, period, source_gtin;

CREATE VIEW analytics_activity_month AS
SELECT store_id, period, activity_type, count(*) AS source_row_count,
       count(*) > 1 AS ambiguous,
       CASE WHEN count(*) = 1 THEN min(activity_count) END AS activity_count,
       array_agg(id ORDER BY id) AS observation_ids
FROM store_activity_metrics
WHERE store_id IS NOT NULL AND store_match_status = 'matched'
GROUP BY store_id, period, activity_type;

CREATE VIEW analytics_distribution_product_month AS
SELECT store_id, period, category_code,
       CASE WHEN product_id IS NOT NULL THEN 'product:' || product_id::text
            ELSE 'source:' || source_product_reference END AS product_key,
       product_id, count(*) AS source_row_count, count(*) > 1 AS ambiguous,
       CASE WHEN count(*) = 1 THEN min(presence_value) END AS presence_value,
       count(*) FILTER (WHERE value_origin = 'inferred_absence') AS inferred_absence_rows,
       array_agg(id ORDER BY id) AS observation_ids
FROM numeric_distribution_observations
WHERE store_id IS NOT NULL AND store_match_status = 'matched'
GROUP BY store_id, period, category_code, product_id,
         CASE WHEN product_id IS NOT NULL THEN 'product:' || product_id::text
              ELSE 'source:' || source_product_reference END;

CREATE VIEW analytics_shelf_category_month AS
SELECT store_id, period, category_code, count(*) AS source_row_count,
       count(*) > 1 AS ambiguous,
       CASE WHEN count(*) = 1 THEN min(company_value) END AS company_value,
       CASE WHEN count(*) = 1 THEN min(total_value) END AS total_value,
       CASE WHEN count(*) = 1 THEN min(company_value) / nullif(min(total_value), 0) END
           AS shelf_share,
       array_agg(id ORDER BY id) AS observation_ids
FROM shelf_share_observations
WHERE store_id IS NOT NULL AND store_match_status = 'matched'
GROUP BY store_id, period, category_code;

-- A typology value remains at its source grain. Multiple candidate rules are
-- explicit, with no lexical winner, fuzzy label match, or current-store fallback.
CREATE VIEW analytics_typology_month AS
SELECT s.store_id, date_trunc('month', s.period)::date AS period, v.id AS typology_value_id, s.id AS snapshot_id,
       s.retailer_name, s.region_code, s.sales_representative_code,
       v.category_key, v.category_name, v.typology_value,
       coalesce(r.rank_rule_ids, ARRAY[]::uuid[]) AS rank_rule_ids,
       coalesce(cardinality(r.rank_rule_ids), 0) AS rank_candidate_count,
       EXISTS (
           SELECT 1 FROM typology_mapping_rules bad
           WHERE lower(btrim(bad.raw_retailer_name)) = lower(btrim(s.retailer_name))
             AND lower(btrim(bad.raw_category_name)) = lower(btrim(v.category_name))
             AND lower(btrim(bad.raw_typology_value)) = lower(btrim(v.typology_value))
             AND (bad.has_source_error OR NOT EXISTS (
                 SELECT 1 FROM typology_rank_rules br
                 WHERE lower(btrim(br.retailer_name)) = lower(btrim(bad.mapped_retailer_name))
                   AND lower(btrim(br.category_code)) = lower(btrim(bad.mapped_category_code))
                   AND lower(btrim(br.typology_value)) = lower(btrim(bad.mapped_typology_value))
             ))
       ) AS mapping_issue
FROM typology_snapshots s
JOIN store_typology_values v ON v.snapshot_id = s.id
LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT candidate.id ORDER BY candidate.id) AS rank_rule_ids
    FROM (
        SELECT tr.id FROM typology_rank_rules tr
        WHERE lower(btrim(tr.retailer_name)) = lower(btrim(s.retailer_name))
          AND lower(btrim(tr.category_name)) = lower(btrim(v.category_name))
          AND lower(btrim(tr.typology_value)) = lower(btrim(v.typology_value))
        UNION
        SELECT tr.id FROM typology_mapping_rules m
        JOIN typology_rank_rules tr
          ON lower(btrim(tr.retailer_name)) = lower(btrim(m.mapped_retailer_name))
         AND lower(btrim(tr.category_code)) = lower(btrim(m.mapped_category_code))
         AND lower(btrim(tr.typology_value)) = lower(btrim(m.mapped_typology_value))
        WHERE NOT m.has_source_error
          AND lower(btrim(m.raw_retailer_name)) = lower(btrim(s.retailer_name))
          AND lower(btrim(m.raw_category_name)) = lower(btrim(v.category_name))
          AND lower(btrim(m.raw_typology_value)) = lower(btrim(v.typology_value))
    ) candidate
) r ON true
WHERE s.store_id IS NOT NULL AND s.store_match_status = 'matched';

-- Candidate membership only: exact rank equality is not a claim that the
-- assortment is mandatory, cumulative, or historically valid beyond this month.
CREATE VIEW analytics_assortment_candidates AS
SELECT t.store_id, t.period, a.id AS assortment_id,
       a.product_id, a.gtin, a.typology_rank_rule_id,
       array_agg(DISTINCT t.typology_value_id ORDER BY t.typology_value_id) AS typology_value_ids
FROM analytics_typology_month t
JOIN assortments a ON date_trunc('month', a.period)::date = t.period
 AND a.typology_match_status = 'matched'
 AND t.rank_candidate_count = 1 AND NOT t.mapping_issue
 AND a.typology_rank_rule_id = t.rank_rule_ids[1]
WHERE NOT EXISTS (
    SELECT 1 FROM analytics_typology_month other
    WHERE other.store_id = t.store_id AND other.period = t.period
      AND other.category_key = t.category_key
      AND (other.rank_candidate_count <> 1 OR other.mapping_issue
           OR other.rank_rule_ids <> t.rank_rule_ids)
)
GROUP BY t.store_id, t.period, a.id, a.product_id, a.gtin, a.typology_rank_rule_id;

CREATE VIEW analytics_retailer_assortment_month AS
SELECT DISTINCT s.store_id, date_trunc('month', s.period)::date AS period,
       a.id AS assortment_id, a.product_id, a.gtin,
       a.product_match_status, a.typology_match_status
FROM typology_snapshots s
JOIN assortments a
  ON date_trunc('month', a.period)::date = date_trunc('month', s.period)::date
 AND lower(btrim(a.source_retailer_name)) = lower(btrim(s.retailer_name))
WHERE s.store_id IS NOT NULL AND s.store_match_status = 'matched';

CREATE VIEW analytics_store_category_month AS
WITH d AS (
    SELECT store_id, period, category_code, count(*) AS distribution_product_count,
           count(*) FILTER (WHERE ambiguous) AS distribution_ambiguous_products,
           count(*) FILTER (WHERE product_id IS NULL) AS distribution_unmatched_products,
           sum(inferred_absence_rows) AS inferred_absence_rows,
           CASE WHEN NOT bool_or(ambiguous) THEN sum(presence_value) END AS present_products,
           CASE WHEN NOT bool_or(ambiguous) THEN avg(presence_value) END AS observed_presence_rate
    FROM analytics_distribution_product_month
    GROUP BY store_id, period, category_code
), a AS (
    SELECT c.store_id, c.period, r.category_code,
           count(DISTINCT c.assortment_id) AS exact_assortment_candidate_count
    FROM analytics_assortment_candidates c
    JOIN typology_rank_rules r ON r.id = c.typology_rank_rule_id
    GROUP BY c.store_id, c.period, r.category_code
), keys AS (
    SELECT store_id, period, category_code FROM d
    UNION SELECT store_id, period, category_code FROM analytics_shelf_category_month
    UNION SELECT store_id, period, category_code FROM a
)
SELECT k.store_id, k.period, k.category_code,
       d.distribution_product_count, d.distribution_ambiguous_products,
       d.distribution_unmatched_products, d.inferred_absence_rows,
       d.present_products, d.observed_presence_rate,
       sh.source_row_count AS shelf_source_row_count, sh.ambiguous AS shelf_ambiguous,
       sh.company_value AS shelf_company_value, sh.total_value AS shelf_total_value,
       sh.shelf_share, a.exact_assortment_candidate_count
FROM keys k
LEFT JOIN d USING (store_id, period, category_code)
LEFT JOIN analytics_shelf_category_month sh USING (store_id, period, category_code)
LEFT JOIN a USING (store_id, period, category_code);

-- Coverage describes attribution, not completeness of delivery. Orphans cannot
-- be assigned to an invented store and remain visible in this companion view.
CREATE VIEW analytics_monthly_link_quality AS
SELECT 'register'::text AS dataset, period, store_match_status, count(*) AS source_row_count
FROM register_observations GROUP BY period, store_match_status
UNION ALL
SELECT 'activity', period, store_match_status, count(*)
FROM store_activity_metrics GROUP BY period, store_match_status
UNION ALL
SELECT 'distribution', period, store_match_status, count(*)
FROM numeric_distribution_observations GROUP BY period, store_match_status
UNION ALL
SELECT 'shelf', period, store_match_status, count(*)
FROM shelf_share_observations GROUP BY period, store_match_status
UNION ALL
SELECT 'typology', date_trunc('month', period)::date, store_match_status, count(*)
FROM typology_snapshots GROUP BY date_trunc('month', period)::date, store_match_status;

CREATE VIEW analytics_store_month AS
WITH bounds AS (
    SELECT min(first_period) AS first_period, max(last_period) AS last_period FROM (
        SELECT min(period) AS first_period, max(period) AS last_period FROM register_observations
        UNION ALL SELECT min(period), max(period) FROM store_activity_metrics
        UNION ALL SELECT min(period), max(period) FROM numeric_distribution_observations
        UNION ALL SELECT min(period), max(period) FROM shelf_share_observations
        UNION ALL SELECT min(period), max(period) FROM typology_snapshots
        UNION ALL SELECT min(period), max(period) FROM assortments
    ) b
), months AS (
    SELECT month::date AS period FROM bounds,
    LATERAL generate_series(date_trunc('month', first_period)::timestamp,
                            date_trunc('month', last_period)::timestamp,
                            interval '1 month') month
), r AS (
    SELECT store_id, period, count(*) AS register_product_count,
           sum(source_row_count) AS register_source_row_count,
           count(*) FILTER (WHERE ambiguous) AS register_ambiguous_products,
           sum(unmatched_product_rows) AS register_unmatched_product_rows,
           count(revenue) AS register_revenue_product_count,
           count(units) AS register_units_product_count,
           CASE WHEN count(revenue) = count(*) THEN sum(revenue) END AS revenue,
           CASE WHEN count(units) = count(*) THEN sum(units) END AS units,
           sum(revenue) AS unambiguous_reported_revenue,
           sum(units) AS unambiguous_reported_units
    FROM analytics_register_product_month GROUP BY store_id, period
), activity AS (
    SELECT store_id, period,
           max(activity_count) FILTER (WHERE activity_type = 'calls') AS calls,
           max(activity_count) FILTER (WHERE activity_type = 'field_visits') AS field_visits,
           max(activity_count) FILTER (WHERE activity_type = 'crowdsourced_visits')
               AS crowdsourced_visits,
           count(*) FILTER (WHERE ambiguous) AS activity_ambiguous_types,
           jsonb_agg(to_jsonb(a) - 'store_id' - 'period' ORDER BY activity_type) AS activity_details
    FROM analytics_activity_month a GROUP BY store_id, period
), categories AS (
    SELECT store_id, period,
           jsonb_agg(to_jsonb(c) - 'store_id' - 'period' ORDER BY category_code) AS category_details
    FROM analytics_store_category_month c GROUP BY store_id, period
), typologies AS (
    SELECT store_id, period,
           jsonb_agg(to_jsonb(t) - 'store_id' - 'period' ORDER BY typology_value_id)
               AS typology_details
    FROM analytics_typology_month t GROUP BY store_id, period
), snapshots AS (
    SELECT store_id, date_trunc('month', period)::date AS period,
           count(*) AS typology_snapshot_count,
           array_agg(id ORDER BY id) AS typology_snapshot_ids
    FROM typology_snapshots WHERE store_id IS NOT NULL AND store_match_status = 'matched'
    GROUP BY store_id, date_trunc('month', period)::date
)
SELECT s.id AS store_id, m.period,
       s.name AS current_store_name, s.retailer_name AS current_retailer_name,
       s.store_format AS current_store_format, s.region_code AS current_region_code,
       s.is_active AS current_is_active, to_jsonb(s) AS current_store,
       r.register_product_count, r.register_source_row_count,
       r.register_ambiguous_products, r.register_unmatched_product_rows,
       r.register_revenue_product_count, r.register_units_product_count,
       r.revenue, r.units, r.revenue / nullif(r.units, 0) AS revenue_per_unit,
       r.unambiguous_reported_revenue, r.unambiguous_reported_units,
       activity.calls, activity.field_visits, activity.crowdsourced_visits,
       activity.activity_ambiguous_types,
       coalesce(activity.activity_details, '[]'::jsonb) AS activity_details,
       coalesce(categories.category_details, '[]'::jsonb) AS category_details,
       coalesce(typologies.typology_details, '[]'::jsonb) AS typology_details,
       snapshots.typology_snapshot_count,
       coalesce(snapshots.typology_snapshot_ids, ARRAY[]::uuid[]) AS typology_snapshot_ids,
       r.store_id IS NOT NULL AS has_register,
       activity.store_id IS NOT NULL AS has_activity,
       categories.store_id IS NOT NULL AS has_category_data,
       snapshots.store_id IS NOT NULL AS has_typology
FROM stores s CROSS JOIN months m
LEFT JOIN r ON r.store_id = s.id AND r.period = m.period
LEFT JOIN activity ON activity.store_id = s.id AND activity.period = m.period
LEFT JOIN categories ON categories.store_id = s.id AND categories.period = m.period
LEFT JOIN typologies ON typologies.store_id = s.id AND typologies.period = m.period
LEFT JOIN snapshots ON snapshots.store_id = s.id AND snapshots.period = m.period;

CREATE VIEW analytics_store_month_changes AS
WITH lagged AS (
    SELECT store_id, period, revenue, units, calls, field_visits, crowdsourced_visits,
           lag(revenue) OVER w AS revenue_previous_month,
           lag(revenue, 12) OVER w AS revenue_previous_year,
           lag(units) OVER w AS units_previous_month,
           lag(calls) OVER w AS calls_previous_month,
           lag(field_visits) OVER w AS field_visits_previous_month,
           lag(crowdsourced_visits) OVER w AS crowdsourced_visits_previous_month
    FROM analytics_store_month
    WINDOW w AS (PARTITION BY store_id ORDER BY period)
)
SELECT *, revenue - revenue_previous_month AS revenue_month_change,
       (revenue - revenue_previous_month) / nullif(revenue_previous_month, 0)
           AS revenue_month_change_ratio,
       (revenue - revenue_previous_year) / nullif(revenue_previous_year, 0)
           AS revenue_year_change_ratio
FROM lagged;
