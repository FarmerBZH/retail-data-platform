# Retail Data Platform

A portfolio project for building a reliable data platform from heterogeneous
tabular sources.

The project provides validated data ingestion, PostgreSQL analytics and an
authenticated read API. A web application is outside the current scope.

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
uv run retail-data import assortments --source-dir /path/to/monthly-assortment-sources
uv run retail-data import visits \
  --calls-dir /path/to/monthly-call-sources \
  --crowdsourced-dir /path/to/monthly-crowdsourced-visit-sources \
  --field-dir /path/to/monthly-field-visit-sources \
  --aliases-file /path/to/store-aliases.csv
uv run retail-data import numeric-distribution \
  --source-dir /path/to/monthly-distribution-sources \
  --aliases-file /path/to/store-and-product-aliases.csv
uv run retail-data import shelf-share \
  --source-dir /path/to/monthly-shelf-share-sources \
  --aliases-file /path/to/store-aliases.csv
uv run retail-data import register \
  --source-dir /path/to/monthly-register-sources
```

After the final import, publish the indexed analytical snapshot:

```bash
uv run retail-data analytics refresh
uv run retail-data analytics status
```

An import can also opt in with `--refresh-analytics`. See
[monthly analytics](docs/monthly-analytics.md) for the store-month contract,
freshness checks and refresh behavior.

## Authenticated read API

The global read API exposes all 13 application tables and 15 analytical views through
bounded, typed `/v1` endpoints. Every resource supports an exact primary-key lookup;
store-related resources also support `store_id` filtering. It requires OAuth2 JWT access
tokens and a dedicated PostgreSQL SELECT-only login. Start with the
[API operations guide](docs/read-api-operations.md),
[security contract](docs/read-api-design.md) and
[AI agent guide](docs/api-agent-guide.md).
The API does not issue tokens or deploy an identity provider or frontend.

Personal scripts use `retail-auth login`, then `retail-auth get` or the Python
`PersonalClient`. Sessions stop at expiration and require fresh credentials;
there is no automatic renewal. See [personal authentication](docs/personal-authentication.md)
for provider configuration, native-vault storage and usage examples.

Network totals, coverage and monthly comparisons are documented in
[Network analytics](docs/network-analytics.md).
