# Architecture

## Scope and status

This document describes the implemented data-foundation boundary of Retail Data
Platform. It is intentionally narrower than the long-term product: no API,
authentication layer, multi-tenant model, or web application exists in the
current architecture.

The goal of this phase is to turn heterogeneous tabular source bundles into a
validated, traceable PostgreSQL dataset without placing operational data in the
public repository.

## Context

```text
                  public repository
             +--------------------------+
private      | command-line interface   |
source ----> | dataset import adapter   | ----> PostgreSQL
bundle       | synthetic test fixtures  |         |
             +--------------------------+         +--> local inspection UI

                                                    future boundary
                                             PostgreSQL --> API --> web UI
```

Private sources remain outside the repository and are supplied to the command
line interface as a local directory. The repository contains synthetic fixtures
that exercise the same contracts without reproducing real records.

PostgreSQL is the system of record. The browser-based database interface is a
development inspection tool, not an application write path.

## Import lifecycle

Each dataset owns an adapter with one public import entry point. The current
lifecycle is:

1. Discover the required files from their structural contract, with a formatted
   period in the filename where the period is part of the source contract.
2. Check file boundaries such as type, size, encoding and identifying headers.
3. Hash the ordered source bundle and check for a previous successful run.
4. Record a running import in `import_runs`.
5. Parse, normalise, reconcile and validate rows for the smaller adapters.
6. Acquire a dataset-scoped PostgreSQL advisory lock.
7. Publish domain rows and mark the run successful in one transaction. The large
   register adapter parses and validates one file at a time inside this
   transaction after acquiring the lock.
8. If processing fails, roll back publication and record a failed run separately.

An identical bundle that already has a successful run is skipped. The database
also prevents more than one successful run for the same dataset and bundle hash.
The advisory lock serialises publication for a dataset, while database
constraints remain the final protection for identities and invariants.

## Components and responsibilities

### Command-line interface

The CLI selects a dataset adapter and supplies its source directory. It reports
a small machine-readable summary; source parsing and business rules do not live
in the command layer.

### Dataset import adapters

Each adapter owns its source contract and the transformations needed to produce
domain records. Discovery does not depend on organisation-specific filenames;
it uses headers and, where relevant, a generic period format. Parsing and
validation finish before the publication transaction commits so that a malformed
bundle cannot produce a partially refreshed domain dataset.

Adapters never choose an arbitrary winner for ambiguous identities: they reject
the conflict or retain the source observation with an unresolved relationship.
Duplicate source business keys are rejected. Expected validation messages
describe the role, row and field without echoing the rejected value.

### Persistence

SQLAlchemy models define the application mapping. Alembic migrations are the
versioned database contract. PostgreSQL reinforces critical rules with foreign
keys, uniqueness constraints, check constraints and indexes.

`import_runs` is the audit boundary for an execution. It stores the dataset,
bundle hash, lifecycle status, row counts, timestamps and a bounded failure
message. Domain publication and the successful status transition share a
transaction.

### Local database inspection

The optional database UI is exposed only on the loopback interface. It is useful
for reviewing imported rows and running development queries. Manual changes made
there are disposable and are never a substitute for a migration or importer.

## Architectural guarantees

For the implemented adapters, the design aims to preserve these invariants:

- private source files are not required inside the repository;
- identical validated input produces deterministic domain business fields;
- a previously successful identical bundle is not republished;
- validation failure cannot publish a partial domain refresh;
- concurrent publication of the same dataset is serialised;
- schema evolution is explicit and reversible;
- durable identity and value rules are enforced by PostgreSQL where practical;
- tests rely only on synthetic data.

These guarantees apply to the local ingestion boundary. They do not yet cover
distributed workers, remote object storage, asynchronous orchestration, API
availability, user authorisation, or production observability.

## Verification

A change to this boundary is complete only after the relevant checks pass:

- formatting, linting and strict type checking;
- unit tests for valid, invalid, duplicate and conflicting inputs;
- PostgreSQL integration checks for transactional and idempotent behaviour;
- fresh migration upgrade and model-to-schema alignment;
- downgrade and re-upgrade of a new migration.

Architecture documentation changes with system boundaries or guarantees. Routine
implementation details remain in code and tests so that this document stays
stable and reviewable.

## Deliberate limitations

- Most adapters validate complete source bundles in memory. The large register
  adapter processes one source file at a time and streams records into a single
  PostgreSQL transaction; it is still a local ingestion design, not a
  warehouse-scale ingestion service.
- Idempotency is based on byte-level bundle hashes. Semantically equivalent files
  with different bytes are distinct inputs.
- Failed-run recording is best-effort after the publication transaction fails;
  it is audit information, not a distributed workflow engine.
- The local database credentials and inspection UI are development conveniences,
  not a production security model.
