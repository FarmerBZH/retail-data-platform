from __future__ import annotations

import argparse
import json
from pathlib import Path

from retail_data_platform.importers.assortments import import_assortments
from retail_data_platform.importers.products import import_products
from retail_data_platform.importers.stores import import_stores
from retail_data_platform.importers.typologies import import_typologies


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

    parser.error("Unsupported command")
    return 2
