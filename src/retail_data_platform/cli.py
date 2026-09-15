from __future__ import annotations

import argparse
import json
from pathlib import Path

from retail_data_platform.importers.products import import_products


def main() -> int:
    parser = argparse.ArgumentParser(prog="retail-data")
    commands = parser.add_subparsers(dest="command", required=True)
    import_command = commands.add_parser("import", help="Import a dataset")
    datasets = import_command.add_subparsers(dest="dataset", required=True)
    products = datasets.add_parser("products", help="Import the product catalog")
    products.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()

    if args.command == "import" and args.dataset == "products":
        summary = import_products(args.source)
        print(
            json.dumps(
                {
                    "dataset": "products",
                    "rows_read": summary.rows_read,
                    "rows_loaded": summary.rows_loaded,
                    "skipped": summary.skipped,
                }
            )
        )
        return 0

    parser.error("Unsupported command")
    return 2
