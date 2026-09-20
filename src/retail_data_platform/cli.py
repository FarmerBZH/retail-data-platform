from __future__ import annotations

import argparse
import json
from pathlib import Path

from retail_data_platform.importers.assortments import import_assortments
from retail_data_platform.importers.numeric_distribution import import_numeric_distribution
from retail_data_platform.importers.products import import_products
from retail_data_platform.importers.stores import import_stores
from retail_data_platform.importers.typologies import import_typologies
from retail_data_platform.importers.visits import import_visits


def main() -> int:
    parser = argparse.ArgumentParser(prog="retail-data")
    commands = parser.add_subparsers(dest="command", required=True)
    import_command = commands.add_parser("import", help="Import a dataset")
    datasets = import_command.add_subparsers(dest="dataset", required=True)
    products = datasets.add_parser("products", help="Import the product catalog")
    products.add_argument("--source-dir", type=Path, required=True)
    stores = datasets.add_parser("stores", help="Import the store catalog")
    stores.add_argument("--source-dir", type=Path, required=True)
    typologies = datasets.add_parser("typologies", help="Import monthly store typologies")
    typologies.add_argument("--source-dir", type=Path, required=True)
    assortments = datasets.add_parser("assortments", help="Import monthly assortments")
    assortments.add_argument("--source-dir", type=Path, required=True)
    visits = datasets.add_parser("visits", help="Import monthly store activity metrics")
    visits.add_argument("--calls-dir", type=Path, required=True)
    visits.add_argument("--crowdsourced-dir", type=Path, required=True)
    visits.add_argument("--field-dir", type=Path, required=True)
    visits.add_argument("--aliases-file", type=Path, required=True)
    distribution = datasets.add_parser(
        "numeric-distribution",
        help="Import monthly product presence observations",
    )
    distribution.add_argument("--source-dir", type=Path, required=True)
    distribution.add_argument("--aliases-file", type=Path, required=True)
    args = parser.parse_args()

    if args.command == "import" and args.dataset == "products":
        product_summary = import_products(args.source_dir)
        print(
            json.dumps(
                {
                    "dataset": "products",
                    "rows_read": product_summary.rows_read,
                    "rows_loaded": product_summary.rows_loaded,
                    "skipped": product_summary.skipped,
                }
            )
        )
        return 0

    if args.command == "import" and args.dataset == "stores":
        store_summary = import_stores(args.source_dir)
        print(
            json.dumps(
                {
                    "dataset": "stores",
                    "rows_read": store_summary.rows_read,
                    "rows_loaded": store_summary.rows_loaded,
                    "skipped": store_summary.skipped,
                }
            )
        )
        return 0

    if args.command == "import" and args.dataset == "typologies":
        typology_summary = import_typologies(args.source_dir)
        print(
            json.dumps(
                {
                    "dataset": "typologies",
                    "rows_read": typology_summary.rows_read,
                    "rows_loaded": typology_summary.rows_loaded,
                    "skipped": typology_summary.skipped,
                }
            )
        )
        return 0

    if args.command == "import" and args.dataset == "assortments":
        assortment_summary = import_assortments(args.source_dir)
        print(
            json.dumps(
                {
                    "dataset": "assortments",
                    "rows_read": assortment_summary.rows_read,
                    "rows_loaded": assortment_summary.rows_loaded,
                    "skipped": assortment_summary.skipped,
                }
            )
        )
        return 0

    if args.command == "import" and args.dataset == "visits":
        visit_summary = import_visits(
            args.calls_dir,
            args.crowdsourced_dir,
            args.field_dir,
            args.aliases_file,
        )
        print(
            json.dumps(
                {
                    "dataset": "store_activity_metrics",
                    "rows_read": visit_summary.rows_read,
                    "rows_loaded": visit_summary.rows_loaded,
                    "skipped": visit_summary.skipped,
                }
            )
        )
        return 0

    if args.command == "import" and args.dataset == "numeric-distribution":
        distribution_summary = import_numeric_distribution(
            args.source_dir,
            args.aliases_file,
        )
        print(
            json.dumps(
                {
                    "dataset": "numeric_distribution",
                    "rows_read": distribution_summary.rows_read,
                    "rows_loaded": distribution_summary.rows_loaded,
                    "rows_rejected": distribution_summary.rows_rejected,
                    "skipped": distribution_summary.skipped,
                }
            )
        )
        return 0

    parser.error("Unsupported command")
    return 2
