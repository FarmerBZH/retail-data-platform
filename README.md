# Retail Data Platform

A portfolio project for building a reliable data platform from CSV and XLSX
sources.

The project will be developed incrementally, starting with data ingestion and
validation before adding an API and a web application.

## Development

The project requires Python 3.13 and [uv](https://docs.astral.sh/uv/).

```bash
uv sync
uv run ruff check .
uv run ruff format --check .
uv run mypy src
```

Start the local database and apply its migrations:

```bash
cp .env.example .env
docker compose up -d database database_admin
uv run alembic upgrade head
```

Browse the local database at [http://127.0.0.1:8080](http://127.0.0.1:8080).

Import the product source bundle:

```bash
uv run retail-data import products --source-dir /path/to/product-sources
uv run retail-data import stores --source-dir /path/to/store-sources
uv run retail-data import typologies --source-dir /path/to/monthly-typology-sources
```
