CREATE VIEW analytics_retailer_assortment_month AS
WITH retailer_mapping AS (
            SELECT lower(btrim(raw_retailer_name)) AS raw_retailer,
                   min(lower(btrim(mapped_retailer_name))) AS matched_retailer
            FROM typology_mapping_rules
            GROUP BY lower(btrim(raw_retailer_name))
            HAVING bool_and(NOT has_source_error AND mapped_retailer_name IS NOT NULL)
               AND count(DISTINCT lower(btrim(mapped_retailer_name))) = 1
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
