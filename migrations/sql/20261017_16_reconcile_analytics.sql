CREATE VIEW analytics_distribution_product_month AS
SELECT store_id, period, category_code,
       CASE WHEN product_id IS NOT NULL THEN 'product:' || product_id::text
            ELSE 'source:' || source_product_reference END AS product_key,
       product_id, count(*) AS source_row_count,
       count(DISTINCT presence_value) FILTER (WHERE value_origin = 'reported') > 1 AS ambiguous,
       CASE WHEN count(DISTINCT presence_value) FILTER (WHERE value_origin = 'reported') <= 1
            THEN coalesce(min(presence_value) FILTER (WHERE value_origin = 'reported'),
                          min(presence_value)) END AS presence_value,
       count(*) FILTER (WHERE value_origin = 'inferred_absence') AS inferred_absence_rows,
       array_agg(id ORDER BY id) AS observation_ids
FROM numeric_distribution_observations
WHERE store_id IS NOT NULL AND store_match_status = 'matched'
GROUP BY store_id, period, category_code, product_id,
         CASE WHEN product_id IS NOT NULL THEN 'product:' || product_id::text
              ELSE 'source:' || source_product_reference END;

CREATE VIEW analytics_typology_month AS
SELECT s.store_id, date_trunc('month', s.period)::date AS period, v.id AS typology_value_id, s.id AS snapshot_id,
       s.retailer_name, s.region_code, s.sales_representative_code,
       v.category_key, v.category_name, v.typology_value,
       coalesce(r.rank_rule_ids, ARRAY[]::uuid[]) AS rank_rule_ids,
       coalesce(cardinality(r.rank_rule_ids), 0) AS rank_candidate_count,
       EXISTS (
           SELECT 1 FROM typology_mapping_rules bad
           WHERE nullif(upper(regexp_replace(normalize(bad.raw_retailer_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
               = nullif(upper(regexp_replace(normalize(s.retailer_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
             AND nullif(upper(regexp_replace(normalize(bad.raw_category_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
                 = nullif(upper(regexp_replace(normalize(v.category_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
             AND nullif(upper(regexp_replace(normalize(bad.raw_typology_value, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
                 = nullif(upper(regexp_replace(normalize(v.typology_value, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
             AND (bad.has_source_error OR NOT EXISTS (
                 SELECT 1 FROM typology_rank_rules br
                 WHERE nullif(upper(regexp_replace(normalize(br.retailer_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
                     = nullif(upper(regexp_replace(normalize(bad.mapped_retailer_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
                   AND nullif(upper(regexp_replace(normalize(br.category_code, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
                       = nullif(upper(regexp_replace(normalize(bad.mapped_category_code, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
                   AND nullif(upper(regexp_replace(normalize(br.typology_value, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
                       = nullif(upper(regexp_replace(normalize(bad.mapped_typology_value, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
             ))
       ) AS mapping_issue
FROM typology_snapshots s
JOIN store_typology_values v ON v.snapshot_id = s.id
LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT candidate.id ORDER BY candidate.id) AS rank_rule_ids
    FROM (
        SELECT tr.id FROM typology_rank_rules tr
        WHERE nullif(upper(regexp_replace(normalize(tr.retailer_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
            = nullif(upper(regexp_replace(normalize(s.retailer_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
          AND nullif(upper(regexp_replace(normalize(tr.category_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
              = nullif(upper(regexp_replace(normalize(v.category_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
          AND nullif(upper(regexp_replace(normalize(tr.typology_value, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
              = nullif(upper(regexp_replace(normalize(v.typology_value, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
        UNION
        SELECT tr.id FROM typology_mapping_rules m
        JOIN typology_rank_rules tr
          ON nullif(upper(regexp_replace(normalize(tr.retailer_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
              = nullif(upper(regexp_replace(normalize(m.mapped_retailer_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
         AND nullif(upper(regexp_replace(normalize(tr.category_code, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
             = nullif(upper(regexp_replace(normalize(m.mapped_category_code, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
         AND nullif(upper(regexp_replace(normalize(tr.typology_value, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
             = nullif(upper(regexp_replace(normalize(m.mapped_typology_value, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
        WHERE NOT m.has_source_error
          AND nullif(upper(regexp_replace(normalize(m.raw_retailer_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
              = nullif(upper(regexp_replace(normalize(s.retailer_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
          AND nullif(upper(regexp_replace(normalize(m.raw_category_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
              = nullif(upper(regexp_replace(normalize(v.category_name, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
          AND nullif(upper(regexp_replace(normalize(m.raw_typology_value, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
              = nullif(upper(regexp_replace(normalize(v.typology_value, NFKD), '[^A-Za-z0-9]', '', 'g')), '')
    ) candidate
) r ON true
WHERE s.store_id IS NOT NULL AND s.store_match_status = 'matched';

CREATE VIEW analytics_retailer_assortment_month AS
WITH retailer_mapping AS (
            SELECT lower(btrim(raw_retailer_name)) AS raw_retailer,
                   min(nullif(lower(btrim(mapped_retailer_name)), '')) AS matched_retailer
            FROM typology_mapping_rules
            GROUP BY lower(btrim(raw_retailer_name))
            HAVING bool_or(NOT has_source_error AND nullif(btrim(mapped_retailer_name), '') IS NOT NULL)
               AND count(DISTINCT nullif(lower(btrim(mapped_retailer_name)), '')) = 1
        ), assortment_retailer AS (
            SELECT a.id, a.period, a.product_id, a.gtin,
                   a.product_match_status, a.typology_match_status,
                   lower(btrim(a.source_retailer_name)) AS matched_retailer
            FROM assortments a
            UNION ALL
            SELECT a.id, a.period, a.product_id, a.gtin,
                   a.product_match_status, a.typology_match_status,
                   m.matched_retailer
            FROM assortments a
            JOIN retailer_mapping m
              ON m.raw_retailer = lower(btrim(a.source_retailer_name))
            WHERE m.matched_retailer <> m.raw_retailer
        )
        SELECT DISTINCT s.store_id, date_trunc('month', s.period)::date AS period,
               a.id AS assortment_id, a.product_id, a.gtin,
               a.product_match_status, a.typology_match_status
        FROM typology_snapshots s
        JOIN assortment_retailer a
          ON date_trunc('month', a.period)::date = date_trunc('month', s.period)::date
         AND a.matched_retailer = lower(btrim(s.retailer_name))
        WHERE s.store_id IS NOT NULL AND s.store_match_status = 'matched';
