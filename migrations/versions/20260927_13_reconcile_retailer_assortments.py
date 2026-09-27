"""Relate source retailer labels to monthly snapshots through validated mappings."""

from collections.abc import Sequence

from alembic import op

revision: str = "20260927_13"
down_revision: str | None = "20260927_12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW analytics_retailer_assortment_month")
    op.execute("""
        CREATE MATERIALIZED VIEW analytics_retailer_assortment_month AS
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
        WHERE s.store_id IS NOT NULL AND s.store_match_status = 'matched'
        WITH NO DATA
    """)
    op.execute(
        "CREATE UNIQUE INDEX uq_am_retailer_assortment_month "
        "ON analytics_retailer_assortment_month (store_id, period, assortment_id)"
    )
    op.execute(
        "CREATE INDEX ix_am_retailer_assortment_month_period "
        "ON analytics_retailer_assortment_month (period)"
    )


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW analytics_retailer_assortment_month")
    op.execute("""
        CREATE MATERIALIZED VIEW analytics_retailer_assortment_month AS
        SELECT DISTINCT s.store_id, date_trunc('month', s.period)::date AS period,
               a.id AS assortment_id, a.product_id, a.gtin,
               a.product_match_status, a.typology_match_status
        FROM typology_snapshots s
        JOIN assortments a
          ON date_trunc('month', a.period)::date = date_trunc('month', s.period)::date
         AND lower(btrim(a.source_retailer_name)) = lower(btrim(s.retailer_name))
        WHERE s.store_id IS NOT NULL AND s.store_match_status = 'matched'
        WITH NO DATA
    """)
    op.execute(
        "CREATE UNIQUE INDEX uq_am_retailer_assortment_month "
        "ON analytics_retailer_assortment_month (store_id, period, assortment_id)"
    )
    op.execute(
        "CREATE INDEX ix_am_retailer_assortment_month_period "
        "ON analytics_retailer_assortment_month (period)"
    )
